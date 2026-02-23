package ws

import (
	"encoding/json"
	"strings"
)

// AppletHandlerFunc is the signature for applet WS op handlers.
type AppletHandlerFunc func(h *Hub, c *Client, data json.RawMessage)

// AppletDef defines a self-contained applet module.
type AppletDef struct {
	Name         string                                  // e.g. "radio"
	SettingKey   string                                  // e.g. "feature:strudel" — checked before dispatch (empty = always on)
	Handlers     map[string]AppletHandlerFunc            // WS op name → handler
	ReadyContrib func(h *Hub, c *Client) map[string]any // Data merged into "ready" payload
	OnDisconnect func(h *Hub, c *Client)                // Cleanup on client disconnect
}

type appletHandler struct {
	applet  *AppletDef
	handler AppletHandlerFunc
}

// AppletRegistry holds all registered applets and dispatches ops to them.
type AppletRegistry struct {
	applets  []*AppletDef
	handlers map[string]*appletHandler // op → handler + applet ref
}

func NewAppletRegistry() *AppletRegistry {
	return &AppletRegistry{
		handlers: make(map[string]*appletHandler),
	}
}

func (r *AppletRegistry) Register(def *AppletDef) {
	r.applets = append(r.applets, def)
	for op, fn := range def.Handlers {
		r.handlers[op] = &appletHandler{applet: def, handler: fn}
	}
}

// Dispatch routes a WS op to the matching applet handler. Returns true if handled.
func (r *AppletRegistry) Dispatch(h *Hub, c *Client, op string, data json.RawMessage) bool {
	ah, ok := r.handlers[op]
	if !ok {
		return false
	}
	// Check feature gate
	if ah.applet.SettingKey != "" {
		v, _ := h.DB.GetSetting(ah.applet.SettingKey)
		if v != "1" {
			return true // Silently drop if feature disabled
		}
	}
	ah.handler(h, c, data)
	return true
}

// ContributeReady collects ready data from all enabled applets.
func (r *AppletRegistry) ContributeReady(h *Hub, c *Client) map[string]any {
	result := make(map[string]any)
	for _, def := range r.applets {
		if def.ReadyContrib == nil {
			continue
		}
		// Check feature gate
		if def.SettingKey != "" {
			v, _ := h.DB.GetSetting(def.SettingKey)
			if v != "1" {
				continue
			}
		}
		for k, v := range def.ReadyContrib(h, c) {
			result[k] = v
		}
	}
	return result
}

// OnDisconnect runs cleanup for all applets when a client disconnects.
func (r *AppletRegistry) OnDisconnect(h *Hub, c *Client) {
	for _, def := range r.applets {
		if def.OnDisconnect != nil {
			def.OnDisconnect(h, c)
		}
	}
}

// EnabledFeatures returns the list of enabled feature-gated applets.
func (r *AppletRegistry) EnabledFeatures(h *Hub) []string {
	var features []string
	for _, def := range r.applets {
		if def.SettingKey == "" {
			continue
		}
		v, _ := h.DB.GetSetting(def.SettingKey)
		if v == "1" {
			if strings.HasPrefix(def.SettingKey, "feature:") {
				features = append(features, def.SettingKey[len("feature:"):])
			}
		}
	}
	if features == nil {
		features = []string{}
	}
	return features
}

