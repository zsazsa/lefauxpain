import { createSignal, onMount, Show } from "solid-js";
import { isTauri } from "../../lib/devices";
import { t } from "../../stores/theme";

interface LoginProps {
  onLogin: (token: string, username: string) => void;
}

function Login(props: LoginProps) {
  const [username, setUsername] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [knockMessage, setKnockMessage] = createSignal("");
  const [isRegister, setIsRegister] = createSignal(false);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [pendingVerification, setPendingVerification] = createSignal(false);
  const [verificationEmail, setVerificationEmail] = createSignal("");
  const [verificationCode, setVerificationCode] = createSignal("");
  const [verificationError, setVerificationError] = createSignal("");
  const [verificationLoading, setVerificationLoading] = createSignal(false);
  const [resendStatus, setResendStatus] = createSignal("");
  const [emailRequired, setEmailRequired] = createSignal(false);
  const [forgotPwd, setForgotPwd] = createSignal(false);
  const [resetPhase, setResetPhase] = createSignal<"email" | "code">("email");
  const [resetEmail, setResetEmail] = createSignal("");
  const [resetCode, setResetCode] = createSignal("");
  const [resetNewPwd, setResetNewPwd] = createSignal("");
  const [resetConfirmPwd, setResetConfirmPwd] = createSignal("");
  const [resetError, setResetError] = createSignal("");
  const [resetSuccess, setResetSuccess] = createSignal(false);
  const [resetLoading, setResetLoading] = createSignal(false);
  const [showServerInput, setShowServerInput] = createSignal(false);
  const [serverUrl, setServerUrl] = createSignal("");
  const [serverError, setServerError] = createSignal("");
  const [serverLoading, setServerLoading] = createSignal(false);

  onMount(async () => {
    try {
      const res = await fetch("/api/v1/health");
      const data = await res.json();
      if (data.email_required) setEmailRequired(true);
    } catch { /* ignore */ }
  });

  const connectToServer = async () => {
    let url = serverUrl().trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    url = url.replace(/\/+$/, "");

    setServerError("");
    setServerLoading(true);
    try {
      const res = await fetch(url + "/api/v1/health");
      const data = await res.json();
      if (data.app !== "voicechat") throw new Error();
      const sep = url.includes("?") ? "&" : "?";
      window.location.href = url + sep + "tauri=1";
    } catch {
      setServerError("Not a valid Le Faux Pain server");
      setServerLoading(false);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");

    if (isRegister() && password() && password() !== confirmPassword()) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    const endpoint = isRegister()
      ? "/api/v1/auth/register"
      : "/api/v1/auth/login";

    try {
      const body: Record<string, string> = { username: username() };
      if (password()) {
        body.password = password();
      }
      if (isRegister() && email()) {
        body.email = email();
      }
      if (isRegister() && knockMessage()) {
        body.knock_message = knockMessage();
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.pending_verification) {
        const vEmail = isRegister() ? email() : username();
        setVerificationEmail(vEmail);
        setPendingVerification(true);
        return;
      }

      if (data.pending) {
        setPending(true);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      props.onLogin(data.token, data.user.username);
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: Event) => {
    e.preventDefault();
    setVerificationError("");
    setVerificationLoading(true);
    try {
      const res = await fetch("/api/v1/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verificationEmail(), code: verificationCode() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerificationError(data.error || "Verification failed");
        return;
      }
      if (data.pending_approval) {
        setPendingVerification(false);
        setPending(true);
      }
    } catch {
      setVerificationError("Failed to connect to server");
    } finally {
      setVerificationLoading(false);
    }
  };

  const handleResend = async () => {
    setResendStatus("");
    setVerificationError("");
    try {
      const res = await fetch("/api/v1/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verificationEmail() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerificationError(data.error || "Failed to resend code");
        return;
      }
      setResendStatus("Code sent!");
    } catch {
      setVerificationError("Failed to connect to server");
    }
  };

  const handleForgotSubmit = async (e: Event) => {
    e.preventDefault();
    setResetError("");
    setResetLoading(true);
    try {
      const res = await fetch("/api/v1/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || "Failed to send reset code");
        return;
      }
      setResetPhase("code");
    } catch {
      setResetError("Failed to connect to server");
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetSubmit = async (e: Event) => {
    e.preventDefault();
    setResetError("");
    if (resetNewPwd() !== resetConfirmPwd()) {
      setResetError("Passwords do not match");
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch("/api/v1/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail(), code: resetCode(), new_password: resetNewPwd() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || "Reset failed");
        return;
      }
      setResetSuccess(true);
    } catch {
      setResetError("Failed to connect to server");
    } finally {
      setResetLoading(false);
    }
  };

  const cancelForgot = () => {
    setForgotPwd(false);
    setResetPhase("email");
    setResetEmail("");
    setResetCode("");
    setResetNewPwd("");
    setResetConfirmPwd("");
    setResetError("");
    setResetSuccess(false);
    setError("");
  };

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        "background-color": "var(--bg-primary)",
      }}
    >
      <Show when={forgotPwd()}>
        <div
          style={{
            "background-color": "var(--bg-secondary)",
            padding: "32px",
            border: "1px solid var(--border-gold)",
            width: "400px",
            "max-width": "90vw",
            "box-shadow": "0 0 30px rgba(201,168,76,0.08)",
            "text-align": "center",
          }}
        >
          <h2
            style={{
              "margin-bottom": "8px",
              color: "var(--accent)",
              "font-family": "var(--font-display)",
              "font-size": "22px",
              "letter-spacing": "2px",
            }}
          >
            {t("appName")}
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              "font-size": "12px",
              "margin-bottom": "24px",
            }}
          >
            // reset your password
          </p>

          {resetError() && (
            <div
              style={{
                "background-color": "rgba(232, 64, 64, 0.1)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
                padding: "8px",
                "margin-bottom": "16px",
                "font-size": "12px",
              }}
            >
              ERR: {resetError()}
            </div>
          )}

          <Show when={resetSuccess()}>
            <div
              style={{
                "background-color": "rgba(201,168,76,0.08)",
                border: "1px solid var(--border-gold)",
                padding: "16px",
                "margin-bottom": "16px",
              }}
            >
              <p
                style={{
                  color: "var(--accent)",
                  "font-size": "14px",
                  "font-weight": "600",
                  "margin-bottom": "8px",
                }}
              >
                Password reset successful
              </p>
              <p
                style={{
                  color: "var(--text-muted)",
                  "font-size": "12px",
                }}
              >
                You can now log in with your new password.
              </p>
            </div>
            <span
              onClick={cancelForgot}
              style={{
                color: "var(--cyan)",
                cursor: "pointer",
                "font-size": "12px",
              }}
            >
              [back to login]
            </span>
          </Show>

          <Show when={!resetSuccess() && resetPhase() === "email"}>
            <form onSubmit={handleForgotSubmit}>
              <div style={{ "margin-bottom": "16px", "text-align": "left" }}>
                <label
                  style={{
                    display: "block",
                    "margin-bottom": "6px",
                    color: "var(--text-muted)",
                    "font-size": "11px",
                    "text-transform": "uppercase",
                    "letter-spacing": "1px",
                  }}
                >
                  email address
                </label>
                <input
                  type="email"
                  value={resetEmail()}
                  onInput={(e) => setResetEmail(e.currentTarget.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px",
                    "background-color": "var(--bg-primary)",
                    border: "1px solid var(--border-gold)",
                    color: "var(--text-primary)",
                    "font-size": "14px",
                    "caret-color": "var(--accent)",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={resetLoading()}
                style={{
                  width: "100%",
                  padding: "10px",
                  "background-color": "transparent",
                  border: "1px solid var(--accent)",
                  color: "var(--accent)",
                  "font-size": "13px",
                  "font-weight": "600",
                  "letter-spacing": "1px",
                  opacity: resetLoading() ? "0.7" : "1",
                }}
              >
                {resetLoading() ? "..." : "[SEND RESET CODE]"}
              </button>
            </form>
            <p style={{ "margin-top": "16px" }}>
              <span
                onClick={cancelForgot}
                style={{
                  color: "var(--cyan)",
                  cursor: "pointer",
                  "font-size": "12px",
                }}
              >
                [back to login]
              </span>
            </p>
          </Show>

          <Show when={!resetSuccess() && resetPhase() === "code"}>
            <div
              style={{
                "background-color": "rgba(201,168,76,0.08)",
                border: "1px solid var(--border-gold)",
                padding: "16px",
                "margin-bottom": "16px",
              }}
            >
              <p
                style={{
                  color: "var(--accent)",
                  "font-size": "14px",
                  "font-weight": "600",
                  "margin-bottom": "8px",
                }}
              >
                Reset code sent to {resetEmail()}
              </p>
              <p
                style={{
                  color: "var(--text-muted)",
                  "font-size": "12px",
                }}
              >
                Enter the 6-digit code and your new password
              </p>
            </div>
            <form onSubmit={handleResetSubmit}>
              <div style={{ "margin-bottom": "16px" }}>
                <input
                  type="text"
                  value={resetCode()}
                  onInput={(e) => setResetCode(e.currentTarget.value)}
                  placeholder="000000"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  style={{
                    width: "100%",
                    padding: "12px",
                    "background-color": "var(--bg-primary)",
                    border: "1px solid var(--border-gold)",
                    color: "var(--text-primary)",
                    "font-size": "24px",
                    "letter-spacing": "8px",
                    "text-align": "center",
                    "caret-color": "var(--accent)",
                  }}
                />
              </div>
              <div style={{ "margin-bottom": "16px", "text-align": "left" }}>
                <label
                  style={{
                    display: "block",
                    "margin-bottom": "6px",
                    color: "var(--text-muted)",
                    "font-size": "11px",
                    "text-transform": "uppercase",
                    "letter-spacing": "1px",
                  }}
                >
                  new password
                </label>
                <input
                  type="password"
                  value={resetNewPwd()}
                  onInput={(e) => setResetNewPwd(e.currentTarget.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px",
                    "background-color": "var(--bg-primary)",
                    border: "1px solid var(--border-gold)",
                    color: "var(--text-primary)",
                    "font-size": "14px",
                    "caret-color": "var(--accent)",
                  }}
                />
              </div>
              <div style={{ "margin-bottom": "16px", "text-align": "left" }}>
                <label
                  style={{
                    display: "block",
                    "margin-bottom": "6px",
                    color: "var(--text-muted)",
                    "font-size": "11px",
                    "text-transform": "uppercase",
                    "letter-spacing": "1px",
                  }}
                >
                  confirm password
                </label>
                <input
                  type="password"
                  value={resetConfirmPwd()}
                  onInput={(e) => setResetConfirmPwd(e.currentTarget.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px",
                    "background-color": "var(--bg-primary)",
                    border: "1px solid var(--border-gold)",
                    color: "var(--text-primary)",
                    "font-size": "14px",
                    "caret-color": "var(--accent)",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={resetLoading()}
                style={{
                  width: "100%",
                  padding: "10px",
                  "background-color": "transparent",
                  border: "1px solid var(--accent)",
                  color: "var(--accent)",
                  "font-size": "13px",
                  "font-weight": "600",
                  "letter-spacing": "1px",
                  opacity: resetLoading() ? "0.7" : "1",
                }}
              >
                {resetLoading() ? "..." : "[RESET PASSWORD]"}
              </button>
            </form>
            <p style={{ "margin-top": "16px" }}>
              <span
                onClick={cancelForgot}
                style={{
                  color: "var(--cyan)",
                  cursor: "pointer",
                  "font-size": "12px",
                }}
              >
                [back to login]
              </span>
            </p>
          </Show>
        </div>
      </Show>

      <Show when={pendingVerification() && !forgotPwd()}>
        <div
          style={{
            "background-color": "var(--bg-secondary)",
            padding: "32px",
            border: "1px solid var(--border-gold)",
            width: "400px",
            "max-width": "90vw",
            "box-shadow": "0 0 30px rgba(201,168,76,0.08)",
            "text-align": "center",
          }}
        >
          <h2
            style={{
              "margin-bottom": "8px",
              color: "var(--accent)",
              "font-family": "var(--font-display)",
              "font-size": "22px",
              "letter-spacing": "2px",
            }}
          >
            {t("appName")}
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              "font-size": "12px",
              "margin-bottom": "24px",
            }}
          >
            // check your email
          </p>
          <div
            style={{
              "background-color": "rgba(201,168,76,0.08)",
              border: "1px solid var(--border-gold)",
              padding: "16px",
              "margin-bottom": "16px",
            }}
          >
            <p
              style={{
                color: "var(--accent)",
                "font-size": "14px",
                "font-weight": "600",
                "margin-bottom": "8px",
              }}
            >
              Verification code sent to {verificationEmail()}
            </p>
            <p
              style={{
                color: "var(--text-muted)",
                "font-size": "12px",
              }}
            >
              Enter the 6-digit code below
            </p>
          </div>

          {verificationError() && (
            <div
              style={{
                "background-color": "rgba(232, 64, 64, 0.1)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
                padding: "8px",
                "margin-bottom": "16px",
                "font-size": "12px",
              }}
            >
              ERR: {verificationError()}
            </div>
          )}

          {resendStatus() && (
            <div
              style={{
                "background-color": "rgba(201,168,76,0.08)",
                border: "1px solid var(--border-gold)",
                color: "var(--accent)",
                padding: "8px",
                "margin-bottom": "16px",
                "font-size": "12px",
              }}
            >
              {resendStatus()}
            </div>
          )}

          <form onSubmit={handleVerify}>
            <div style={{ "margin-bottom": "16px" }}>
              <input
                type="text"
                value={verificationCode()}
                onInput={(e) => setVerificationCode(e.currentTarget.value)}
                placeholder="000000"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                style={{
                  width: "100%",
                  padding: "12px",
                  "background-color": "var(--bg-primary)",
                  border: "1px solid var(--border-gold)",
                  color: "var(--text-primary)",
                  "font-size": "24px",
                  "letter-spacing": "8px",
                  "text-align": "center",
                  "caret-color": "var(--accent)",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={verificationLoading()}
              style={{
                width: "100%",
                padding: "10px",
                "background-color": "transparent",
                border: "1px solid var(--accent)",
                color: "var(--accent)",
                "font-size": "13px",
                "font-weight": "600",
                "letter-spacing": "1px",
                opacity: verificationLoading() ? "0.7" : "1",
              }}
            >
              {verificationLoading() ? "..." : "[VERIFY]"}
            </button>
          </form>

          <p
            style={{
              "margin-top": "16px",
              color: "var(--text-muted)",
              "font-size": "12px",
            }}
          >
            <span
              onClick={handleResend}
              style={{
                color: "var(--cyan)",
                cursor: "pointer",
              }}
            >
              [resend code]
            </span>
            {" "}
            <span
              onClick={() => {
                setPendingVerification(false);
                setVerificationCode("");
                setVerificationError("");
                setResendStatus("");
                setError("");
              }}
              style={{
                color: "var(--cyan)",
                cursor: "pointer",
              }}
            >
              [back to login]
            </span>
          </p>
        </div>
      </Show>

      <Show when={pending() && !pendingVerification() && !forgotPwd()}>
        <div
          style={{
            "background-color": "var(--bg-secondary)",
            padding: "32px",
            border: "1px solid var(--border-gold)",
            width: "400px",
            "max-width": "90vw",
            "box-shadow": "0 0 30px rgba(201,168,76,0.08)",
            "text-align": "center",
          }}
        >
          <h2
            style={{
              "margin-bottom": "8px",
              color: "var(--accent)",
              "font-family": "var(--font-display)",
              "font-size": "22px",
              "letter-spacing": "2px",
            }}
          >
            {t("appName")}
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              "font-size": "12px",
              "margin-bottom": "24px",
            }}
          >
            // knock knock
          </p>
          <div
            style={{
              "background-color": "rgba(201,168,76,0.08)",
              border: "1px solid var(--border-gold)",
              padding: "16px",
              "margin-bottom": "16px",
            }}
          >
            <p
              style={{
                color: "var(--accent)",
                "font-size": "14px",
                "font-weight": "600",
                "margin-bottom": "8px",
              }}
            >
              Your knock has been heard.
            </p>
            <p
              style={{
                color: "var(--text-muted)",
                "font-size": "12px",
              }}
            >
              Waiting for admin approval...
            </p>
          </div>
          <button
            onClick={() => {
              setPending(false);
              setIsRegister(false);
              setError("");
            }}
            style={{
              "font-size": "12px",
              color: "var(--cyan)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            [back to login]
          </button>
        </div>
      </Show>

      <Show when={!pending() && !pendingVerification() && !forgotPwd()}>
        <form
          onSubmit={handleSubmit}
          style={{
            "background-color": "var(--bg-secondary)",
            padding: "32px",
            border: "1px solid var(--border-gold)",
            width: "400px",
            "max-width": "90vw",
            "box-shadow": "0 0 30px rgba(201,168,76,0.08)",
          }}
        >
          <h2
            style={{
              "text-align": "center",
              "margin-bottom": "4px",
              color: "var(--accent)",
              "font-family": "var(--font-display)",
              "font-size": "22px",
              "letter-spacing": "2px",
            }}
          >
            {t("appName")}
          </h2>
          <p
            style={{
              "text-align": "center",
              "margin-bottom": "24px",
              color: "var(--text-muted)",
              "font-size": "12px",
            }}
          >
            {isRegister()
              ? "// create an account to connect"
              : "// authenticate to continue"}
          </p>

          {error() && (
            <div
              style={{
                "background-color": "rgba(232, 64, 64, 0.1)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
                padding: "8px",
                "margin-bottom": "16px",
                "font-size": "12px",
              }}
            >
              ERR: {error()}
            </div>
          )}

          <div style={{ "margin-bottom": "16px" }}>
            <label
              style={{
                display: "block",
                "margin-bottom": "6px",
                color: "var(--text-muted)",
                "font-size": "11px",
                "text-transform": "uppercase",
                "letter-spacing": "1px",
              }}
            >
              {isRegister() ? "username" : "username or email"}
            </label>
            <input
              type="text"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              required
              maxLength={isRegister() ? 32 : 255}
              pattern={isRegister() ? "[a-zA-Z0-9_]+" : undefined}
              style={{
                width: "100%",
                padding: "8px",
                "background-color": "var(--bg-primary)",
                border: "1px solid var(--border-gold)",
                color: "var(--text-primary)",
                "font-size": "14px",
                "caret-color": "var(--accent)",
              }}
            />
          </div>

          <Show when={isRegister()}>
            <div style={{ "margin-bottom": "16px" }}>
              <label
                style={{
                  display: "block",
                  "margin-bottom": "6px",
                  color: "var(--text-muted)",
                  "font-size": "11px",
                  "text-transform": "uppercase",
                  "letter-spacing": "1px",
                }}
              >
                email{" "}
                <Show when={!emailRequired()}>
                  <span style={{ color: "var(--text-muted)", "letter-spacing": "0" }}>
                    (optional)
                  </span>
                </Show>
              </label>
              <input
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required={emailRequired()}
                style={{
                  width: "100%",
                  padding: "8px",
                  "background-color": "var(--bg-primary)",
                  border: "1px solid var(--border-gold)",
                  color: "var(--text-primary)",
                  "font-size": "14px",
                  "caret-color": "var(--accent)",
                }}
              />
            </div>
          </Show>

          <div style={{ "margin-bottom": isRegister() && password() ? "16px" : "24px" }}>
            <label
              style={{
                display: "block",
                "margin-bottom": "6px",
                color: "var(--text-muted)",
                "font-size": "11px",
                "text-transform": "uppercase",
                "letter-spacing": "1px",
              }}
            >
              password{" "}
              <Show when={!emailRequired()}>
                <span style={{ color: "var(--text-muted)", "letter-spacing": "0" }}>
                  (optional)
                </span>
              </Show>
            </label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required={isRegister() && emailRequired()}
              style={{
                width: "100%",
                padding: "8px",
                "background-color": "var(--bg-primary)",
                border: "1px solid var(--border-gold)",
                color: "var(--text-primary)",
                "font-size": "14px",
                "caret-color": "var(--accent)",
              }}
            />
          </div>

          <Show when={isRegister() && password()}>
            <div style={{ "margin-bottom": "16px" }}>
              <label
                style={{
                  display: "block",
                  "margin-bottom": "6px",
                  color: "var(--text-muted)",
                  "font-size": "11px",
                  "text-transform": "uppercase",
                  "letter-spacing": "1px",
                }}
              >
                confirm password
              </label>
              <input
                type="password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                style={{
                  width: "100%",
                  padding: "8px",
                  "background-color": "var(--bg-primary)",
                  border: "1px solid var(--border-gold)",
                  color: "var(--text-primary)",
                  "font-size": "14px",
                  "caret-color": "var(--accent)",
                }}
              />
            </div>
          </Show>

          <Show when={isRegister()}>
            <div style={{ "margin-bottom": "24px" }}>
              <label
                style={{
                  display: "block",
                  "margin-bottom": "6px",
                  color: "var(--text-muted)",
                  "font-size": "11px",
                  "text-transform": "uppercase",
                  "letter-spacing": "1px",
                }}
              >
                knock knock{" "}
                <span style={{ color: "var(--text-muted)", "letter-spacing": "0" }}>
                  — who's there? leave a message for the admin
                </span>
              </label>
              <textarea
                value={knockMessage()}
                onInput={(e) => setKnockMessage(e.currentTarget.value)}
                maxLength={500}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px",
                  "background-color": "var(--bg-primary)",
                  border: "1px solid var(--border-gold)",
                  color: "var(--text-primary)",
                  "font-size": "13px",
                  "caret-color": "var(--accent)",
                  resize: "vertical",
                  "font-family": "inherit",
                }}
              />
            </div>
          </Show>

          <button
            type="submit"
            disabled={loading()}
            style={{
              width: "100%",
              padding: "10px",
              "background-color": "transparent",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              "font-size": "13px",
              "font-weight": "600",
              "letter-spacing": "1px",
              opacity: loading() ? "0.7" : "1",
            }}
          >
            {loading()
              ? "..."
              : isRegister()
                ? "[REGISTER]"
                : "[LOG IN]"}
          </button>

          <p
            style={{
              "text-align": "center",
              "margin-top": "16px",
              color: "var(--text-muted)",
              "font-size": "12px",
            }}
          >
            {isRegister() ? "Already have an account? " : "Need an account? "}
            <span
              onClick={() => {
                setIsRegister(!isRegister());
                setError("");
              }}
              style={{
                color: "var(--cyan)",
                cursor: "pointer",
              }}
            >
              {isRegister() ? "[log in]" : "[register]"}
            </span>
          </p>

          <Show when={!isRegister()}>
            <p
              style={{
                "text-align": "center",
                "margin-top": "8px",
                color: "var(--text-muted)",
                "font-size": "12px",
              }}
            >
              <span
                onClick={() => setForgotPwd(true)}
                style={{
                  color: "var(--cyan)",
                  cursor: "pointer",
                }}
              >
                [forgot password?]
              </span>
            </p>
          </Show>

          <Show when={isTauri}>
            <div
              style={{
                "margin-top": "12px",
                "padding-top": "12px",
                "border-top": "1px solid rgba(201,168,76,0.15)",
              }}
            >
              <Show when={!showServerInput()}>
                <p style={{ "text-align": "center" }}>
                  <span
                    onClick={() => setShowServerInput(true)}
                    style={{
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      "font-size": "11px",
                    }}
                  >
                    [change server]
                  </span>
                </p>
              </Show>
              <Show when={showServerInput()}>
                <label
                  style={{
                    display: "block",
                    "margin-bottom": "6px",
                    color: "var(--text-muted)",
                    "font-size": "11px",
                    "text-transform": "uppercase",
                    "letter-spacing": "1px",
                  }}
                >
                  server url
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="url"
                    value={serverUrl()}
                    onInput={(e) => { setServerUrl(e.currentTarget.value); setServerError(""); }}
                    placeholder="https://example.com"
                    style={{
                      flex: "1",
                      padding: "8px",
                      "background-color": "var(--bg-primary)",
                      border: "1px solid var(--border-gold)",
                      color: "var(--text-primary)",
                      "font-size": "13px",
                      "caret-color": "var(--accent)",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        connectToServer();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={serverLoading()}
                    onClick={connectToServer}
                    style={{
                      padding: "8px 12px",
                      "background-color": "transparent",
                      border: "1px solid var(--accent)",
                      color: "var(--accent)",
                      "font-size": "12px",
                      "font-weight": "600",
                      cursor: "pointer",
                      "white-space": "nowrap",
                      opacity: serverLoading() ? "0.7" : "1",
                    }}
                  >
                    {serverLoading() ? "..." : "[go]"}
                  </button>
                </div>
                {serverError() && (
                  <div style={{ color: "var(--danger)", "font-size": "11px", "margin-top": "6px" }}>
                    {serverError()}
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </form>
      </Show>
    </div>
  );
}

export default Login;
