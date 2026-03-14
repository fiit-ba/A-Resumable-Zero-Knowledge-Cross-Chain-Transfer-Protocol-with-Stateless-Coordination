package config

import (
	"os"
	"strings"
	"time"

	appErrors "stateless-client/internal/errors"
)

const (
	defaultAppName         = "stateless-client"
	defaultAppEnv          = "development"
	defaultLogLevel        = "info"
	defaultListenAddr      = ":8080"
	defaultShutdownTimeout = 10 * time.Second
)

type Config struct {
	AppName         string
	AppEnv          string
	RuntimeMode     string
	LogLevel        string
	ListenAddr      string
	ShutdownTimeout time.Duration
}

func Load() (*Config, error) {
	shutdownTimeout, err := getDurationEnv("SHUTDOWN_TIMEOUT", defaultShutdownTimeout)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		AppName:         getStringEnv("APP_NAME", defaultAppName),
		AppEnv:          strings.ToLower(getStringEnv("APP_ENV", defaultAppEnv)),
		RuntimeMode:     getOptionalStringEnv("RUNTIME_MODE"),
		LogLevel:        strings.ToLower(getStringEnv("LOG_LEVEL", defaultLogLevel)),
		ListenAddr:      getStringEnv("LISTEN_ADDR", defaultListenAddr),
		ShutdownTimeout: shutdownTimeout,
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	if c == nil {
		return appErrors.NewInvalidEnvVarError("config", "", "must not be nil", nil)
	}

	if c.AppName == "" {
		return appErrors.NewMissingEnvVarError("APP_NAME", "must not be empty")
	}
	if c.AppEnv == "" {
		return appErrors.NewMissingEnvVarError("APP_ENV", "must not be empty")
	}
	if c.LogLevel == "" {
		return appErrors.NewMissingEnvVarError("LOG_LEVEL", "must not be empty")
	}
	if !isSupportedLogLevel(c.LogLevel) {
		return appErrors.NewInvalidEnvVarError("LOG_LEVEL", c.LogLevel, "expected debug, info, warn, or error", nil)
	}
	if c.ListenAddr == "" {
		return appErrors.NewMissingEnvVarError("LISTEN_ADDR", "must not be empty")
	}
	if c.ShutdownTimeout <= 0 {
		return appErrors.NewInvalidEnvVarError("SHUTDOWN_TIMEOUT", c.ShutdownTimeout.String(), "must be greater than 0", nil)
	}

	return nil
}

func getStringEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func getOptionalStringEnv(key string) string {
	return strings.TrimSpace(os.Getenv(key))
}

func getDurationEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, appErrors.NewInvalidEnvVarError(key, value, "must be a valid Go duration string", err)
	}

	return duration, nil
}

func isSupportedLogLevel(level string) bool {
	switch level {
	case "debug", "info", "warn", "warning", "error":
		return true
	default:
		return false
	}
}
