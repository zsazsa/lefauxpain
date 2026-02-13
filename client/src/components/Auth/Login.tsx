import { createSignal } from "solid-js";

interface LoginProps {
  onLogin: (token: string, username: string) => void;
}

function Login(props: LoginProps) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [isRegister, setIsRegister] = createSignal(true);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
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
          "border-radius": "8px",
          width: "400px",
          "max-width": "90vw",
        }}
      >
        <h2
          style={{
            "text-align": "center",
            "margin-bottom": "8px",
            color: "var(--text-primary)",
          }}
        >
          {isRegister() ? "Create an account" : "Welcome back"}
        </h2>
        <p
          style={{
            "text-align": "center",
            "margin-bottom": "24px",
            color: "var(--text-secondary)",
            "font-size": "14px",
          }}
        >
          {isRegister()
            ? "Choose a username to get started"
            : "Log in with your username"}
        </p>

        {error() && (
          <div
            style={{
              "background-color": "rgba(201, 55, 75, 0.1)",
              color: "var(--danger)",
              padding: "10px",
              "border-radius": "4px",
              "margin-bottom": "16px",
              "font-size": "14px",
            }}
          >
            {error()}
          </div>
        )}

        <div style={{ "margin-bottom": "16px" }}>
          <label
            style={{
              display: "block",
              "margin-bottom": "8px",
              color: "var(--text-secondary)",
              "font-size": "12px",
              "font-weight": "700",
              "text-transform": "uppercase",
            }}
          >
            Username
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
              padding: "10px",
              "background-color": "var(--bg-primary)",
              "border-radius": "4px",
              color: "var(--text-primary)",
              "font-size": "16px",
            }}
          />
        </div>

        <div style={{ "margin-bottom": "24px" }}>
          <label
            style={{
              display: "block",
              "margin-bottom": "8px",
              color: "var(--text-secondary)",
              "font-size": "12px",
              "font-weight": "700",
              "text-transform": "uppercase",
            }}
          >
            Password{" "}
            <span style={{ color: "var(--text-muted)", "font-weight": "400" }}>
              (optional)
            </span>
          </label>
          <input
            type="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            style={{
              width: "100%",
              padding: "10px",
              "background-color": "var(--bg-primary)",
              "border-radius": "4px",
              color: "var(--text-primary)",
              "font-size": "16px",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading()}
          style={{
            width: "100%",
            padding: "12px",
            "background-color": "var(--accent)",
            color: "white",
            "border-radius": "4px",
            "font-size": "16px",
            "font-weight": "600",
            opacity: loading() ? "0.7" : "1",
          }}
        >
          {loading()
            ? "..."
            : isRegister()
              ? "Register"
              : "Log In"}
        </button>

        <p
          style={{
            "text-align": "center",
            "margin-top": "16px",
            color: "var(--text-secondary)",
            "font-size": "14px",
          }}
        >
          {isRegister() ? "Already have an account? " : "Need an account? "}
          <span
            onClick={() => {
              setIsRegister(!isRegister());
              setError("");
            }}
            style={{
              color: "var(--accent)",
              cursor: "pointer",
            }}
          >
            {isRegister() ? "Log In" : "Register"}
          </span>
        </p>
      </form>
    </div>
  );
}

export default Login;
