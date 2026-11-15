package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Handler struct {
	Pool           *pgxpool.Pool
	AllowedOrigins map[string]bool
}

var tokenPattern = regexp.MustCompile(`^Bearer ([A-Za-z0-9_-]{40,128})$`)

type operation struct {
	OperationID      string          `json:"operationId"`
	Date             string          `json:"date"`
	ExpectedRevision *int64          `json:"expectedRevision"`
	Night            json.RawMessage `json:"night"`
	ExpectedOwnerID  string          `json:"expectedOwnerId"`
}

type legacyCreditImport struct {
	OperationID     string          `json:"operationId"`
	Dates           json.RawMessage `json:"dates"`
	Garden          *bool           `json:"garden"`
	ExpectedOwnerID string          `json:"expectedOwnerId"`
}

type cancellation struct {
	OperationID     string `json:"operationId"`
	ExpectedOwnerID string `json:"expectedOwnerId"`
}

func response(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code string) {
	response(w, status, map[string]string{"error": code})
}
func dbFailure(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		if pg.Code == "P0001" {
			if strings.Contains(pg.Message, "owner changed") {
				fail(w, 403, "owner_changed")
				return
			}
			for _, s := range []string{"revision conflict", "identifier reused", "original target", "another reward protocol", "was cancelled"} {
				if strings.Contains(pg.Message, s) {
					fail(w, 409, "diary_conflict")
					return
				}
			}
			fail(w, 422, "invalid_diary_operation")
			return
		}
		if strings.HasPrefix(pg.Code, "22") {
			fail(w, 422, "invalid_diary_operation")
			return
		}
	}
	// No raw database errors, parameters, tokens or connection strings in responses.
	fail(w, 503, "database_unavailable")
}
func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if origin := r.Header.Get("Origin"); origin != "" {
		if !h.AllowedOrigins[origin] {
			fail(w, 403, "origin_not_allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if r.URL.Path == "/v1/friends" {
		h.serveFriends(w, r.WithContext(ctx))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/auth/") {
		h.serveAuth(w, r.WithContext(ctx))
		return
	}
	if r.URL.Path == "/health" && r.Method == http.MethodGet {
		if err := h.Pool.Ping(ctx); err != nil {
			dbFailure(w, err)
			return
		}
		response(w, 200, map[string]any{"status": "ok", "database": "postgresql", "runtime": "go", "protocolVersion": 1})
		return
	}
	if r.URL.Path != "/v1/diary" && r.URL.Path != "/v1/diary/operations" && r.URL.Path != "/v1/diary/cancellations" && r.URL.Path != "/v1/session" && r.URL.Path != "/v1/diary/legacy-credits" {
		fail(w, 404, "not_found")
		return
	}
	isCancellation := r.URL.Path == "/v1/diary/cancellations"
	isLegacy := r.URL.Path == "/v1/diary/legacy-credits"
	mutation := r.URL.Path == "/v1/diary/operations" || isCancellation || isLegacy
	if !(r.Method == http.MethodGet && !mutation || r.Method == http.MethodPost && mutation) {
		fail(w, 405, "method_not_allowed")
		return
	}
	auth := tokenPattern.FindStringSubmatch(r.Header.Get("Authorization"))
	if auth == nil {
		fail(w, 401, "authentication_required")
		return
	}
	var op operation
	var legacy legacyCreditImport
	if r.Method == http.MethodPost {
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			fail(w, 415, "json_required")
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
		decoder.DisallowUnknownFields()
		var cancelled cancellation
		var target any = &op
		if isCancellation {
			target = &cancelled
		} else if isLegacy {
			target = &legacy
		}
		if err := decoder.Decode(target); err != nil {
			var max *http.MaxBytesError
			if errors.As(err, &max) {
				fail(w, 413, "request_too_large")
			} else {
				fail(w, 400, "invalid_json")
			}
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			fail(w, 400, "invalid_json")
			return
		}
		if isLegacy {
			if len(legacy.Dates) == 0 || legacy.Garden == nil {
				fail(w, 422, "invalid_diary_operation")
				return
			}
			op.OperationID, op.ExpectedOwnerID = legacy.OperationID, legacy.ExpectedOwnerID
		} else if isCancellation {
			op.OperationID, op.ExpectedOwnerID = cancelled.OperationID, cancelled.ExpectedOwnerID
		} else if op.ExpectedRevision == nil || *op.ExpectedRevision < 0 || *op.ExpectedRevision > int64(math.Pow(2, 53)-2) || len(op.Night) == 0 {
			fail(w, 422, "invalid_diary_operation")
			return
		}
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	digest := sha256.Sum256([]byte(auth[1]))
	var owner *string
	if err = tx.QueryRow(ctx, "select overman.resolve_session($1)::text", digest[:]).Scan(&owner); err != nil {
		dbFailure(w, err)
		return
	}
	if owner == nil {
		fail(w, 401, "authentication_required")
		return
	}
	if _, err = tx.Exec(ctx, "select set_config('overman.owner_id',$1,true)", *owner); err != nil {
		dbFailure(w, err)
		return
	}
	var value json.RawMessage
	if r.URL.Path == "/v1/session" {
		value, _ = json.Marshal(map[string]string{"userId": *owner})
	} else if r.Method == http.MethodGet {
		err = tx.QueryRow(ctx, "select public.read_sleep_diary()").Scan(&value)
	} else if isLegacy {
		err = tx.QueryRow(ctx, "select public.import_legacy_sleep_credits($1::uuid,$2::jsonb,$3::boolean,$4::uuid)", op.OperationID, string(legacy.Dates), *legacy.Garden, op.ExpectedOwnerID).Scan(&value)
	} else if isCancellation {
		err = tx.QueryRow(ctx, "select public.cancel_sleep_diary_operation($1::uuid,$2::uuid)", op.OperationID, op.ExpectedOwnerID).Scan(&value)
	} else {
		var night any
		if string(op.Night) != "null" {
			night = string(op.Night)
		}
		err = tx.QueryRow(ctx, "select public.save_sleep_diary_operation($1::uuid,$2::date,$3::bigint,$4::jsonb,$5::uuid)", op.OperationID, op.Date, *op.ExpectedRevision, night, op.ExpectedOwnerID).Scan(&value)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 401, "authentication_required")
		} else {
			dbFailure(w, err)
		}
		return
	}
	if err = tx.Commit(ctx); err != nil {
		dbFailure(w, err)
		return
	}
	response(w, 200, value)
}
