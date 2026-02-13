package api

import (
	"net/http"
	"sync"
	"time"
)

type ipEntry struct {
	count    int
	windowAt time.Time
}

type IPRateLimiter struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	ips    map[string]*ipEntry
}

func NewIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	return &IPRateLimiter{
		limit:  limit,
		window: window,
		ips:    make(map[string]*ipEntry),
	}
}

func (rl *IPRateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	entry, ok := rl.ips[ip]
	if !ok || now.After(entry.windowAt) {
		rl.ips[ip] = &ipEntry{count: 1, windowAt: now.Add(rl.window)}
		return true
	}

	entry.count++
	return entry.count <= rl.limit
}

func (rl *IPRateLimiter) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}

		if !rl.Allow(ip) {
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}

		next(w, r)
	}
}
