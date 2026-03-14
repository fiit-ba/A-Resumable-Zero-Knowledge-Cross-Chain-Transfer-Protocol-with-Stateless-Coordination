package errors

import "errors"

var (
	ErrMissingEnvVar = errors.New("missing required environment variable")
	ErrInvalidEnvVar = errors.New("invalid environment variable value")
)
