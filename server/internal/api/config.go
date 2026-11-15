package api

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net"
	"net/url"
	"os"
	"strconv"
	"time"
)

type LocalConfig struct {
	Host            string `json:"host"`
	Port            int    `json:"port"`
	Database        string `json:"database"`
	User            string `json:"user"`
	Password        string `json:"password"`
	RuntimeUser     string `json:"runtimeUser"`
	RuntimePassword string `json:"runtimePassword"`
}

func OpenLocalPool(ctx context.Context, path string, admin bool) (*pgxpool.Pool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c LocalConfig
	if err = json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	user, password := c.RuntimeUser, c.RuntimePassword
	if admin {
		user, password = c.User, c.Password
	}
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(c.Host, strconv.Itoa(c.Port)), Path: c.Database, User: url.UserPassword(user, password)}
	q := u.Query()
	q.Set("sslmode", "disable")
	u.RawQuery = q.Encode() // loopback-only development database
	config, err := pgxpool.ParseConfig(u.String())
	if err != nil {
		return nil, err
	}
	config.MaxConns = 4
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
