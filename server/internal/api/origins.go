package api

import (
	"errors"
	"net/url"
	"strings"
)

func PublicOrigins(origin string) (map[string]bool, error) {
	if origin == "" {
		return map[string]bool{"http://127.0.0.1:3001": true, "http://localhost:3001": true, "https://appassets.androidplatform.net": true}, nil
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("invalid public HTTPS origin")
	}
	return map[string]bool{"https://" + strings.ToLower(u.Host): true, "https://appassets.androidplatform.net": true}, nil
}
