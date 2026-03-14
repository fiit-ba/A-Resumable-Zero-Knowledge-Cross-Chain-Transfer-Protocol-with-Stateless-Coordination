package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"stateless-client/internal/configuration/config"
)

type Logger struct {
	base *slog.Logger
}

func New(cfg config.Config) (*Logger, error) {
	return NewWithOutput(cfg.LogLevel, os.Stdout)
}

func NewWithLevel(level string) (*Logger, error) {
	return NewWithOutput(level, os.Stdout)
}

func NewWithOutput(level string, out io.Writer) (*Logger, error) {
	parsedLevel, err := parseLevel(level)
	if err != nil {
		return nil, err
	}

	handler := slog.NewTextHandler(out, &slog.HandlerOptions{
		Level: parsedLevel,
	})

	return &Logger{base: slog.New(handler)}, nil
}

func (l *Logger) Debug(msg string, kv ...any) {
	l.log(slog.LevelDebug, msg, kv...)
}

func (l *Logger) Info(msg string, kv ...any) {
	l.log(slog.LevelInfo, msg, kv...)
}

func (l *Logger) Warn(msg string, kv ...any) {
	l.log(slog.LevelWarn, msg, kv...)
}

func (l *Logger) Error(msg string, kv ...any) {
	l.log(slog.LevelError, msg, kv...)
}

func (l *Logger) log(level slog.Level, msg string, kv ...any) {
	if l == nil || l.base == nil {
		return
	}

	l.base.Log(context.Background(), level, msg, normalizeKV(kv)...)
}

func parseLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("invalid log level %q: expected debug, info, warn, or error", raw)
	}
}

func normalizeKV(kv []any) []any {
	if len(kv) == 0 {
		return nil
	}

	normalized := make([]any, 0, len(kv)+1)

	for i := 0; i < len(kv); i += 2 {
		key := fmt.Sprintf("field_%d", i/2)
		if i < len(kv) {
			switch value := kv[i].(type) {
			case string:
				value = strings.TrimSpace(value)
				if value != "" {
					key = value
				}
			case nil:
			default:
				key = fmt.Sprint(value)
			}
		}

		value := any("(missing)")
		if i+1 < len(kv) {
			value = kv[i+1]
		}

		normalized = append(normalized, key, value)
	}

	return normalized
}
