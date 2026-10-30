package api

import (
	"net/http"
	"time"
)

type Client struct {
	BaseURL string
	Timeout time.Duration
	HTTP    *http.Client
}

func NewClient(baseURL string, timeout time.Duration) *Client {
	return &Client{
		BaseURL: baseURL,
		Timeout: timeout,
		HTTP:    &http.Client{},
	}
}

func NewDefaultClient() *Client {
	return NewClient("https://api.example.com", 30*time.Second)
}
