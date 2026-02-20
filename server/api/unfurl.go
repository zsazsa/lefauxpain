package api

import (
	"net/http"

	"github.com/kalman/voicechat/unfurl"
)

type UnfurlHandler struct{}

func (h *UnfurlHandler) Preview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}

	// Validate it looks like a URL
	urls := unfurl.ExtractURLs(rawURL)
	if len(urls) == 0 {
		writeError(w, http.StatusBadRequest, "invalid url")
		return
	}

	results := unfurl.FetchUnfurls(urls[:1])
	if len(results) == 0 || !results[0].Success {
		writeJSON(w, http.StatusOK, map[string]any{"success": false})
		return
	}

	r0 := results[0]
	siteName := ""
	if r0.SiteName != nil {
		siteName = *r0.SiteName
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"url":         r0.URL,
		"site_name":   siteName,
		"title":       r0.Title,
		"description": r0.Description,
	})
}
