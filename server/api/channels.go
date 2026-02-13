package api

import (
	"net/http"

	"github.com/kalman/voicechat/db"
)

type ChannelHandler struct {
	DB *db.DB
}

func (h *ChannelHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	channels, err := h.DB.GetAllChannels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, channels)
}
