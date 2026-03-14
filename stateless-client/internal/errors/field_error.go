package errors

import (
	stderrors "errors"
	"fmt"
)

type FieldError struct {
	Key    string
	Value  string
	Reason string

	kind  error
	cause error
}

func (e *FieldError) Error() string {
	if e == nil {
		return "<nil>"
	}

	if e.Value == "" {
		if e.cause != nil {
			return fmt.Sprintf("%s: %s: %v", e.Key, e.Reason, e.cause)
		}
		return fmt.Sprintf("%s: %s", e.Key, e.Reason)
	}

	if e.cause != nil {
		return fmt.Sprintf("%s: %s (value=%q): %v", e.Key, e.Reason, e.Value, e.cause)
	}
	return fmt.Sprintf("%s: %s (value=%q)", e.Key, e.Reason, e.Value)
}

func (e *FieldError) Unwrap() error {
	if e == nil {
		return nil
	}
	if e.kind == nil {
		return e.cause
	}
	if e.cause == nil {
		return e.kind
	}

	return stderrors.Join(e.kind, e.cause)
}

func NewMissingEnvVarError(key, reason string) error {
	return &FieldError{
		Key:    key,
		Reason: reason,
		kind:   ErrMissingEnvVar,
	}
}

func NewInvalidEnvVarError(key, value, reason string, cause error) error {
	return &FieldError{
		Key:    key,
		Value:  value,
		Reason: reason,
		kind:   ErrInvalidEnvVar,
		cause:  cause,
	}
}
