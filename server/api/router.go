package api

import (
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/kalman/voicechat/config"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
	"github.com/kalman/voicechat/ws"
)

func NewRouter(cfg *config.Config, database *db.DB, hub *ws.Hub, store *storage.FileStore, staticFS fs.FS) http.Handler {
	mux := http.NewServeMux()

	authHandler := &AuthHandler{DB: database, Hub: hub}
	authMW := &AuthMiddleware{DB: database}
	channelHandler := &ChannelHandler{DB: database}
	messageHandler := &MessageHandler{DB: database}
	uploadHandler := &UploadHandler{DB: database, Store: store, MaxSize: cfg.MaxUploadSize}
	uploadRL := NewIPRateLimiter(3, 30*time.Second)

	registerRL := NewIPRateLimiter(3, time.Minute)
	loginRL := NewIPRateLimiter(5, time.Minute)

	// Health check (unauthenticated — used by desktop app to verify server)
	mux.HandleFunc("/api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"app": "voicechat"})
	})

	// Auth routes
	mux.HandleFunc("/api/v1/auth/register", registerRL.Wrap(authHandler.Register))
	mux.HandleFunc("/api/v1/auth/login", loginRL.Wrap(authHandler.Login))

	// Channel routes (authenticated)
	mux.HandleFunc("/api/v1/channels", authMW.Wrap(channelHandler.List))

	// Message history (authenticated) — matches /api/v1/channels/{id}/messages
	mux.HandleFunc("/api/v1/channels/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/messages") {
			messageHandler.GetHistory(w, r)
			return
		}
		http.NotFound(w, r)
	}))

	// Upload (authenticated + rate limited)
	mux.HandleFunc("/api/v1/upload", uploadRL.Wrap(authMW.Wrap(uploadHandler.Upload)))

	// Media library (authenticated + rate limited, 500MB max)
	mediaHandler := &MediaHandler{DB: database, Store: store, Hub: hub, MaxSize: 10 * 1024 * 1024 * 1024}
	mediaRL := NewIPRateLimiter(2, time.Minute)
	mux.HandleFunc("/api/v1/media/upload", mediaRL.Wrap(authMW.Wrap(mediaHandler.Upload)))
	mux.HandleFunc("/api/v1/media/", authMW.Wrap(mediaHandler.Delete))

	// Auth - change password (authenticated)
	mux.HandleFunc("/api/v1/auth/password", authMW.Wrap(authHandler.ChangePassword))

	// Admin routes (authenticated)
	adminHandler := &AdminHandler{DB: database, Hub: hub}
	mux.HandleFunc("/api/v1/admin/users", authMW.Wrap(adminHandler.ListUsers))
	mux.HandleFunc("/api/v1/admin/users/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/admin") {
			adminHandler.SetAdmin(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/password") {
			adminHandler.SetPassword(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/approve") {
			adminHandler.ApproveUser(w, r)
			return
		}
		adminHandler.DeleteUser(w, r)
	}))

	// Radio track upload/delete (authenticated + rate limited)
	radioHandler := &RadioHandler{DB: database, Store: store, Hub: hub}
	radioRL := NewIPRateLimiter(5, 30*time.Second)
	mux.HandleFunc("/api/v1/radio/playlists/", radioRL.Wrap(authMW.Wrap(radioHandler.UploadTrack)))
	mux.HandleFunc("/api/v1/radio/tracks/", authMW.Wrap(radioHandler.DeleteTrack))

	// Audio device management (authenticated)
	audioHandler := &AudioHandler{}
	mux.HandleFunc("/api/v1/audio/devices", authMW.Wrap(audioHandler.ListDevices))
	mux.HandleFunc("/api/v1/audio/device", authMW.Wrap(audioHandler.SetDevice))

	// WebSocket
	mux.HandleFunc("/ws", hub.HandleWebSocket)

	// Static file serving for uploads/thumbs/avatars (no directory listing)
	uploadsDir := filepath.Join(cfg.DataDir, "uploads")
	thumbsDir := filepath.Join(cfg.DataDir, "thumbs")
	avatarsDir := filepath.Join(cfg.DataDir, "avatars")

	mux.Handle("/uploads/", http.StripPrefix("/uploads/", noDirectoryListing(http.FileServer(http.Dir(uploadsDir)))))
	mux.Handle("/thumbs/", http.StripPrefix("/thumbs/", noDirectoryListing(http.FileServer(http.Dir(thumbsDir)))))
	mux.Handle("/avatars/", http.StripPrefix("/avatars/", noDirectoryListing(http.FileServer(http.Dir(avatarsDir)))))

	// SPA serving
	if cfg.DevMode {
		viteURL, _ := url.Parse("http://localhost:5173")
		proxy := httputil.NewSingleHostReverseProxy(viteURL)
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" {
				http.NotFound(w, r)
				return
			}
			proxy.ServeHTTP(w, r)
		})
	} else {
		mux.HandleFunc("/", spaHandler(staticFS))
	}

	return mux
}

func noDirectoryListing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func spaHandler(staticFS fs.FS) http.HandlerFunc {
	// Read index.html once at startup
	indexHTML, _ := fs.ReadFile(staticFS, "index.html")

	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		// Serve root as index.html
		if path == "" || path == "index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(indexHTML)
			return
		}

		// Try serving static file
		f, err := staticFS.Open(path)
		if err == nil {
			f.Close()
			http.FileServer(http.FS(staticFS)).ServeHTTP(w, r)
			return
		}

		// SPA fallback — serve index.html for client-side routing
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	}
}
