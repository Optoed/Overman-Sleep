package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/argon2"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Per-process bounded hashing; persistent SQL buckets/attempt locks handle retries.
var authSlots = make(chan struct{}, 2)
var loginPattern = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

const authMemory = 19 * 1024
const authPasses = 2

func passwordKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, authPasses, authMemory, 1, 32)
}
func randomToken() (string, [32]byte, error) {
	var bytes [32]byte
	_, err := rand.Read(bytes[:])
	token := base64.RawURLEncoding.EncodeToString(bytes[:])
	return token, sha256.Sum256([]byte(token)), err
}
func randomOwner() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
func authDBFailure(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		fail(w, 409, "account_unavailable")
		return
	}
	fail(w, 503, "authentication_unavailable")
}
func authLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "60")
	fail(w, 429, "authentication_limited")
}
func (h Handler) serveAuth(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path != "/v1/auth/register" && path != "/v1/auth/login" && path != "/v1/auth/logout" {
		fail(w, 404, "not_found")
		return
	}
	if r.Method != http.MethodPost {
		fail(w, 405, "method_not_allowed")
		return
	}
	ctx := r.Context()
	if path == "/v1/auth/logout" {
		auth := tokenPattern.FindStringSubmatch(r.Header.Get("Authorization"))
		if auth == nil {
			fail(w, 401, "authentication_required")
			return
		}
		// No body carries credentials; only this bearer session is revoked.
		if r.Body != nil && r.Body != http.NoBody {
			d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64))
			d.DisallowUnknownFields()
			var body map[string]json.RawMessage
			decodeErr := d.Decode(&body)
			if decodeErr != io.EOF && (decodeErr != nil || body == nil || len(body) != 0) {
				fail(w, 400, "invalid_json")
				return
			}
			var extra any
			if d.Decode(&extra) != io.EOF {
				fail(w, 400, "invalid_json")
				return
			}
		}
		digest := sha256.Sum256([]byte(auth[1]))
		if _, err := h.Pool.Exec(ctx, "select overman.revoke_session($1)", digest[:]); err != nil {
			authDBFailure(w, err)
			return
		}
		response(w, 200, map[string]bool{"signedOut": true})
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		fail(w, 415, "json_required")
		return
	}
	var input struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil {
		fail(w, 400, "invalid_json")
		return
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "invalid_json")
		return
	}
	input.Login = strings.ToLower(strings.TrimSpace(input.Login))
	size := utf8.RuneCountInString(input.Password)
	if !loginPattern.MatchString(input.Login) || size < 15 || size > 128 || len(input.Password) > 512 {
		fail(w, 422, "invalid_account_input")
		return
	}
	select {
	case authSlots <- struct{}{}:
		defer func() { <-authSlots }()
	default:
		authLimited(w)
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	key := sha256.Sum256([]byte(host))
	var allowed bool
	if err = h.Pool.QueryRow(ctx, "select overman.auth_rate($1)", key[:]).Scan(&allowed); err != nil {
		authDBFailure(w, err)
		return
	}
	if !allowed {
		authLimited(w)
		return
	}
	token, tokenHash, err := randomToken()
	if err != nil {
		authDBFailure(w, err)
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		authDBFailure(w, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var owner string
	var expires time.Time
	if path == "/v1/auth/register" {
		var salt [32]byte
		if _, err = rand.Read(salt[:]); err != nil {
			authDBFailure(w, err)
			return
		}
		owner, err = randomOwner()
		if err != nil {
			authDBFailure(w, err)
			return
		}
		digest := passwordKey(input.Password, salt[:])
		defer clear(digest)
		err = tx.QueryRow(ctx, "select overman.register_account($1::uuid,$2,$3,$4,$5)", owner, input.Login, salt[:], digest, tokenHash[:]).Scan(&expires)
	} else {
		var id *string
		var salt, digest []byte
		var blocked bool
		if err = tx.QueryRow(ctx, "select user_id::text,salt,digest,blocked from overman.auth_challenge($1)", input.Login).Scan(&id, &salt, &digest, &blocked); err != nil {
			authDBFailure(w, err)
			return
		}
		if blocked {
			authLimited(w)
			return
		}
		if id == nil {
			salt = make([]byte, 32)
			digest = make([]byte, 32)
		}
		defer clear(digest)
		derived := passwordKey(input.Password, salt)
		matched := subtle.ConstantTimeCompare(derived, digest) == 1 && id != nil
		clear(derived)
		var expiry *time.Time
		if err = tx.QueryRow(ctx, "select overman.finish_login($1,$2,$3)", input.Login, matched, tokenHash[:]).Scan(&expiry); err != nil {
			authDBFailure(w, err)
			return
		}
		if !matched {
			if err = tx.Commit(ctx); err != nil {
				authDBFailure(w, err)
				return
			}
			fail(w, 401, "invalid_credentials")
			return
		}
		owner = *id
		if expiry == nil {
			authDBFailure(w, errors.New("missing expiration"))
			return
		}
		expires = *expiry
	}
	if err != nil {
		authDBFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		authDBFailure(w, err)
		return
	}
	response(w, 200, map[string]any{"protocolVersion": 1, "userId": owner, "username": input.Login, "token": token, "expiresAt": expires.UnixMilli()})
}
