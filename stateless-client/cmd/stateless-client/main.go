package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"stateless-client/internal/configuration/config"
	"stateless-client/internal/configuration/logger"
	"stateless-client/internal/configuration/runtime"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}

	log, err := logger.New(*cfg)
	if err != nil {
		panic(err)
	}

	rt := runtime.New(cfg, log)
	if err := rt.Start(); err != nil {
		panic(err)
	}

	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	<-sigCtx.Done()
	if err := rt.Stop(context.Background()); err != nil {
		panic(err)
	}
}