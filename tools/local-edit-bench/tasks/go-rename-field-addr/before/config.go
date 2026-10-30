package server

import (
	"errors"
	"fmt"
	"strings"
)

type ServerConfig struct {
	Addr      string
	TLS       bool
	MaxConns  int
	ReadOnly  bool
}

func (c ServerConfig) Validate() error {
	if c.Addr == "" {
		return errors.New("addr is required")
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
	return fmt.Sprintf("%s://%s", scheme, c.Addr)
}

func Normalize(c ServerConfig) ServerConfig {
	c.Addr = strings.TrimSpace(c.Addr)
	if !strings.Contains(c.Addr, ":") {
		c.Addr += ":8080"
	}
	return c
}
