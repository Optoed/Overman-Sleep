package api

import "testing"

func TestPublicOrigins(t *testing.T) {
	for _, origin := range []string{"http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com?token=x", "https://example.com#fragment", "https://"} {
		if _, err := PublicOrigins(origin); err == nil {
			t.Fatalf("accepted invalid origin %q", origin)
		}
	}
	m, err := PublicOrigins("https://sleep.example.com")
	if err != nil || !m["https://sleep.example.com"] || !m["https://appassets.androidplatform.net"] || m["http://localhost:3001"] {
		t.Fatal("production origins not restricted")
	}
	local, err := PublicOrigins("")
	upper, upperErr := PublicOrigins("https://SLEEP.EXAMPLE.COM")
	if upperErr != nil || !upper["https://sleep.example.com"] || upper["https://SLEEP.EXAMPLE.COM"] {
		t.Fatal("configured domain must match browser-normalized lowercase hostname")
	}
	if err != nil || !local["http://127.0.0.1:3001"] {
		t.Fatal("local development regression")
	}
}
