package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/kalman/voicechat/config"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/email"
	"github.com/kalman/voicechat/storage"
	"github.com/kalman/voicechat/ws"
)

func NewRouter(cfg *config.Config, database *db.DB, hub *ws.Hub, store *storage.FileStore, staticFS fs.FS, emailService *email.EmailService, encKey []byte) http.Handler {
	mux := http.NewServeMux()

	authHandler := &AuthHandler{DB: database, Hub: hub, EmailService: emailService}
	authMW := &AuthMiddleware{DB: database}
	channelHandler := &ChannelHandler{DB: database}
	messageHandler := &MessageHandler{DB: database}
	uploadHandler := &UploadHandler{DB: database, Store: store, MaxSize: cfg.MaxUploadSize}
	uploadRL := NewIPRateLimiter(3, 30*time.Second)

	registerRL := NewIPRateLimiter(3, time.Minute)
	loginRL := NewIPRateLimiter(5, time.Minute)

	// Health check (unauthenticated — used by desktop app and login page)
	mux.HandleFunc("/api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		emailRequired, _ := emailService.IsVerificationEnabled()
		writeJSON(w, http.StatusOK, map[string]any{"app": "voicechat", "email_required": emailRequired})
	})

	verifyRL := NewIPRateLimiter(10, time.Minute)
	resendRL := NewIPRateLimiter(5, time.Minute)

	forgotRL := NewIPRateLimiter(5, time.Minute)
	resetRL := NewIPRateLimiter(10, time.Minute)

	// Auth routes
	mux.HandleFunc("/api/v1/auth/register", registerRL.Wrap(authHandler.Register))
	mux.HandleFunc("/api/v1/auth/login", loginRL.Wrap(authHandler.Login))
	mux.HandleFunc("/api/v1/auth/verify", verifyRL.Wrap(authHandler.Verify))
	mux.HandleFunc("/api/v1/auth/resend", resendRL.Wrap(authHandler.ResendCode))
	mux.HandleFunc("/api/v1/auth/forgot", forgotRL.Wrap(authHandler.ForgotPassword))
	mux.HandleFunc("/api/v1/auth/reset", resetRL.Wrap(authHandler.ResetPassword))

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

	// Auth - change password / email (authenticated)
	mux.HandleFunc("/api/v1/auth/password", authMW.Wrap(authHandler.ChangePassword))
	mux.HandleFunc("/api/v1/auth/email", authMW.Wrap(authHandler.UpdateEmail))

	// Admin routes (authenticated)
	adminHandler := &AdminHandler{DB: database, Hub: hub, EmailService: emailService, EncKey: encKey}
	mux.HandleFunc("/api/v1/admin/users", authMW.Wrap(adminHandler.ListUsers))
	mux.HandleFunc("/api/v1/admin/settings/email/test", authMW.Wrap(adminHandler.SendTestEmail))
	mux.HandleFunc("/api/v1/admin/settings/email", authMW.Wrap(adminHandler.GetEmailSettings))
	mux.HandleFunc("/api/v1/admin/settings", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			adminHandler.GetSettings(w, r)
		} else {
			adminHandler.UpdateSettings(w, r)
		}
	}))
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

	// URL unfurl preview (authenticated + rate limited)
	unfurlHandler := &UnfurlHandler{}
	unfurlRL := NewIPRateLimiter(10, 10*time.Second)
	mux.HandleFunc("/api/v1/unfurl", unfurlRL.Wrap(authMW.Wrap(unfurlHandler.Preview)))

	// Audio device management (authenticated)
	audioHandler := &AudioHandler{}
	mux.HandleFunc("/api/v1/audio/devices", authMW.Wrap(audioHandler.ListDevices))
	mux.HandleFunc("/api/v1/audio/device", authMW.Wrap(audioHandler.SetDevice))

	// Dev-mode test endpoints for email verification
	if cfg.DevMode {
		mux.HandleFunc("/api/v1/test/verification-code", func(w http.ResponseWriter, r *http.Request) {
			addr := r.URL.Query().Get("email")
			code := emailService.GetTestCode(addr)
			writeJSON(w, http.StatusOK, map[string]string{"code": code})
		})
		mux.HandleFunc("/api/v1/test/expire-verification-code", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Email string `json:"email"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			user, _ := database.GetUserByEmail(body.Email)
			if user != nil {
				database.ExpireVerificationCodeByUserID(user.ID)
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "expired"})
		})
		mux.HandleFunc("/api/v1/test/verification-code-hash", func(w http.ResponseWriter, r *http.Request) {
			addr := r.URL.Query().Get("email")
			user, _ := database.GetUserByEmail(addr)
			if user != nil {
				hash, _ := database.GetVerificationCodeHash(user.ID)
				writeJSON(w, http.StatusOK, map[string]string{"code_hash": hash})
			} else {
				writeJSON(w, http.StatusOK, map[string]string{"code_hash": ""})
			}
		})
		mux.HandleFunc("/api/v1/test/raw-setting", func(w http.ResponseWriter, r *http.Request) {
			key := r.URL.Query().Get("key")
			val, _ := database.GetSetting(key)
			writeJSON(w, http.StatusOK, map[string]string{"value": val})
		})
	}

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
