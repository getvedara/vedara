package accounts

import "time"

type User struct {
	ID      int
	Name    string
	Created time.Time
	Admin   bool
}

func NewUser(id int, name string, now time.Time) User {
	return User{
		ID:      id,
		Name:    name,
		Created: now,
	}
}

func Guest(now time.Time) User {
	return NewUser(0, "guest", now)
}
