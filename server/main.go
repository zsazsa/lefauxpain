package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kalman/voicechat/api"
	"github.com/kalman/voicechat/config"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/sfu"
	"github.com/kalman/voicechat/storage"
	"github.com/kalman/voicechat/ws"
)

func main() {
	cfg := config.Parse()

	// Desktop thin-client mode: just open a window to the remote server
	if guiMode && cfg.RemoteURL != "" {
		log.Printf("Opening %s in desktop window", cfg.RemoteURL)
		runGUIRemote(cfg.RemoteURL)
		return
	}

	if err := cfg.EnsureDataDir(); err != nil {
		log.Fatalf("Failed to create data directories: %v", err)
	}

	database, err := db.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	if err := database.SeedDefaultChannels(); err != nil {
		log.Fatalf("Failed to seed default channels: %v", err)
	}

	store := storage.NewFileStore(cfg.DataDir)

	sfuInstance := sfu.New(cfg.STUNServer, cfg.PublicIP)

	hub := ws.NewHub(database, sfuInstance, cfg.DevMode)

	// Wire SFU signaling back through the hub
	sfuInstance.Signal = func(userID string, op string, data any) {
		msg, err := ws.NewMessage(op, data)
		if err != nil {
			return
		}
		hub.SendTo(userID, msg)
	}

	// When a screen share stops (explicit, connection failure, or leave voice), broadcast
	sfuInstance.OnScreenShareStopped = func(presenterID string, channelID string) {
		msg, err := ws.NewMessage("screen_share_stopped", ws.ScreenSharePayload{
			UserID:    presenterID,
			ChannelID: channelID,
		})
		if err != nil {
			return
		}
		hub.BroadcastAll(msg)
	}

	// When a peer is removed (connection failure, etc.), broadcast voice leave
	sfuInstance.OnPeerRemoved = func(userID string) {
		msg, err := ws.NewMessage("voice_state_update", ws.VoiceStatePayload{
			UserID:    userID,
			ChannelID: "",
		})
		if err != nil {
			return
		}
		hub.BroadcastAll(msg)
	}

	go hub.Run()

	// Orphaned attachment cleanup every 10 minutes
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			orphans, err := database.CleanupOrphanedAttachments()
			if err != nil {
				log.Printf("orphan cleanup error: %v", err)
				continue
			}
			for _, o := range orphans {
				store.RemoveFile(o.Path)
				if o.ThumbPath != nil {
					store.RemoveFile(*o.ThumbPath)
				}
			}
			if len(orphans) > 0 {
				log.Printf("cleaned up %d orphaned attachments", len(orphans))
			}
		}
	}()

	staticFS, err := StaticSubFS()
	if err != nil {
		log.Fatalf("Failed to load static files: %v", err)
	}

	router := api.NewRouter(cfg, database, hub, store, staticFS)

	addr := fmt.Sprintf(":%d", cfg.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	shutdown := func() {
		log.Println("Shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Fatalf("Server shutdown error: %v", err)
		}
		log.Println("Server stopped")
	}

	go func() {
		mode := "production"
		if cfg.DevMode {
			mode = "development (proxying frontend to Vite)"
		}
		if guiMode {
			mode = "desktop"
		}
		log.Printf("Server running at http://localhost%s (%s)", addr, mode)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	if guiMode {
		// Webview must run on the main thread (GTK requirement).
		// When the window closes, shut down the server.
		runGUI(addr)
		shutdown()
	} else {
		done := make(chan os.Signal, 1)
		signal.Notify(done, os.Interrupt, syscall.SIGTERM)
		<-done
		shutdown()
	}
}
