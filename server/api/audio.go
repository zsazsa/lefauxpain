package api

import (
	"encoding/json"
	"net/http"

	"github.com/kalman/voicechat/audio"
)

type AudioHandler struct{}

func (h *AudioHandler) ListDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sources, err := audio.ListSources()
	if err != nil {
		sources = nil
	}
	sinks, err := audio.ListSinks()
	if err != nil {
		sinks = nil
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"inputs":  sources,
		"outputs": sinks,
	})
}

func (h *AudioHandler) SetDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID   string `json:"id"`
		Kind string `json:"kind"` // "input" or "output"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	var err error
	switch req.Kind {
	case "input":
		err = audio.SetDefaultSource(req.ID)
	case "output":
		err = audio.SetDefaultSink(req.ID)
	default:
		http.Error(w, `{"error":"kind must be input or output"}`, http.StatusBadRequest)
		return
	}

	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
