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
	metricsServer := &http.Server{
		Addr:              a.Config.MetricsListenAddr,
		Handler:           a.apiServer.MetricsRoutes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errCh := make(chan error, 2)
	go func() {
		a.Log.Info("http listening", "addr", a.Config.ListenAddr)
		errCh <- server.ListenAndServe()
	}()
	if a.Config.MetricsListenAddr != "" {
		go func() {
			a.Log.Info("metrics listening", "addr", a.Config.MetricsListenAddr)
			errCh <- metricsServer.ListenAndServe()
		}()
	}
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		metricsErr := metricsServer.Shutdown(shutdownCtx)
		serverErr := server.Shutdown(shutdownCtx)
		if serverErr != nil {
			return serverErr
		}
		return metricsErr
	case err := <-errCh:
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		_ = metricsServer.Shutdown(shutdownCtx)
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
