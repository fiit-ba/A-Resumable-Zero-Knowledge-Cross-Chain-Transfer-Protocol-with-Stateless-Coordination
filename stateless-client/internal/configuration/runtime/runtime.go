package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"stateless-client/internal/configuration/config"
	"stateless-client/internal/configuration/logger"
)

var (
	ErrAlreadyStarted = errors.New("runtime already started")
	ErrStopInProgress = errors.New("runtime stop already in progress")
)

type Runtime struct {
	cfg *config.Config
	log *logger.Logger

	mu       sync.Mutex
	started  bool
	stopping bool

	runCtx context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func New(cfg *config.Config, log *logger.Logger) *Runtime {
	return &Runtime{
		cfg: cfg,
		log: log,
	}
}

func (r *Runtime) Start() error {
	if r == nil {
		return fmt.Errorf("runtime is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.started {
		return ErrAlreadyStarted
	}
	if r.stopping {
		return ErrStopInProgress
	}
	if r.cfg == nil {
		return fmt.Errorf("runtime config is nil")
	}
	if r.log == nil {
		return fmt.Errorf("runtime logger is nil")
	}

	r.log.Info("runtime startup started",
		"app_name", r.cfg.AppName,
		"app_env", r.cfg.AppEnv,
		"runtime_mode", r.cfg.RuntimeMode,
	)

	r.runCtx, r.cancel = context.WithCancel(context.Background())
	r.started = true

	r.log.Info("runtime startup completed")
	return nil
}

func (r *Runtime) Stop(ctx context.Context) error {
	if r == nil {
		return fmt.Errorf("runtime is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	r.mu.Lock()
	if !r.started {
		r.mu.Unlock()
		if r.log != nil {
			r.log.Debug("runtime stop requested but runtime is not running")
		}
		return nil
	}
	if r.stopping {
		r.mu.Unlock()
		return ErrStopInProgress
	}

	r.stopping = true
	cancel := r.cancel
	r.mu.Unlock()

	r.log.Info("runtime shutdown started")

	if cancel != nil {
		cancel()
	}

	if err := waitWithContext(ctx, &r.wg); err != nil {
		r.mu.Lock()
		r.stopping = false
		r.mu.Unlock()

		r.log.Error("runtime shutdown interrupted", "error", err)
		return err
	}

	r.mu.Lock()
	r.started = false
	r.stopping = false
	r.runCtx = nil
	r.cancel = nil
	r.mu.Unlock()

	r.log.Info("runtime shutdown completed")
	return nil
}

func waitWithContext(ctx context.Context, wg *sync.WaitGroup) error {
	done := make(chan struct{})
	go func() {
		defer close(done)
		wg.Wait()
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("shutdown context done: %w", ctx.Err())
	}
}
