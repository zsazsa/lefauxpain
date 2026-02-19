import { Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import {
  settings,
  updateSettings,
  settingsOpen,
  setSettingsOpen,
  settingsTab,
  setSettingsTab,
} from "../../stores/settings";
import { microphones, speakers, enumerateDevices, desktopInputs, desktopOutputs, setDesktopDefaultDevice, isDesktop, isTauri } from "../../lib/devices";
import { applyMasterVolume, setSpeaker } from "../../lib/audio";
import { muteChannelMic, unmuteChannelMic } from "../../lib/webrtc";
import { getAudioDevices, setAudioDevice, getUsers, deleteUser, setUserAdmin, setUserPassword, changePassword, approveUser, getEmailSettings, saveEmailSettings, sendTestEmail } from "../../lib/api";
import { currentUser } from "../../stores/auth";
import { allUsers, removeAllUser } from "../../stores/users";
import { isMobile } from "../../stores/responsive";
import {
  updateStatus, updateVersion, updateBody, updateProgress, updateError,
  checkForUpdates, downloadAndInstall, relaunchApp, appVersion,
} from "../../stores/updateChecker";
import { theme, setTheme, themes, t, ThemeId } from "../../stores/theme";
import { deletedChannels } from "../../stores/channels";
import { send } from "../../lib/ws";
import { APPLETS, isAppletEnabled, toggleApplet } from "../../stores/applets";

type PwDevice = { id: string; name: string; default: boolean };
type AdminUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
  approved: boolean;
  knock_message: string | null;
  created_at: string;
};

type Tab = "account" | "display" | "audio" | "admin" | "email" | "app" | "about";

export default function SettingsModal() {
  const [activeTab, setActiveTab] = createSignal<Tab>("account");

  // Allow external code to open settings to a specific tab
  createEffect(() => {
    const tab = settingsTab();
    if (tab && settingsOpen()) {
      setActiveTab(tab as Tab);
      setSettingsTab(null);
    }
  });
  type TestPhase = "idle" | "recording" | "playing";
  const [testPhase, setTestPhase] = createSignal<TestPhase>("idle");
  const [micLevel, setMicLevel] = createSignal(0);
  const [recordCountdown, setRecordCountdown] = createSignal(5);
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
  let pcmChunks: Float32Array[] = [];
  let countdownTimer: number | null = null;
  let scriptNode: ScriptProcessorNode | null = null;

  const [adminError, setAdminError] = createSignal("");
  const [selectedPwInput, setSelectedPwInput] = createSignal(localStorage.getItem("pw_input_device") || "");
  const [selectedPwOutput, setSelectedPwOutput] = createSignal(localStorage.getItem("pw_output_device") || "");

  // Email settings state
  const [emailProvider, setEmailProvider] = createSignal<"postmark" | "smtp">("postmark");
  const [emailApiKey, setEmailApiKey] = createSignal("");
  const [emailApiKeyMasked, setEmailApiKeyMasked] = createSignal("");
  const [emailApiKeyChanged, setEmailApiKeyChanged] = createSignal(false);
  const [emailFromEmail, setEmailFromEmail] = createSignal("");
  const [emailFromName, setEmailFromName] = createSignal("");
  const [smtpHost, setSmtpHost] = createSignal("");
  const [smtpPort, setSmtpPort] = createSignal("587");
  const [smtpUsername, setSmtpUsername] = createSignal("");
  const [smtpPassword, setSmtpPassword] = createSignal("");
  const [smtpPasswordMasked, setSmtpPasswordMasked] = createSignal("");
  const [smtpPasswordChanged, setSmtpPasswordChanged] = createSignal(false);
  const [smtpEncryption, setSmtpEncryption] = createSignal("starttls");
  const [emailVerifyEnabled, setEmailVerifyEnabled] = createSignal(false);
  const [emailConfigured, setEmailConfigured] = createSignal(false);
  const [emailSaving, setEmailSaving] = createSignal(false);
  const [emailSaveMsg, setEmailSaveMsg] = createSignal("");
  const [emailSaveError, setEmailSaveError] = createSignal("");
  const [emailTesting, setEmailTesting] = createSignal(false);
  const [emailTestPhase, setEmailTestPhase] = createSignal("idle");
  const [emailTestMsg, setEmailTestMsg] = createSignal("");
  const [emailValidErrors, setEmailValidErrors] = createSignal<Record<string, string>>({});

  const fetchAdminUsers = async () => {
    setAdminError("");
    try {
      const users = await getUsers();
      setAdminUsers(users);
    } catch (e: any) {
      setAdminError(e.message || "Failed to load users");
    }
  };

  const pendingUsers = () => adminUsers().filter((u) => !u.approved);
  const approvedUsers = () => adminUsers().filter((u) => u.approved);

  const handleApproveUser = async (id: string) => {
    try {
      await approveUser(id);
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, approved: true } : u))
      );
    } catch {
      // Error
    }
  };

  const handleRejectUser = async (id: string) => {
    try {
      await deleteUser(id);
      setAdminUsers((prev) => prev.filter((u) => u.id !== id));
    } catch {
      // Error
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
      removeAllUser(id);
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

  const fetchEmailSettings = async () => {
    try {
      const data = await getEmailSettings();
      setEmailVerifyEnabled(data.email_verification_enabled);
      setEmailConfigured(data.is_configured);
      if (data.is_configured && data.provider) {
        setEmailProvider(data.provider as "postmark" | "smtp");
        setEmailFromEmail(data.from_email || "");
        setEmailFromName(data.from_name || "");
        if (data.provider === "postmark" || data.provider === "test") {
          setEmailApiKeyMasked(data.api_key_masked || "");
          setEmailApiKey(data.api_key_masked || "");
          setEmailApiKeyChanged(false);
        } else if (data.provider === "smtp") {
          setSmtpHost(data.host || "");
          setSmtpPort(data.port?.toString() || "587");
          setSmtpUsername(data.username || "");
          setSmtpPasswordMasked(data.password_masked || "");
          setSmtpPassword(data.password_masked || "");
          setSmtpPasswordChanged(false);
          setSmtpEncryption(data.encryption || "starttls");
        }
      } else {
        setEmailProvider("postmark");
        setEmailFromEmail("");
        setEmailFromName("");
        setEmailApiKey("");
        setEmailApiKeyMasked("");
        setEmailApiKeyChanged(false);
        setSmtpHost("");
        setSmtpPort("587");
        setSmtpUsername("");
        setSmtpPassword("");
        setSmtpPasswordMasked("");
        setSmtpPasswordChanged(false);
        setSmtpEncryption("starttls");
      }
    } catch {
      // Error loading email settings
    }
  };

  const clearEmailForm = () => {
    setEmailFromEmail("");
    setEmailFromName("");
    setEmailApiKey("");
    setEmailApiKeyMasked("");
    setEmailApiKeyChanged(false);
    setSmtpHost("");
    setSmtpPort("587");
    setSmtpUsername("");
    setSmtpPassword("");
    setSmtpPasswordMasked("");
    setSmtpPasswordChanged(false);
    setSmtpEncryption("starttls");
    setEmailValidErrors({});
    setEmailSaveMsg("");
    setEmailSaveError("");
    setEmailConfigured(false);
  };

  const validateEmailForm = (): boolean => {
    const errors: Record<string, string> = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailProvider() === "postmark") {
      if (!emailApiKey()) errors.api_key = "API key is required";
      if (!emailFromEmail()) errors.from_email = "From email is required";
      else if (!emailRe.test(emailFromEmail())) errors.from_email = "Must be a valid email address";
      if (!emailFromName()) errors.from_name = "From name is required";
    } else {
      if (!smtpHost()) errors.host = "Host is required";
      if (!smtpPort()) errors.port = "Port is required";
      else if (!/^\d+$/.test(smtpPort())) errors.port = "Port must be a number";
      if (!smtpUsername()) errors.username = "Username is required";
      if (!smtpPassword()) errors.password = "Password is required";
      if (!smtpEncryption()) errors.encryption = "Encryption is required";
      if (!emailFromEmail()) errors.from_email = "From email is required";
      else if (!emailRe.test(emailFromEmail())) errors.from_email = "Must be a valid email address";
      if (!emailFromName()) errors.from_name = "From name is required";
    }

    setEmailValidErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveEmail = async () => {
    if (!validateEmailForm()) return;

    setEmailSaving(true);
    setEmailSaveMsg("");
    setEmailSaveError("");

    const config: Record<string, unknown> = {
      provider: emailProvider(),
      from_email: emailFromEmail(),
      from_name: emailFromName(),
    };

    if (emailProvider() === "postmark") {
      config.api_key = emailApiKeyChanged() ? emailApiKey() : emailApiKeyMasked();
    } else {
      config.host = smtpHost();
      config.port = parseInt(smtpPort());
      config.username = smtpUsername();
      config.password = smtpPasswordChanged() ? smtpPassword() : smtpPasswordMasked();
      config.encryption = smtpEncryption();
    }

    try {
      await saveEmailSettings({ email_provider_config: config });
      setEmailSaveMsg("> SETTINGS SAVED");
      setEmailConfigured(true);
      // Re-fetch to get masked values
      await fetchEmailSettings();
    } catch (e: any) {
      setEmailSaveError(e.message || "Failed to save settings");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleToggleVerification = async () => {
    const newVal = !emailVerifyEnabled();
    if (newVal && !emailConfigured()) {
      setEmailSaveError("Configure an email provider before enabling verification");
      return;
    }

    setEmailSaving(true);
    setEmailSaveError("");
    setEmailSaveMsg("");

    try {
      await saveEmailSettings({ email_verification_enabled: newVal });
      setEmailVerifyEnabled(newVal);
      setEmailSaveMsg(newVal ? "> VERIFICATION ENABLED" : "> VERIFICATION DISABLED");
    } catch (e: any) {
      setEmailSaveError(e.message || "Failed to toggle verification");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setEmailTesting(true);
    setEmailTestPhase("connecting");
    setEmailTestMsg("");

    setTimeout(() => {
      if (emailTesting()) setEmailTestPhase("sending");
    }, 500);

    try {
      const result = await sendTestEmail();
      setEmailTestPhase("done");
      setEmailTestMsg(`> DELIVERED — test email sent to ${result.email}`);
    } catch (e: any) {
      setEmailTestPhase("error");
      setEmailTestMsg(`> FAILED: ${e.message || "unknown error"}`);
    } finally {
      setEmailTesting(false);
    }
  };

  onMount(() => {
    enumerateDevices();
    fetchPwDevices();
  });

  // Re-enumerate devices when audio tab is selected (triggers permission grant)
  createEffect(() => {
    if (activeTab() === "audio" && !isDesktop) {
      // Request mic permission briefly to unlock full device labels
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
          enumerateDevices();
        })
        .catch(() => {});
    }
  });

  // Fetch admin users when admin tab is selected or settings reopened
  createEffect(() => {
    const open = settingsOpen();
    if (open && activeTab() === "admin" && currentUser()?.is_admin) {
      fetchAdminUsers();
    }
  });

  // Fetch email settings when email tab is selected
  createEffect(() => {
    const open = settingsOpen();
    if (open && activeTab() === "email" && currentUser()?.is_admin) {
      fetchEmailSettings();
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
    muteChannelMic();
    const s = settings();
    const audioConstraint = (s.inputDeviceId && !isDesktop)
      ? { deviceId: { exact: s.inputDeviceId } } as MediaTrackConstraints
      : true;
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
    } catch {
      unmuteChannelMic();
      return;
    }

    testCtx = new AudioContext();
    const source = testCtx.createMediaStreamSource(testStream);

    // Level meter via AnalyserNode
    const analyser = testCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    testInterval = window.setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      setMicLevel(Math.min(Math.sqrt(sumSq / data.length) * 5, 1));
    }, 50);

    // Record raw PCM via ScriptProcessorNode (bypasses broken MediaRecorder in WebKit2GTK)
    pcmChunks = [];
    scriptNode = testCtx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(scriptNode);
    scriptNode.connect(testCtx.destination); // must connect to destination for processing to run

    setTestPhase("recording");
    setRecordCountdown(5);

    // Countdown — stop after 5 seconds and play back
    let remaining = 5;
    countdownTimer = window.setInterval(() => {
      remaining--;
      setRecordCountdown(remaining);
      if (remaining <= 0) {
        if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; }
        finishRecording();
      }
    }, 1000);
  };

  const finishRecording = () => {
    // Stop level meter
    if (testInterval !== null) { clearInterval(testInterval); testInterval = null; }
    // Disconnect script node
    if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
    // Stop mic
    if (testStream) { testStream.getTracks().forEach((t) => t.stop()); testStream = null; }
    setMicLevel(0);

    if (pcmChunks.length === 0 || !testCtx) {
      if (testCtx) { testCtx.close(); testCtx = null; }
      setTestPhase("idle");
      return;
    }

    // Build AudioBuffer from recorded PCM
    const sampleRate = testCtx.sampleRate;
    const totalLength = pcmChunks.reduce((sum, c) => sum + c.length, 0);
    const playCtx = new AudioContext({ sampleRate });
    const audioBuffer = playCtx.createBuffer(1, totalLength, sampleRate);
    const channel = audioBuffer.getChannelData(0);
    let offset = 0;
    for (const chunk of pcmChunks) {
      channel.set(chunk, offset);
      offset += chunk.length;
    }
    pcmChunks = [];

    // Close recording context, play via new context
    testCtx.close();
    testCtx = playCtx;

    const bufSource = playCtx.createBufferSource();
    bufSource.buffer = audioBuffer;
    bufSource.connect(playCtx.destination);
    setTestPhase("playing");
    bufSource.onended = () => {
      playCtx.close();
      if (testCtx === playCtx) testCtx = null;
      setTestPhase("idle");
      unmuteChannelMic();
    };
    bufSource.start();
  };

  const stopTest = () => {
    if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; }
    if (testInterval !== null) { clearInterval(testInterval); testInterval = null; }
    if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
    pcmChunks = [];
    if (testStream) { testStream.getTracks().forEach((t) => t.stop()); testStream = null; }
    if (testCtx) { testCtx.close(); testCtx = null; }
    setMicLevel(0);
    setTestPhase("idle");
    unmuteChannelMic();
  };

  const tabs = (): { id: Tab; label: string }[] => {
    const list: { id: Tab; label: string }[] = [
      { id: "account", label: "Account" },
      { id: "display", label: "Display" },
      { id: "audio", label: "Audio" },
    ];
    if (currentUser()?.is_admin) {
      list.push({ id: "admin", label: "Admin" });
      list.push({ id: "email", label: "Email" });
    }
    if (isTauri) {
      list.push({ id: "app", label: "App" });
    }
    list.push({ id: "about", label: "About" });
    return list;
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
              {"\u2699"} {t("settings")}
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

              {/* Display tab */}
              <Show when={activeTab() === "display"}>
                <div style={sectionHeaderStyle}>Theme</div>
                <label style={labelStyle}>Color & Language</label>
                <select
                  value={theme()}
                  onChange={(e) => setTheme(e.currentTarget.value as ThemeId)}
                  style={selectStyle}
                >
                  <optgroup label="French">
                    <option value="french-gold">{themes["french-gold"].name}</option>
                    <option value="french-cyan">{themes["french-cyan"].name}</option>
                    <option value="french-green">{themes["french-green"].name}</option>
                  </optgroup>
                  <optgroup label="English">
                    <option value="english-gold">{themes["english-gold"].name}</option>
                    <option value="english-cyan">{themes["english-cyan"].name}</option>
                    <option value="english-green">{themes["english-green"].name}</option>
                  </optgroup>
                </select>

                <div style={{ ...sectionHeaderStyle, "margin-top": "20px" }}>Sidebar Applets</div>
                <For each={APPLETS}>
                  {(applet) => (
                    <label
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        padding: "6px 0",
                        "font-size": "12px",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isAppletEnabled(applet.id)}
                        onChange={() => toggleApplet(applet.id)}
                        style={{ "accent-color": "var(--accent)" }}
                      />
                      {applet.name}
                    </label>
                  )}
                </For>
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
                <Show when={desktopInputs().length > 0}>
                  <select
                    value={selectedPwInput() && desktopInputs().some((d) => d.id === selectedPwInput())
                      ? selectedPwInput()
                      : desktopInputs().find((d) => d.default)?.id || ""}
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      if (id) {
                        setSelectedPwInput(id);
                        localStorage.setItem("pw_input_device", id);
                        setDesktopDefaultDevice(id);
                      }
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
                </Show>
                <Show when={desktopInputs().length === 0 && pwInputs().length > 0}>
                  <select
                    value={selectedPwInput() && pwInputs().some((d) => d.id === selectedPwInput())
                      ? selectedPwInput()
                      : pwInputs().find((d) => d.default)?.id || ""}
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      if (id) {
                        setSelectedPwInput(id);
                        localStorage.setItem("pw_input_device", id);
                        setAudioDevice(id, "input");
                      }
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
                <Show when={desktopInputs().length === 0 && pwInputs().length === 0}>
                  {(() => {
                    const inputVal = () => {
                      const stored = settings().inputDeviceId;
                      if (stored && microphones().some((m) => m.deviceId === stored)) return stored;
                      return "";
                    };
                    return (
                      <select
                        value={inputVal()}
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
                  })()}
                </Show>

                {/* Output device */}
                <label style={{ ...labelStyle, "margin-top": "16px" }}>
                  Output Device
                </label>
                <Show when={desktopOutputs().length > 0}>
                  <select
                    value={selectedPwOutput() && desktopOutputs().some((d) => d.id === selectedPwOutput())
                      ? selectedPwOutput()
                      : desktopOutputs().find((d) => d.default)?.id || ""}
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      if (id) {
                        setSelectedPwOutput(id);
                        localStorage.setItem("pw_output_device", id);
                        setDesktopDefaultDevice(id);
                      }
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
                </Show>
                <Show when={desktopOutputs().length === 0 && pwOutputs().length > 0}>
                  <select
                    value={selectedPwOutput() && pwOutputs().some((d) => d.id === selectedPwOutput())
                      ? selectedPwOutput()
                      : pwOutputs().find((d) => d.default)?.id || ""}
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      if (id) {
                        setSelectedPwOutput(id);
                        localStorage.setItem("pw_output_device", id);
                        setAudioDevice(id, "output");
                      }
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
                <Show when={desktopOutputs().length === 0 && pwOutputs().length === 0}>
                  {(() => {
                    const outputVal = () => {
                      const stored = settings().outputDeviceId;
                      if (stored && speakers().some((s) => s.deviceId === stored)) return stored;
                      return "";
                    };
                    return (
                      <select
                        value={outputVal()}
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
                  })()}
                </Show>

                {/* Mic Test */}
                <div style={{ "margin-top": "20px" }}>
                  <button
                    onClick={() => (testPhase() !== "idle" ? stopTest() : startTest())}
                    disabled={testPhase() === "playing"}
                    style={{
                      padding: "6px 16px",
                      "font-size": "12px",
                      border: testPhase() !== "idle"
                        ? "1px solid var(--danger)"
                        : "1px solid var(--accent)",
                      "background-color": testPhase() !== "idle"
                        ? "rgba(232,64,64,0.15)"
                        : "var(--accent-glow)",
                      color: testPhase() !== "idle" ? "var(--danger)" : "var(--accent)",
                      "font-weight": "600",
                      width: "100%",
                      opacity: testPhase() === "playing" ? "0.6" : "1",
                    }}
                  >
                    {testPhase() === "recording"
                      ? `[recording... ${recordCountdown()}s]`
                      : testPhase() === "playing"
                        ? "[playing back...]"
                        : "[test microphone]"}
                  </button>
                  <Show when={testPhase() === "recording"}>
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
                      Speak now — recording for {recordCountdown()} seconds...
                    </div>
                  </Show>
                  <Show when={testPhase() === "playing"}>
                    <div
                      style={{
                        "font-size": "11px",
                        color: "var(--accent)",
                        "margin-top": "8px",
                      }}
                    >
                      Playing back your recording...
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Admin tab */}
              <Show when={activeTab() === "admin" && currentUser()?.is_admin}>
                {adminError() && (
                  <div style={{ color: "var(--danger)", "font-size": "11px", "margin-bottom": "8px" }}>
                    {adminError()}
                  </div>
                )}

                <Show when={!adminError() && adminUsers().length === 0}>
                  <div style={{ color: "var(--text-muted)", "font-size": "12px" }}>Loading...</div>
                </Show>

                {/* Pending section */}
                <Show when={pendingUsers().length > 0}>
                  <div style={sectionHeaderStyle}>Pending</div>
                  <For each={pendingUsers()}>
                    {(user) => (
                      <div style={{ "border-bottom": "1px solid rgba(201,168,76,0.1)", padding: "8px 0" }}>
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "space-between",
                          }}
                        >
                          <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": "0" }}>
                            <span style={{ "font-size": "12px", color: "var(--text-primary)" }}>
                              {user.username}
                            </span>
                            <span
                              style={{
                                "font-size": "10px",
                                color: "var(--text-muted)",
                              }}
                            >
                              {new Date(user.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "4px", "flex-shrink": "0" }}>
                            <button
                              onClick={() => handleApproveUser(user.id)}
                              style={{
                                "font-size": "11px",
                                padding: "2px 6px",
                                color: "var(--success)",
                                border: "1px solid var(--success)",
                                "background-color": "transparent",
                              }}
                            >
                              [approve]
                            </button>
                            <button
                              onClick={() => handleRejectUser(user.id)}
                              style={{
                                "font-size": "11px",
                                padding: "2px 6px",
                                color: "var(--danger)",
                                border: "1px solid var(--danger)",
                                "background-color": "transparent",
                              }}
                            >
                              [reject]
                            </button>
                          </div>
                        </div>
                        <Show when={user.knock_message}>
                          <div
                            style={{
                              "margin-top": "4px",
                              padding: "6px 8px",
                              "background-color": "var(--bg-primary)",
                              border: "1px solid rgba(201,168,76,0.15)",
                              "font-size": "12px",
                              color: "var(--text-secondary)",
                              "font-style": "italic",
                              "white-space": "pre-wrap",
                              "word-break": "break-word",
                            }}
                          >
                            {user.knock_message}
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                  <div style={{ height: "16px" }} />
                </Show>

                <div style={sectionHeaderStyle}>Users</div>

                <For each={approvedUsers()}>
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

                {/* Archived Channels */}
                <Show when={deletedChannels().length > 0}>
                  <div style={{ ...sectionHeaderStyle, "margin-top": "20px" }}>Archived Channels</div>
                  <For each={deletedChannels()}>
                    {(ch) => (
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "space-between",
                          padding: "6px 0",
                          "border-bottom": "1px solid rgba(201,168,76,0.1)",
                        }}
                      >
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <span style={{
                            "font-size": "14px",
                            color: ch.type === "voice" ? "var(--success)" : "var(--accent)",
                          }}>
                            {ch.type === "voice" ? "\u23E3" : "#"}
                          </span>
                          <span style={{ "font-size": "12px", color: "var(--text-secondary)" }}>
                            {ch.name}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            send("restore_channel", { channel_id: ch.id });
                          }}
                          style={{
                            "font-size": "11px",
                            padding: "2px 6px",
                            color: "var(--success)",
                            border: "1px solid var(--success)",
                            "background-color": "transparent",
                          }}
                        >
                          [restore]
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>

              {/* Email tab */}
              <Show when={activeTab() === "email" && currentUser()?.is_admin}>
                {/* Email Verification Toggle */}
                <div style={sectionHeaderStyle}>Email Verification</div>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}>
                  <span style={{ "font-size": "12px", color: "var(--text-primary)" }}>
                    Require email verification
                  </span>
                  <button
                    onClick={handleToggleVerification}
                    disabled={emailSaving()}
                    style={{
                      "font-size": "11px",
                      padding: "2px 8px",
                      border: `1px solid ${emailVerifyEnabled() ? "var(--success)" : "var(--text-muted)"}`,
                      "background-color": emailVerifyEnabled() ? "rgba(76,175,80,0.15)" : "transparent",
                      color: emailVerifyEnabled() ? "var(--success)" : "var(--text-muted)",
                      "font-weight": "600",
                      cursor: emailSaving() ? "wait" : "pointer",
                      opacity: emailSaving() ? "0.6" : "1",
                    }}
                  >
                    {emailVerifyEnabled() ? "[on]" : "[off]"}
                  </button>
                </div>

                {/* Provider Selection */}
                <div style={sectionHeaderStyle}>Provider</div>
                <select
                  value={emailProvider()}
                  onChange={(e) => {
                    setEmailProvider(e.currentTarget.value as "postmark" | "smtp");
                    clearEmailForm();
                  }}
                  style={{ ...selectStyle, "margin-bottom": "16px" }}
                >
                  <option value="postmark">Postmark</option>
                  <option value="smtp">SMTP</option>
                </select>

                {/* Postmark Fields */}
                <Show when={emailProvider() === "postmark"}>
                  <div style={sectionHeaderStyle}>Postmark Configuration</div>

                  <label style={labelStyle}>API Key (Server Token)</label>
                  <input
                    type="password"
                    value={emailApiKey()}
                    onInput={(e) => {
                      setEmailApiKey(e.currentTarget.value);
                      setEmailApiKeyChanged(true);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.api_key; return n; });
                    }}
                    onFocus={() => {
                      if (!emailApiKeyChanged() && emailApiKeyMasked()) {
                        setEmailApiKey("");
                        setEmailApiKeyChanged(true);
                      }
                    }}
                    placeholder={emailApiKeyMasked() || "Enter API key"}
                    style={inputStyle}
                  />
                  {emailValidErrors().api_key && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().api_key}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>From Email</label>
                  <input
                    type="email"
                    value={emailFromEmail()}
                    onInput={(e) => {
                      setEmailFromEmail(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.from_email; return n; });
                    }}
                    placeholder="noreply@yourdomain.com"
                    style={inputStyle}
                  />
                  {emailValidErrors().from_email && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().from_email}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>From Name</label>
                  <input
                    type="text"
                    value={emailFromName()}
                    onInput={(e) => {
                      setEmailFromName(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.from_name; return n; });
                    }}
                    placeholder="Le Faux Pain"
                    style={inputStyle}
                  />
                  {emailValidErrors().from_name && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().from_name}
                    </div>
                  )}
                </Show>

                {/* SMTP Fields */}
                <Show when={emailProvider() === "smtp"}>
                  <div style={sectionHeaderStyle}>SMTP Configuration</div>

                  <label style={labelStyle}>Host</label>
                  <input
                    type="text"
                    value={smtpHost()}
                    onInput={(e) => {
                      setSmtpHost(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.host; return n; });
                    }}
                    placeholder="smtp.postmarkapp.com"
                    style={inputStyle}
                  />
                  {emailValidErrors().host && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().host}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>Port</label>
                  <input
                    type="text"
                    value={smtpPort()}
                    onInput={(e) => {
                      setSmtpPort(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.port; return n; });
                    }}
                    placeholder="587"
                    style={inputStyle}
                  />
                  {emailValidErrors().port && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().port}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>Username</label>
                  <input
                    type="text"
                    value={smtpUsername()}
                    onInput={(e) => {
                      setSmtpUsername(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.username; return n; });
                    }}
                    placeholder="username"
                    style={inputStyle}
                  />
                  {emailValidErrors().username && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().username}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>Password</label>
                  <input
                    type="password"
                    value={smtpPassword()}
                    onInput={(e) => {
                      setSmtpPassword(e.currentTarget.value);
                      setSmtpPasswordChanged(true);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.password; return n; });
                    }}
                    onFocus={() => {
                      if (!smtpPasswordChanged() && smtpPasswordMasked()) {
                        setSmtpPassword("");
                        setSmtpPasswordChanged(true);
                      }
                    }}
                    placeholder={smtpPasswordMasked() || "Enter password"}
                    style={inputStyle}
                  />
                  {emailValidErrors().password && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().password}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>Encryption</label>
                  <select
                    value={smtpEncryption()}
                    onChange={(e) => {
                      setSmtpEncryption(e.currentTarget.value);
                      if (e.currentTarget.value === "starttls" && smtpPort() === "465") setSmtpPort("587");
                      if (e.currentTarget.value === "tls" && smtpPort() === "587") setSmtpPort("465");
                    }}
                    style={selectStyle}
                  >
                    <option value="starttls">STARTTLS (port 587)</option>
                    <option value="tls">TLS (port 465)</option>
                    <option value="none">None (port 25)</option>
                  </select>
                  {emailValidErrors().encryption && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().encryption}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>From Email</label>
                  <input
                    type="email"
                    value={emailFromEmail()}
                    onInput={(e) => {
                      setEmailFromEmail(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.from_email; return n; });
                    }}
                    placeholder="noreply@yourdomain.com"
                    style={inputStyle}
                  />
                  {emailValidErrors().from_email && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().from_email}
                    </div>
                  )}
                  <div style={{ height: "8px" }} />

                  <label style={labelStyle}>From Name</label>
                  <input
                    type="text"
                    value={emailFromName()}
                    onInput={(e) => {
                      setEmailFromName(e.currentTarget.value);
                      setEmailValidErrors((v) => { const n = { ...v }; delete n.from_name; return n; });
                    }}
                    placeholder="Le Faux Pain"
                    style={inputStyle}
                  />
                  {emailValidErrors().from_name && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "2px" }}>
                      {emailValidErrors().from_name}
                    </div>
                  )}
                </Show>

                {/* Save & Test Buttons */}
                <div style={{ "margin-top": "16px" }}>
                  {emailSaveError() && (
                    <div style={{ color: "var(--danger)", "font-size": "11px", "margin-bottom": "8px" }}>
                      {emailSaveError()}
                    </div>
                  )}
                  {emailSaveMsg() && (
                    <div style={{ color: "var(--success)", "font-size": "11px", "margin-bottom": "8px", "font-family": "var(--font-display)", "letter-spacing": "1px" }}>
                      {emailSaveMsg()}
                    </div>
                  )}

                  <button
                    onClick={handleSaveEmail}
                    disabled={emailSaving() || emailTesting()}
                    style={{
                      ...actionBtnStyle,
                      width: "100%",
                      opacity: emailSaving() ? "0.6" : "1",
                      cursor: emailSaving() ? "wait" : "pointer",
                    }}
                  >
                    {emailSaving() ? "[SAVING...]" : "[save configuration]"}
                  </button>

                  <div style={{ height: "8px" }} />

                  <button
                    onClick={handleTestEmail}
                    disabled={emailTesting() || emailSaving() || !emailConfigured()}
                    style={{
                      "font-size": "12px",
                      border: "1px solid var(--cyan)",
                      "background-color": "rgba(0,188,212,0.1)",
                      color: "var(--cyan)",
                      "font-weight": "600",
                      padding: "6px 16px",
                      width: "100%",
                      opacity: (!emailConfigured() || emailTesting() || emailSaving()) ? "0.4" : "1",
                      cursor: (!emailConfigured() || emailTesting()) ? "not-allowed" : "pointer",
                    }}
                  >
                    {emailTestPhase() === "connecting"
                      ? "[CONNECTING...]"
                      : emailTestPhase() === "sending"
                        ? "[SENDING...]"
                        : "[test connection]"}
                  </button>

                  <Show when={!emailConfigured()}>
                    <div style={{ "font-size": "10px", color: "var(--text-muted)", "margin-top": "4px" }}>
                      Save a provider configuration first
                    </div>
                  </Show>

                  {emailTestMsg() && (
                    <div style={{
                      "font-size": "11px",
                      color: emailTestPhase() === "done" ? "var(--success)" : "var(--danger)",
                      "margin-top": "8px",
                      "font-family": "var(--font-display)",
                      "letter-spacing": "1px",
                    }}>
                      {emailTestMsg()}
                    </div>
                  )}
                </div>
              </Show>

              {/* App tab (desktop only) */}
              <Show when={activeTab() === "about"}>
                <div style={sectionHeaderStyle}>Le Faux Pain</div>
                <div style={{ "font-size": "12px", color: "var(--text-secondary)", "line-height": "1.6" }}>
                  <p style={{ margin: "0 0 12px" }}>
                    Created by <span style={{ color: "var(--text-primary)", "font-weight": "600" }}>Kalman</span>
                  </p>
                  <p style={{ margin: "0" }}>
                    Source code:{" "}
                    <a
                      href="https://github.com/zsazsa/lefauxpain"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--cyan)", "text-decoration": "none" }}
                      onMouseOver={(e) => e.currentTarget.style.textDecoration = "underline"}
                      onMouseOut={(e) => e.currentTarget.style.textDecoration = "none"}
                    >
                      github.com/zsazsa/lefauxpain
                    </a>
                  </p>
                </div>
              </Show>

              <Show when={activeTab() === "app" && isTauri}>
                <Show when={appVersion()}>
                  <div style={{ "font-size": "12px", color: "var(--text-muted)", "margin-bottom": "16px" }}>
                    Current version: <span style={{ color: "var(--text-primary)", "font-weight": "600" }}>{appVersion()}</span>
                  </div>
                </Show>

                <div style={sectionHeaderStyle}>App Update</div>

                <Show when={updateStatus() === "idle"}>
                  <button onClick={() => checkForUpdates(true)} style={{ ...actionBtnStyle, width: "100%" }}>
                    [check for updates]
                  </button>
                </Show>

                <Show when={updateStatus() === "checking"}>
                  <div style={{ "font-size": "12px", color: "var(--text-muted)" }}>
                    Checking for updates...
                  </div>
                </Show>

                <Show when={updateStatus() === "no-update"}>
                  <div style={{ "font-size": "12px", color: "var(--success)", "margin-bottom": "12px" }}>
                    You're on the latest version.
                  </div>
                  <button onClick={() => checkForUpdates(true)} style={{ ...actionBtnStyle, width: "100%" }}>
                    [check again]
                  </button>
                </Show>

                <Show when={updateStatus() === "available"}>
                  <div style={{ "font-size": "12px", color: "var(--text-primary)", "margin-bottom": "8px" }}>
                    Version <span style={{ color: "var(--accent)", "font-weight": "600" }}>{updateVersion()}</span> is available.
                  </div>
                  <Show when={updateBody()}>
                    <div style={{
                      "font-size": "11px",
                      color: "var(--text-muted)",
                      "margin-bottom": "12px",
                      "white-space": "pre-wrap",
                      "max-height": "120px",
                      overflow: "auto",
                      padding: "8px",
                      "background-color": "var(--bg-primary)",
                      border: "1px solid rgba(201,168,76,0.2)",
                    }}>
                      {updateBody()}
                    </div>
                  </Show>
                  {navigator.platform.toLowerCase().includes("linux") ? (
                    <div>
                      <div style={{ "font-size": "11px", color: "var(--text-muted)", "margin-bottom": "8px" }}>
                        Auto-update is not supported for Linux package installs.
                      </div>
                      <button
                        onClick={async () => {
                          const { openUrl } = await import("@tauri-apps/plugin-opener");
                          openUrl(`https://github.com/zsazsa/lefauxpain/releases/tag/v${updateVersion()}`);
                        }}
                        style={{ ...actionBtnStyle, width: "100%" }}
                      >
                        [open download page]
                      </button>
                      <div style={{ "font-size": "10px", color: "var(--text-muted)", "margin-top": "8px" }}>
                        Download the .deb, then run: sudo apt install ~/Downloads/LeFauxPain_{updateVersion()}_amd64.deb
                      </div>
                    </div>
                  ) : (
                    <button onClick={downloadAndInstall} style={{ ...actionBtnStyle, width: "100%" }}>
                      [download & install]
                    </button>
                  )}
                </Show>

                <Show when={updateStatus() === "downloading"}>
                  <div style={{ "font-size": "12px", color: "var(--text-primary)", "margin-bottom": "8px" }}>
                    Downloading... {Math.round(updateProgress() * 100)}%
                  </div>
                  <div style={{
                    height: "6px",
                    "background-color": "var(--bg-primary)",
                    border: "1px solid var(--border-gold)",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${updateProgress() * 100}%`,
                      "background-color": "var(--accent)",
                      transition: "width 0.2s",
                    }} />
                  </div>
                </Show>

                <Show when={updateStatus() === "ready"}>
                  <div style={{ "font-size": "12px", color: "var(--success)", "margin-bottom": "12px" }}>
                    Update installed. Restart to apply.
                  </div>
                  <button onClick={relaunchApp} style={{ ...actionBtnStyle, width: "100%" }}>
                    [relaunch]
                  </button>
                </Show>

                <Show when={updateStatus() === "error"}>
                  <div style={{ color: "var(--danger)", "font-size": "11px", "margin-bottom": "12px" }}>
                    {updateError()}
                  </div>
                  <button onClick={() => checkForUpdates(true)} style={{ ...actionBtnStyle, width: "100%" }}>
                    [retry]
                  </button>
                </Show>
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
