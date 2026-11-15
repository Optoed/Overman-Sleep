package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFriendsRequestBoundary(t *testing.T) {
	cases := []struct {
		name, method, body, token, content, origin string
		want                                       int
	}{
		{"anonymous", "GET", "", "", "", "", 401},
		{"unsupported method", "DELETE", "", "", "", "", 405},
		{"origin blocked", "GET", "", "", "", "https://untrusted.invalid", 403},
		{"invalid json", "POST", "{", strings.Repeat("a", 43), "application/json", "", 400},
		{"unknown fields", "POST", `{"action":"list","payload":{},"expectedOwnerId":"00000000-0000-0000-0000-000000000001","owner":"forged"}`, strings.Repeat("a", 43), "application/json", "", 400},
		{"invalid owner", "POST", `{"action":"list","payload":{},"expectedOwnerId":"forged"}`, strings.Repeat("a", 43), "application/json", "", 422},
		{"unknown action", "POST", `{"action":"dump","payload":{},"expectedOwnerId":"00000000-0000-0000-0000-000000000001"}`, strings.Repeat("a", 43), "application/json", "", 422},
		{"non json", "POST", `{}`, strings.Repeat("a", 43), "text/plain", "", 415},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(c.method, "/v1/friends", strings.NewReader(c.body))
			if c.token != "" {
				r.Header.Set("Authorization", "Bearer "+c.token)
			}
			r.Header.Set("Content-Type", c.content)
			r.Header.Set("Origin", c.origin)
			w := httptest.NewRecorder()
			Handler{}.ServeHTTP(w, r)
			if w.Code != c.want {
				t.Fatalf("status %d; want %d", w.Code, c.want)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("social responses must not be cached")
			}
			if w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
				t.Fatal("wrong response type")
			}
			if c.method == http.MethodGet && w.Code == 200 {
				t.Fatal("unauthenticated data")
			}
		})
	}
}
