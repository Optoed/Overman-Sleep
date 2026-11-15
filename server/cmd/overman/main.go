package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"overman/server/internal/api"
	"syscall"
	"time"
)

func main() {
	config := flag.String("config", "../.tools/overman-postgres-dev.json", "local development configuration path")
	listen := flag.String("listen", "127.0.0.1:3901", "local development listen address")
	publicOrigin := flag.String("public-origin", "", "public HTTPS web origin; empty preserves loopback development")
	healthcheck := flag.String("healthcheck", "", "check an internal health endpoint and exit")
	flag.Parse()
	if *healthcheck != "" {
		client := http.Client{Timeout: 3 * time.Second}
		r, err := client.Get(*healthcheck)
		if err != nil {
			os.Exit(1)
		}
		r.Body.Close()
		if r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	origins, err := api.PublicOrigins(*publicOrigin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Invalid public origin")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := api.OpenLocalPool(ctx, *config, false)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Database unavailable; configuration details suppressed")
		os.Exit(1)
	}
	defer pool.Close()
	h := api.Handler{Pool: pool, AllowedOrigins: origins}
	server := &http.Server{Addr: *listen, Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	fmt.Println("Overman Go API ready")
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "API listener failed")
		os.Exit(1)
	}
}
