package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var friendUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type friendCommand struct {
	Action          string          `json:"action"`
	Payload         json.RawMessage `json:"payload"`
	ExpectedOwnerID string          `json:"expectedOwnerId"`
}

func (h Handler) serveFriends(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		fail(w, 405, "method_not_allowed")
		return
	}
	auth := tokenPattern.FindStringSubmatch(r.Header.Get("Authorization"))
	if auth == nil {
		fail(w, 401, "authentication_required")
		return
	}
	command := friendCommand{Action: "list", Payload: json.RawMessage(`{}`)}
	if r.Method == http.MethodPost {
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			fail(w, 415, "json_required")
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&command); err != nil {
			fail(w, 400, "invalid_social_request")
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			fail(w, 400, "invalid_social_request")
			return
		}
		switch command.Action {
		case "list", "profile", "request", "accept", "remove", "share", "invite-sleep", "join-sleep", "decline-sleep":
		default:
			fail(w, 422, "invalid_social_request")
			return
		}
		if len(command.Payload) == 0 || !friendUUIDPattern.MatchString(command.ExpectedOwnerID) {
			fail(w, 422, "invalid_social_request")
			return
		}
	}
	ctx := r.Context()
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
	if r.Method == http.MethodPost && !strings.EqualFold(command.ExpectedOwnerID, *owner) {
		fail(w, 403, "owner_changed")
		return
	}
	if _, err = tx.Exec(ctx, "select set_config('overman.owner_id',$1,true)", *owner); err != nil {
		dbFailure(w, err)
		return
	}
	var value json.RawMessage
	if err = tx.QueryRow(ctx, "select public.overman_social($1,$2::jsonb)", command.Action, string(command.Payload)).Scan(&value); err != nil {
		dbFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		dbFailure(w, err)
		return
	}
	response(w, 200, value)
}
