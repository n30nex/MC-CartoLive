package api

import (
	"strings"
	"sync"
)

type wsAdmissionLimiter struct {
	mu       sync.Mutex
	byIP     map[string]int
	maxPerIP int
}
func newWSAdmissionLimiter(maxPerIP int) *wsAdmissionLimiter {
	if maxPerIP < 1 {
		maxPerIP = 5
	}
	return &wsAdmissionLimiter{byIP: map[string]int{}, maxPerIP: maxPerIP}
}

func (l *wsAdmissionLimiter) acquire(ip string) bool {
	if l == nil {
		return false
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.byIP[ip] >= l.maxPerIP {
		return false
	}
	l.byIP[ip]++
	return true
}

func (l *wsAdmissionLimiter) release(ip string) {
	if l == nil {
		return
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.byIP[ip] <= 1 {
		delete(l.byIP, ip)
		return
	}
	l.byIP[ip]--
}
