package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type ipEntry struct {
	count    int
	windowAt time.Time
}

type IPRateLimiter struct {
	limit     int
	window    time.Duration
	mu        sync.Mutex
	ips       map[string]*ipEntry
	lastSweep time.Time
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
	if now.Sub(rl.lastSweep) > rl.window {
		for k, e := range rl.ips {
			if now.After(e.windowAt) {
				delete(rl.ips, k)
			}
		}
		rl.lastSweep = now
	}
	entry, ok := rl.ips[ip]
	if !ok || now.After(entry.windowAt) {
		rl.ips[ip] = &ipEntry{count: 1, windowAt: now.Add(rl.window)}
		return true
	}

	entry.count++
	return entry.count <= rl.limit
}

func clientIP(r *http.Request) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	// Only trust X-Real-IP when the connection comes from a local reverse
	// proxy (nginx on the same box or private network). A client hitting the
	// Go port directly cannot spoof its way past the limiter.
	if ip := net.ParseIP(remote); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return xr
		}
	}
	return remote
}

func (rl *IPRateLimiter) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)

		if !rl.Allow(ip) {
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}

		next(w, r)
	}
}
