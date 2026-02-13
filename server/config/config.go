package config

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port          int
	DataDir       string
	MaxUploadSize int64
	DevMode       bool
	PublicIP      string
	STUNServer    string
	RemoteURL     string // Desktop-only: connect to remote server instead of starting local one
}

func Parse() *Config {
	cfg := &Config{}

	flag.IntVar(&cfg.Port, "port", envInt("PORT", 8080), "HTTP server port")
	flag.StringVar(&cfg.DataDir, "data-dir", envStr("DATA_DIR", "./data"), "Data directory path")
	flag.Int64Var(&cfg.MaxUploadSize, "max-upload-size", envInt64("MAX_UPLOAD_SIZE", 10485760), "Max upload size in bytes")
	flag.BoolVar(&cfg.DevMode, "dev", false, "Enable dev mode (proxy frontend to Vite)")
	flag.StringVar(&cfg.PublicIP, "public-ip", envStr("PUBLIC_IP", ""), "Public IP for SFU NAT traversal")
	flag.StringVar(&cfg.STUNServer, "stun-server", envStr("STUN_SERVER", "stun:stun.l.google.com:19302"), "STUN server address")
	flag.StringVar(&cfg.RemoteURL, "url", "", "Desktop mode: connect to remote server URL (skips local server)")
	flag.Parse()

	return cfg
}

func (c *Config) EnsureDataDir() error {
	dirs := []string{
		c.DataDir,
		filepath.Join(c.DataDir, "uploads"),
		filepath.Join(c.DataDir, "thumbs"),
		filepath.Join(c.DataDir, "avatars"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
	}
	return nil
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}
