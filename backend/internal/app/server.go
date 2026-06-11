package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func Run() error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	log := Logger(cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	app, err := NewApplication(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer app.Close()
	return app.Start(ctx)
}

func (a *Application) StartHTTP(ctx context.Context) error {
	server := &http.Server{
		Addr:              a.Config.ListenAddr,
		Handler:           a.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		a.Log.Info("http listening", "addr", a.Config.ListenAddr)
		errCh <- server.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
