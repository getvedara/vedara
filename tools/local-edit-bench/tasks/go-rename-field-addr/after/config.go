package server

import (
	"errors"
	"fmt"
	"strings"
)

type ServerConfig struct {
	ListenAddress      string
	TLS       bool
	MaxConns  int
	ReadOnly  bool
}

func (c ServerConfig) Validate() error {
	if c.ListenAddress == "" {
		return errors.New("listen address is required")
	}
	if c.MaxConns <= 0 {
		return errors.New("max conns must be positive")
	}
	return nil
}

func (c ServerConfig) URL() string {
	scheme := "http"
	if c.TLS {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, c.ListenAddress)
}

func Normalize(c ServerConfig) ServerConfig {
	c.ListenAddress = strings.TrimSpace(c.ListenAddress)
	if !strings.Contains(c.ListenAddress, ":") {
		c.ListenAddress += ":8080"
	}
	return c
}
