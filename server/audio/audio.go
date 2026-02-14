package audio

import (
	"bufio"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

type Device struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

// wpctl status output looks like:
//  *  231. M Series [ALSA UCM error] Direct M6 [vol: 0.69]
//      56. GA102 High Definition Audio Controller Digital Stereo (HDMI) [vol: 0.40]
var deviceRe = regexp.MustCompile(`(\*)?\s*(\d+)\.\s+(.+?)\s+\[vol:`)

// ListSources returns available audio input (source) devices.
func ListSources() ([]Device, error) {
	return listDevices("Sources")
}

// ListSinks returns available audio output (sink) devices.
func ListSinks() ([]Device, error) {
	return listDevices("Sinks")
}

func listDevices(section string) ([]Device, error) {
	out, err := exec.Command("wpctl", "status").Output()
	if err != nil {
		return nil, fmt.Errorf("wpctl status: %w", err)
	}

	var devices []Device
	inAudio := false
	inSection := false
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "Audio") {
			inAudio = true
			continue
		}
		if inAudio && !strings.HasPrefix(line, " ") && line != "" {
			// Left a top-level section (e.g. "Video")
			inAudio = false
			inSection = false
			continue
		}
		if !inAudio {
			continue
		}

		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "├─ "+section+":") || strings.HasPrefix(trimmed, "└─ "+section+":") {
			inSection = true
			continue
		}
		if inSection && (strings.HasPrefix(trimmed, "├─ ") || strings.HasPrefix(trimmed, "└─ ")) {
			// Entered a different sub-section
			inSection = false
			continue
		}

		if !inSection {
			continue
		}

		m := deviceRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		devices = append(devices, Device{
			ID:      m[2],
			Name:    strings.TrimSpace(m[3]),
			Default: m[1] == "*",
		})
	}
	return devices, nil
}

// SetDefaultSource sets the default audio input device.
func SetDefaultSource(id string) error {
	return exec.Command("wpctl", "set-default", id).Run()
}

// SetDefaultSink sets the default audio output device.
func SetDefaultSink(id string) error {
	return exec.Command("wpctl", "set-default", id).Run()
}
