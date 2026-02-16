import { createSignal, Show } from "solid-js";
import { t } from "../../stores/theme";

interface LoginProps {
  onLogin: (token: string, username: string) => void;
}

function Login(props: LoginProps) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [isRegister, setIsRegister] = createSignal(false);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

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

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

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
            username
          </label>
          <input
            type="text"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            required
            maxLength={32}
            pattern="[a-zA-Z0-9_]+"
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
            <span style={{ color: "var(--text-muted)", "letter-spacing": "0" }}>
              (optional)
            </span>
          </label>
          <input
            type="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
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
      </form>
    </div>
  );
}

export default Login;
