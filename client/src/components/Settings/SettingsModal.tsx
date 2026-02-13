import { Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import {
  settings,
  updateSettings,
  settingsOpen,
  setSettingsOpen,
} from "../../stores/settings";
import { microphones, speakers, enumerateDevices } from "../../lib/devices";
import { applyMasterVolume, setSpeaker } from "../../lib/audio";
import { getAudioDevices, setAudioDevice } from "../../lib/api";
import { isMobile } from "../../stores/responsive";

type PwDevice = { id: string; name: string; default: boolean };

export default function SettingsModal() {
  const [testActive, setTestActive] = createSignal(false);
  const [micLevel, setMicLevel] = createSignal(0);
  const [pwInputs, setPwInputs] = createSignal<PwDevice[]>([]);
  const [pwOutputs, setPwOutputs] = createSignal<PwDevice[]>([]);
  let testStream: MediaStream | null = null;
  let testCtx: AudioContext | null = null;
  let testInterval: number | null = null;

  const fetchPwDevices = async () => {
    try {
      const data = await getAudioDevices();
      setPwInputs(data.inputs || []);
      setPwOutputs(data.outputs || []);
    } catch {
      // Server may not support audio device listing
    }
  };

  onMount(() => {
    enumerateDevices();
    fetchPwDevices();
  });

  // Apply master volume changes in real-time
  createEffect(() => {
    applyMasterVolume(settings().masterVolume);
  });

  // Apply output device changes in real-time
  createEffect(() => {
    const deviceId = settings().outputDeviceId;
    if (deviceId) {
      setSpeaker(deviceId);
    }
  });

  onCleanup(() => {
    stopTest();
  });

  const close = () => {
    stopTest();
    setSettingsOpen(false);
  };

  const handleBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  const startTest = async () => {
    const s = settings();
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: s.inputDeviceId
          ? { deviceId: { exact: s.inputDeviceId } }
          : true,
      });
    } catch {
      return;
    }
    testCtx = new AudioContext();
    if (s.outputDeviceId && "setSinkId" in testCtx) {
      (testCtx as any).setSinkId(s.outputDeviceId).catch(() => {});
    }
    const source = testCtx.createMediaStreamSource(testStream);
    const analyser = testCtx.createAnalyser();
    analyser.fftSize = 256;
    const gain = testCtx.createGain();
    gain.gain.value = s.micGain * s.masterVolume;
    source.connect(analyser);
    source.connect(gain);
    gain.connect(testCtx.destination);

    const data = new Uint8Array(analyser.fftSize);
    testInterval = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i] - 128));
      }
      setMicLevel(Math.min(peak / 128, 1));
    }, 50);

    setTestActive(true);
    enumerateDevices(); // re-enumerate now that we have permission
  };

  const stopTest = () => {
    if (testInterval !== null) {
      clearInterval(testInterval);
      testInterval = null;
    }
    if (testStream) {
      testStream.getTracks().forEach((t) => t.stop());
      testStream = null;
    }
    if (testCtx) {
      testCtx.close();
      testCtx = null;
    }
    setMicLevel(0);
    setTestActive(false);
  };

  return (
    <Show when={settingsOpen()}>
      <div
        onClick={handleBackdrop}
        style={{
          position: "fixed",
          inset: "0",
          "background-color": "rgba(0,0,0,0.6)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "1000",
        }}
      >
        <div
          style={{
            "background-color": "var(--bg-secondary)",
            "border-radius": isMobile() ? "0" : "8px",
            width: isMobile() ? "100%" : "460px",
            height: isMobile() ? "100%" : "auto",
            "max-height": isMobile() ? "100%" : "80vh",
            overflow: "auto",
            "box-shadow": isMobile() ? "none" : "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "16px 20px",
              "border-bottom": "1px solid var(--bg-primary)",
            }}
          >
            <span style={{ "font-size": "18px", "font-weight": "700" }}>
              Settings
            </span>
            <button
              onClick={close}
              style={{
                "font-size": "20px",
                color: "var(--text-muted)",
                padding: "4px 8px",
                "border-radius": "4px",
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "20px" }}>
            {/* Audio section */}
            <div
              style={{
                "font-size": "12px",
                "font-weight": "700",
                "text-transform": "uppercase",
                color: "var(--text-muted)",
                "margin-bottom": "12px",
              }}
            >
              Audio
            </div>

            {/* Master Volume */}
            <label style={labelStyle}>
              <span>Master Volume</span>
              <span style={{ color: "var(--text-muted)", "font-size": "12px" }}>
                {Math.round(settings().masterVolume * 100)}%
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="200"
              value={settings().masterVolume * 100}
              onInput={(e) =>
                updateSettings({
                  masterVolume: parseInt(e.currentTarget.value) / 100,
                })
              }
              style={sliderStyle}
            />

            {/* Mic Gain */}
            <label style={{ ...labelStyle, "margin-top": "16px" }}>
              <span>Microphone Gain</span>
              <span style={{ color: "var(--text-muted)", "font-size": "12px" }}>
                {Math.round(settings().micGain * 100)}%
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="200"
              value={settings().micGain * 100}
              onInput={(e) =>
                updateSettings({
                  micGain: parseInt(e.currentTarget.value) / 100,
                })
              }
              style={sliderStyle}
            />

            {/* Input device */}
            <label style={{ ...labelStyle, "margin-top": "16px" }}>
              Input Device
            </label>
            <Show
              when={pwInputs().length > 0}
              fallback={
                <select
                  value={settings().inputDeviceId}
                  onChange={(e) =>
                    updateSettings({ inputDeviceId: e.currentTarget.value })
                  }
                  style={selectStyle}
                >
                  <option value="">Default</option>
                  <For each={microphones()}>
                    {(mic) => (
                      <option value={mic.deviceId}>{mic.label}</option>
                    )}
                  </For>
                </select>
              }
            >
              <select
                value={pwInputs().find((d) => d.default)?.id || ""}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id) setAudioDevice(id, "input").then(fetchPwDevices);
                }}
                style={selectStyle}
              >
                <For each={pwInputs()}>
                  {(dev) => (
                    <option value={dev.id}>
                      {dev.name}{dev.default ? " (Default)" : ""}
                    </option>
                  )}
                </For>
              </select>
            </Show>

            {/* Output device */}
            <label style={{ ...labelStyle, "margin-top": "16px" }}>
              Output Device
            </label>
            <Show
              when={pwOutputs().length > 0}
              fallback={
                <select
                  value={settings().outputDeviceId}
                  onChange={(e) =>
                    updateSettings({ outputDeviceId: e.currentTarget.value })
                  }
                  style={selectStyle}
                >
                  <option value="">Default</option>
                  <For each={speakers()}>
                    {(spk) => (
                      <option value={spk.deviceId}>{spk.label}</option>
                    )}
                  </For>
                </select>
              }
            >
              <select
                value={pwOutputs().find((d) => d.default)?.id || ""}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id) setAudioDevice(id, "output").then(fetchPwDevices);
                }}
                style={selectStyle}
              >
                <For each={pwOutputs()}>
                  {(dev) => (
                    <option value={dev.id}>
                      {dev.name}{dev.default ? " (Default)" : ""}
                    </option>
                  )}
                </For>
              </select>
            </Show>

            {/* Mic Test */}
            <div style={{ "margin-top": "20px" }}>
              <button
                onClick={() => (testActive() ? stopTest() : startTest())}
                style={{
                  padding: "8px 16px",
                  "font-size": "13px",
                  "border-radius": "4px",
                  "background-color": testActive()
                    ? "var(--danger)"
                    : "var(--accent)",
                  color: "white",
                  "font-weight": "600",
                  width: "100%",
                }}
              >
                {testActive() ? "Stop Mic Test" : "Test Microphone"}
              </button>
              <Show when={testActive()}>
                <div
                  style={{
                    "margin-top": "8px",
                    height: "8px",
                    "background-color": "var(--bg-primary)",
                    "border-radius": "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${micLevel() * 100}%`,
                      "background-color":
                        micLevel() > 0.6
                          ? "var(--danger)"
                          : micLevel() > 0.3
                            ? "var(--accent)"
                            : "var(--success)",
                      "border-radius": "4px",
                      transition: "width 0.05s",
                    }}
                  />
                </div>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-muted)",
                    "margin-top": "4px",
                  }}
                >
                  Speak now — you should hear yourself through your speakers
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

const labelStyle = {
  display: "flex",
  "justify-content": "space-between",
  "align-items": "center",
  "font-size": "13px",
  color: "var(--text-primary)",
  "margin-bottom": "6px",
} as const;

const sliderStyle = {
  width: "100%",
  cursor: "pointer",
  "accent-color": "var(--accent)",
} as const;

const selectStyle = {
  width: "100%",
  padding: "8px 10px",
  "background-color": "var(--bg-primary)",
  color: "var(--text-primary)",
  border: "1px solid var(--bg-tertiary)",
  "border-radius": "4px",
  "font-size": "13px",
} as const;
