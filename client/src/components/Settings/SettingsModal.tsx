import { Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import {
  settings,
  updateSettings,
  settingsOpen,
  setSettingsOpen,
} from "../../stores/settings";
import { microphones, speakers, enumerateDevices, desktopInputs, desktopOutputs, setDesktopDefaultDevice, refreshDesktopDevices } from "../../lib/devices";
import { applyMasterVolume, setSpeaker } from "../../lib/audio";
import { getAudioDevices, setAudioDevice, getUsers, deleteUser, setUserAdmin, setUserPassword, changePassword } from "../../lib/api";
import { currentUser } from "../../stores/auth";
import { isMobile } from "../../stores/responsive";

type PwDevice = { id: string; name: string; default: boolean };
type AdminUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
};

type Tab = "account" | "audio" | "admin";

export default function SettingsModal() {
  const [activeTab, setActiveTab] = createSignal<Tab>("account");
  const [testActive, setTestActive] = createSignal(false);
  const [micLevel, setMicLevel] = createSignal(0);
  const [pwInputs, setPwInputs] = createSignal<PwDevice[]>([]);
  const [pwOutputs, setPwOutputs] = createSignal<PwDevice[]>([]);
  const [adminUsers, setAdminUsers] = createSignal<AdminUser[]>([]);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [pwdEditUser, setPwdEditUser] = createSignal<string | null>(null);
  const [adminPwd, setAdminPwd] = createSignal("");
  const [adminPwdConfirm, setAdminPwdConfirm] = createSignal("");
  const [adminPwdError, setAdminPwdError] = createSignal("");
  const [currentPwd, setCurrentPwd] = createSignal("");
  const [newPwd, setNewPwd] = createSignal("");
  const [confirmPwd, setConfirmPwd] = createSignal("");
  const [pwdError, setPwdError] = createSignal("");
  const [pwdSuccess, setPwdSuccess] = createSignal("");
  let testStream: MediaStream | null = null;
  let testCtx: AudioContext | null = null;
  let testInterval: number | null = null;

  const [adminError, setAdminError] = createSignal("");

  const fetchAdminUsers = async () => {
    setAdminError("");
    try {
      const users = await getUsers();
      setAdminUsers(users);
    } catch (e: any) {
      setAdminError(e.message || "Failed to load users");
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (confirmDelete() !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      await deleteUser(id);
      setAdminUsers((prev) => prev.filter((u) => u.id !== id));
      setConfirmDelete(null);
    } catch {
      // Error
    }
  };

  const handleToggleAdmin = async (id: string, currentlyAdmin: boolean) => {
    try {
      await setUserAdmin(id, !currentlyAdmin);
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, is_admin: !currentlyAdmin } : u))
      );
    } catch {
      // Error
    }
  };

  const handleAdminSetPassword = async (id: string) => {
    setAdminPwdError("");
    if (adminPwd() !== adminPwdConfirm()) {
      setAdminPwdError("Passwords do not match");
      return;
    }
    try {
      await setUserPassword(id, adminPwd());
      setPwdEditUser(null);
      setAdminPwd("");
      setAdminPwdConfirm("");
    } catch (e: any) {
      setAdminPwdError(e.message || "Failed to set password");
    }
  };

  const handleChangePassword = async () => {
    setPwdError("");
    setPwdSuccess("");
    if (newPwd() !== confirmPwd()) {
      setPwdError("Passwords do not match");
      return;
    }
    try {
      await changePassword(currentPwd(), newPwd());
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setPwdSuccess("Password updated");
    } catch (e: any) {
      setPwdError(e.message || "Failed to change password");
    }
  };

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

  // Fetch admin users when admin tab is selected
  createEffect(() => {
    if (activeTab() === "admin" && currentUser()?.is_admin) {
      fetchAdminUsers();
    }
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

  const tabs = (): { id: Tab; label: string }[] => {
    const t: { id: Tab; label: string }[] = [
      { id: "account", label: "Account" },
      { id: "audio", label: "Audio" },
    ];
    if (currentUser()?.is_admin) {
      t.push({ id: "admin", label: "Admin" });
    }
    return t;
  };

  return (
    <Show when={settingsOpen()}>
      <div
        onClick={handleBackdrop}
        style={{
          position: "fixed",
          inset: "0",
          "background-color": "rgba(0,0,0,0.7)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "1000",
        }}
      >
        <div
          style={{
            "background-color": "var(--bg-secondary)",
            border: isMobile() ? "none" : "1px solid var(--border-gold)",
            width: isMobile() ? "100%" : "600px",
            height: isMobile() ? "100%" : "70vh",
            display: "flex",
            "flex-direction": "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "14px 20px",
              "border-bottom": "1px solid var(--border-gold)",
              "flex-shrink": "0",
            }}
          >
            <span style={{
              "font-family": "var(--font-display)",
              "font-size": "16px",
              "font-weight": "600",
              color: "var(--accent)",
              "letter-spacing": "1px",
            }}>
              {"\u2699"} Param\u00e8tres
            </span>
            <button
              onClick={close}
              style={{
                "font-size": "12px",
                color: "var(--text-muted)",
                padding: "2px 6px",
              }}
            >
              [x]
            </button>
          </div>

          {/* Body: sidebar + content */}
          <div
            style={{
              display: "flex",
              flex: "1",
              "min-height": "0",
              overflow: "hidden",
            }}
          >
            {/* Sidebar */}
            <div
              style={{
                width: isMobile() ? "120px" : "140px",
                "border-right": "1px solid var(--border-gold)",
                padding: "12px 0",
                "flex-shrink": "0",
              }}
            >
              <For each={tabs()}>
                {(tab) => (
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 16px",
                      "text-align": "left",
                      "font-size": "12px",
                      "font-weight": activeTab() === tab.id ? "600" : "400",
                      color: activeTab() === tab.id ? "var(--accent)" : "var(--text-secondary)",
                      "background-color": activeTab() === tab.id ? "var(--accent-glow)" : "transparent",
                      border: "none",
                      "border-left": activeTab() === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                      cursor: "pointer",
                      "letter-spacing": "1px",
                      "font-family": "var(--font-display)",
                      "text-transform": "uppercase",
                    }}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </div>

            {/* Content */}
            <div
              style={{
                flex: "1",
                padding: "20px",
                overflow: "auto",
              }}
            >
              {/* Account tab */}
              <Show when={activeTab() === "account"}>
                <div style={sectionHeaderStyle}>Password</div>

                <Show when={currentUser()?.has_password}>
                  <label style={labelStyle}>Current Password</label>
                  <input
                    type="password"
                    value={currentPwd()}
                    onInput={(e) => setCurrentPwd(e.currentTarget.value)}
                    style={inputStyle}
                  />
                  <div style={{ height: "10px" }} />
                </Show>

                <label style={labelStyle}>New Password</label>
                <input
                  type="password"
                  value={newPwd()}
                  onInput={(e) => setNewPwd(e.currentTarget.value)}
                  style={inputStyle}
                />

                <div style={{ height: "10px" }} />
                <label style={labelStyle}>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPwd()}
                  onInput={(e) => setConfirmPwd(e.currentTarget.value)}
                  style={inputStyle}
                />

                {pwdError() && (
                  <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "6px" }}>
                    {pwdError()}
                  </div>
                )}
                {pwdSuccess() && (
                  <div style={{ color: "var(--success)", "font-size": "11px", "margin-top": "6px" }}>
                    {pwdSuccess()}
                  </div>
                )}

                <button
                  onClick={handleChangePassword}
                  style={{
                    "margin-top": "12px",
                    ...actionBtnStyle,
                    width: "100%",
                  }}
                >
                  [change password]
                </button>
              </Show>

              {/* Audio tab */}
              <Show when={activeTab() === "audio"}>
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
                {() => {
                  // Desktop Tauri: local wpctl devices
                  if (desktopInputs().length > 0) {
                    return (
                      <select
                        value={desktopInputs().find((d) => d.default)?.id || ""}
                        onChange={(e) => {
                          const id = e.currentTarget.value;
                          if (id) setDesktopDefaultDevice(id).then(() => refreshDesktopDevices());
                        }}
                        style={selectStyle}
                      >
                        <For each={desktopInputs()}>
                          {(dev) => (
                            <option value={dev.id}>
                              {dev.name}{dev.default ? " (Default)" : ""}
                            </option>
                          )}
                        </For>
                      </select>
                    );
                  }
                  // Server PipeWire devices
                  if (pwInputs().length > 0) {
                    return (
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
                    );
                  }
                  // Browser fallback
                  return (
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
                  );
                }}

                {/* Output device */}
                <label style={{ ...labelStyle, "margin-top": "16px" }}>
                  Output Device
                </label>
                {() => {
                  // Desktop Tauri: local wpctl devices
                  if (desktopOutputs().length > 0) {
                    return (
                      <select
                        value={desktopOutputs().find((d) => d.default)?.id || ""}
                        onChange={(e) => {
                          const id = e.currentTarget.value;
                          if (id) setDesktopDefaultDevice(id).then(() => refreshDesktopDevices());
                        }}
                        style={selectStyle}
                      >
                        <For each={desktopOutputs()}>
                          {(dev) => (
                            <option value={dev.id}>
                              {dev.name}{dev.default ? " (Default)" : ""}
                            </option>
                          )}
                        </For>
                      </select>
                    );
                  }
                  // Server PipeWire devices
                  if (pwOutputs().length > 0) {
                    return (
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
                    );
                  }
                  // Browser fallback
                  return (
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
                  );
                }}

                {/* Mic Test */}
                <div style={{ "margin-top": "20px" }}>
                  <button
                    onClick={() => (testActive() ? stopTest() : startTest())}
                    style={{
                      padding: "6px 16px",
                      "font-size": "12px",
                      border: testActive()
                        ? "1px solid var(--danger)"
                        : "1px solid var(--accent)",
                      "background-color": testActive()
                        ? "rgba(232,64,64,0.15)"
                        : "var(--accent-glow)",
                      color: testActive() ? "var(--danger)" : "var(--accent)",
                      "font-weight": "600",
                      width: "100%",
                    }}
                  >
                    {testActive() ? "[stop mic test]" : "[test microphone]"}
                  </button>
                  <Show when={testActive()}>
                    <div
                      style={{
                        "margin-top": "8px",
                        height: "6px",
                        "background-color": "var(--bg-primary)",
                        border: "1px solid var(--border-gold)",
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
              </Show>

              {/* Admin tab */}
              <Show when={activeTab() === "admin" && currentUser()?.is_admin}>
                <div style={sectionHeaderStyle}>Users</div>

                {adminError() && (
                  <div style={{ color: "var(--danger)", "font-size": "11px", "margin-bottom": "8px" }}>
                    {adminError()}
                  </div>
                )}

                <Show when={!adminError() && adminUsers().length === 0}>
                  <div style={{ color: "var(--text-muted)", "font-size": "12px" }}>Loading...</div>
                </Show>

                <For each={adminUsers()}>
                  {(user) => {
                    const isSelf = () => user.id === currentUser()?.id;
                    return (
                      <div style={{ "border-bottom": "1px solid rgba(201,168,76,0.1)" }}>
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "space-between",
                            padding: "6px 0",
                          }}
                        >
                          <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": "0" }}>
                            <span style={{ "font-size": "12px", color: "var(--text-primary)" }}>
                              {user.username}
                            </span>
                            <Show when={user.is_admin}>
                              <span
                                style={{
                                  "font-size": "10px",
                                  color: "var(--accent)",
                                  border: "1px solid var(--accent)",
                                  padding: "0 4px",
                                  "line-height": "1.4",
                                }}
                              >
                                admin
                              </span>
                            </Show>
                          </div>
                          <Show when={!isSelf()}>
                            <div style={{ display: "flex", gap: "4px", "flex-shrink": "0" }}>
                              <button
                                onClick={() => {
                                  if (pwdEditUser() === user.id) {
                                    setPwdEditUser(null);
                                    setAdminPwd("");
                                    setAdminPwdConfirm("");
                                    setAdminPwdError("");
                                  } else {
                                    setPwdEditUser(user.id);
                                    setAdminPwd("");
                                    setAdminPwdConfirm("");
                                    setAdminPwdError("");
                                  }
                                }}
                                style={{
                                  "font-size": "11px",
                                  padding: "2px 6px",
                                  color: pwdEditUser() === user.id ? "var(--text-muted)" : "var(--cyan)",
                                  border: `1px solid ${pwdEditUser() === user.id ? "var(--text-muted)" : "var(--cyan)"}`,
                                  "background-color": "transparent",
                                }}
                                title="Set password"
                              >
                                {pwdEditUser() === user.id ? "[cancel]" : "[set pwd]"}
                              </button>
                              <button
                                onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                                style={{
                                  "font-size": "11px",
                                  padding: "2px 6px",
                                  color: user.is_admin ? "var(--text-muted)" : "var(--accent)",
                                  border: `1px solid ${user.is_admin ? "var(--text-muted)" : "var(--accent)"}`,
                                  "background-color": "transparent",
                                }}
                                title={user.is_admin ? "Remove admin" : "Make admin"}
                              >
                                {user.is_admin ? "[demote]" : "[promote]"}
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                style={{
                                  "font-size": "11px",
                                  padding: "2px 6px",
                                  color: confirmDelete() === user.id ? "#fff" : "var(--danger)",
                                  border: "1px solid var(--danger)",
                                  "background-color":
                                    confirmDelete() === user.id
                                      ? "var(--danger)"
                                      : "transparent",
                                }}
                              >
                                {confirmDelete() === user.id ? "[confirm]" : "[delete]"}
                              </button>
                            </div>
                          </Show>
                          <Show when={isSelf()}>
                            <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
                              (you)
                            </span>
                          </Show>
                        </div>
                        <Show when={pwdEditUser() === user.id}>
                          <div style={{ padding: "4px 0 8px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                            <input
                              type="password"
                              placeholder="New password (empty = remove)"
                              value={adminPwd()}
                              onInput={(e) => setAdminPwd(e.currentTarget.value)}
                              style={inputStyle}
                            />
                            <input
                              type="password"
                              placeholder="Confirm password"
                              value={adminPwdConfirm()}
                              onInput={(e) => setAdminPwdConfirm(e.currentTarget.value)}
                              style={inputStyle}
                            />
                            {adminPwdError() && (
                              <div style={{ color: "var(--danger)", "font-size": "11px" }}>
                                {adminPwdError()}
                              </div>
                            )}
                            <button
                              onClick={() => handleAdminSetPassword(user.id)}
                              style={{
                                padding: "4px 12px",
                                ...actionBtnStyle,
                              }}
                            >
                              [save]
                            </button>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

const sectionHeaderStyle = {
  "font-family": "var(--font-display)",
  "font-size": "11px",
  "font-weight": "600",
  "text-transform": "uppercase",
  "letter-spacing": "2px",
  color: "var(--text-muted)",
  "margin-bottom": "12px",
} as const;

const labelStyle = {
  display: "flex",
  "justify-content": "space-between",
  "align-items": "center",
  "font-size": "12px",
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
  padding: "6px 10px",
  "background-color": "#1a1a2e",
  color: "var(--text-primary)",
  border: "1px solid rgba(201, 168, 76, 0.4)",
  "font-size": "12px",
} as const;

const inputStyle = {
  width: "100%",
  padding: "6px 10px",
  "background-color": "#1a1a2e",
  color: "var(--text-primary)",
  border: "1px solid rgba(201, 168, 76, 0.4)",
  "font-size": "12px",
} as const;

const actionBtnStyle = {
  "font-size": "12px",
  border: "1px solid var(--accent)",
  "background-color": "var(--accent-glow)",
  color: "var(--accent)",
  "font-weight": "600",
  padding: "6px 16px",
} as const;
