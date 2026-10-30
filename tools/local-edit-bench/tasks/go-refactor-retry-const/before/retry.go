package netx

import (
	"errors"
	"time"
)

var ErrGaveUp = errors.New("gave up")

func FetchWithRetry(fetch func() error) error {
	for attempt := 0; attempt < 3; attempt++ {
		if err := fetch(); err == nil {
			return nil
		}
		time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
	}
	return ErrGaveUp
}

func PostWithRetry(post func() error) error {
	for attempt := 0; attempt < 3; attempt++ {
		if err := post(); err == nil {
			return nil
		}
		time.Sleep(time.Duration(attempt+1) * 250 * time.Millisecond)
	}
	return ErrGaveUp
}
