import { createSignal, createEffect, For, Show } from "solid-js";
import { currentUser } from "../../stores/auth";
import {
  updateChannelSettings,
  getChannelMembers,
  addChannelMember,
  removeChannelMember,
  updateMemberRole,
  getAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
} from "../../lib/api";
import { channels } from "../../stores/channels";
import { allUsers } from "../../stores/users";

interface ChannelSettingsModalProps {
  channelId: string;
  open: boolean;
  onClose: () => void;
}

export default function ChannelSettingsModal(props: ChannelSettingsModalProps) {
  const [members, setMembers] = createSignal<any[]>([]);
  const [requests, setRequests] = createSignal<any[]>([]);
  const [channelName, setChannelName] = createSignal("");
  const [channelDesc, setChannelDesc] = createSignal("");
  const [channelVis, setChannelVis] = createSignal("public");
  const [addUsername, setAddUsername] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [activeSection, setActiveSection] = createSignal<"general" | "members" | "requests">("general");

  createEffect(() => {
    if (props.open) {
      const ch = channels().find(c => c.id === props.channelId);
      if (ch) {
        setChannelName(ch.name);
        setChannelDesc(ch.description || "");
        setChannelVis(ch.visibility);
      }
      setError("");
      setActiveSection("general");
      getChannelMembers(props.channelId).then(setMembers).catch(() => {});
      getAccessRequests(props.channelId).then(setRequests).catch(() => {});
    }
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateChannelSettings(props.channelId, {
        name: channelName(),
        description: channelDesc(),
        visibility: channelVis(),
      });
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async () => {
    const username = addUsername().trim();
    if (!username) return;
    const user = allUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      setError("User not found");
      return;
    }
    setError("");
    try {
      await addChannelMember(props.channelId, user.id);
      setAddUsername("");
      getChannelMembers(props.channelId).then(setMembers).catch(() => {});
    } catch (e: any) {
      setError(e.message || "Failed to add member");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeChannelMember(props.channelId, userId);
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (e: any) {
      setError(e.message || "Failed to remove member");
    }
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "owner" ? "member" : "owner";
    try {
      await updateMemberRole(props.channelId, userId, newRole);
      setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
    } catch (e: any) {
      setError(e.message || "Failed to update role");
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      await approveAccessRequest(props.channelId, requestId);
      setRequests(prev => prev.filter(r => r.id !== requestId));
      getChannelMembers(props.channelId).then(setMembers).catch(() => {});
    } catch (e: any) {
      setError(e.message || "Failed to approve");
    }
  };

  const handleDeny = async (requestId: string) => {
    try {
      await denyAccessRequest(props.channelId, requestId);
      setRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (e: any) {
      setError(e.message || "Failed to deny");
    }
  };

  const sectionHeaderStyle = {
    "font-family": "var(--font-display)",
    "font-size": "11px",
    "font-weight": "600",
    "text-transform": "uppercase",
    "letter-spacing": "2px",
    color: "var(--text-muted)",
    "margin-bottom": "12px",
  };

  const inputStyle = {
    width: "100%",
    padding: "6px 10px",
    "background-color": "#1a1a2e",
    color: "var(--text-primary)",
    border: "1px solid rgba(201, 168, 76, 0.4)",
    "font-size": "12px",
    "font-family": "var(--font-mono)",
    "box-sizing": "border-box" as const,
  };

  const actionBtnStyle = {
    "font-size": "12px",
    border: "1px solid var(--accent)",
    "background-color": "var(--accent-glow)",
    color: "var(--accent)",
    "font-weight": "600",
    padding: "6px 16px",
    cursor: "pointer",
    "font-family": "var(--font-display)",
  };

  const tabStyle = (active: boolean) => ({
    "font-size": "11px",
    "font-family": "var(--font-display)",
    "letter-spacing": "1px",
    padding: "6px 12px",
    cursor: "pointer",
    color: active ? "var(--accent)" : "var(--text-muted)",
    "border-bottom": active ? "1px solid var(--accent)" : "1px solid transparent",
    background: "none",
    border: "none",
    "border-bottom-width": "1px",
    "border-bottom-style": "solid",
    "border-bottom-color": active ? "var(--accent)" : "transparent",
  });

  return (
    <Show when={props.open}>
      <div
        onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          "background-color": "rgba(0, 0, 0, 0.7)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "1000",
        }}
      >
        <div style={{
          width: "500px",
          "max-height": "70vh",
          "background-color": "var(--bg-secondary)",
          border: "1px solid var(--border-gold)",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "12px 16px",
            "border-bottom": "1px solid var(--border-gold)",
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
          }}>
            <span style={{
              "font-family": "var(--font-display)",
              "font-size": "14px",
              "font-weight": "600",
              color: "var(--text-primary)",
              "letter-spacing": "1px",
            }}>
              Channel Settings
            </span>
            <button
              onClick={props.onClose}
              style={{
                color: "var(--text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                "font-size": "12px",
              }}
            >
              [x]
            </button>
          </div>

          {/* Tabs */}
          <div style={{
            display: "flex",
            gap: "4px",
            padding: "0 16px",
            "border-bottom": "1px solid var(--border-gold)",
          }}>
            <button style={tabStyle(activeSection() === "general")} onClick={() => setActiveSection("general")}>
              General
            </button>
            <button style={tabStyle(activeSection() === "members")} onClick={() => setActiveSection("members")}>
              Members
            </button>
            <button style={tabStyle(activeSection() === "requests")} onClick={() => setActiveSection("requests")}>
              Requests
              <Show when={requests().length > 0}>
                <span style={{ color: "var(--accent)", "margin-left": "4px" }}>({requests().length})</span>
              </Show>
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: "1", overflow: "auto", padding: "16px" }}>
            <Show when={error()}>
              <div style={{ "font-size": "11px", color: "var(--danger)", "margin-bottom": "12px" }}>
                {error()}
              </div>
            </Show>

            {/* General Section */}
            <Show when={activeSection() === "general"}>
              <div style={sectionHeaderStyle}>General</div>

              <div style={{ "margin-bottom": "12px" }}>
                <label style={{ "font-size": "11px", color: "var(--text-muted)", display: "block", "margin-bottom": "4px" }}>
                  Channel Name
                </label>
                <input
                  type="text"
                  value={channelName()}
                  onInput={(e) => setChannelName(e.currentTarget.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ "margin-bottom": "12px" }}>
                <label style={{ "font-size": "11px", color: "var(--text-muted)", display: "block", "margin-bottom": "4px" }}>
                  Description
                </label>
                <textarea
                  value={channelDesc()}
                  onInput={(e) => setChannelDesc(e.currentTarget.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div style={{ "margin-bottom": "16px" }}>
                <label style={{ "font-size": "11px", color: "var(--text-muted)", display: "block", "margin-bottom": "4px" }}>
                  Visibility
                </label>
                <select
                  value={channelVis()}
                  onChange={(e) => setChannelVis(e.currentTarget.value)}
                  style={{ ...inputStyle, width: "auto", "min-width": "150px" }}
                >
                  <option value="public">Public</option>
                  <option value="visible">Visible</option>
                  <option value="invisible">Invisible</option>
                </select>
              </div>

              <button
                onClick={handleSave}
                disabled={saving()}
                style={{ ...actionBtnStyle, opacity: saving() ? "0.5" : "1" }}
              >
                {saving() ? "saving..." : "[save]"}
              </button>
            </Show>

            {/* Members Section */}
            <Show when={activeSection() === "members"}>
              <div style={sectionHeaderStyle}>Members</div>

              <div style={{ position: "relative", "margin-bottom": "16px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Type username..."
                    value={addUsername()}
                    onInput={(e) => setAddUsername(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(); }}
                    style={{ ...inputStyle, flex: "1" }}
                  />
                  <button onClick={handleAddMember} style={actionBtnStyle}>
                    [add]
                  </button>
                </div>
                <Show when={addUsername().length > 0}>
                  {(() => {
                    const memberIds = new Set(members().map((m: any) => m.user_id));
                    const suggestions = allUsers().filter(
                      (u) => u.username.toLowerCase().includes(addUsername().toLowerCase()) && !memberIds.has(u.id)
                    ).slice(0, 5);
                    return (
                      <Show when={suggestions.length > 0}>
                        <div style={{
                          position: "absolute",
                          top: "100%",
                          left: "0",
                          right: "60px",
                          "z-index": "10",
                          "background-color": "var(--bg-primary)",
                          border: "1px solid var(--border-gold)",
                          "max-height": "150px",
                          overflow: "auto",
                        }}>
                          <For each={suggestions}>
                            {(user) => (
                              <button
                                onClick={() => {
                                  setAddUsername(user.username);
                                  handleAddMember();
                                }}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  "text-align": "left",
                                  padding: "6px 10px",
                                  color: "var(--text-primary)",
                                  "background-color": "transparent",
                                  border: "none",
                                  "border-bottom": "1px solid rgba(201,168,76,0.1)",
                                  cursor: "pointer",
                                  "font-size": "12px",
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = "var(--accent-glow)"}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                              >
                                {user.username}
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    );
                  })()}
                </Show>
              </div>

              <For each={members()} fallback={
                <div style={{ "font-size": "12px", color: "var(--text-muted)" }}>No members</div>
              }>
                {(member) => (
                  <div style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    padding: "6px 0",
                    "border-bottom": "1px solid rgba(201, 168, 76, 0.1)",
                    "font-size": "12px",
                  }}>
                    <span style={{ flex: "1", color: "var(--text-primary)" }}>
                      {member.username}
                    </span>
                    <span style={{
                      "font-size": "10px",
                      padding: "1px 6px",
                      color: member.role === "owner" ? "var(--accent)" : "var(--text-muted)",
                      border: "1px solid " + (member.role === "owner" ? "var(--accent)" : "rgba(201,168,76,0.3)"),
                    }}>
                      {member.role}
                    </span>
                    <button
                      onClick={() => handleToggleRole(member.user_id, member.role)}
                      style={{
                        "font-size": "10px",
                        color: "var(--text-muted)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      [{member.role === "owner" ? "demote" : "promote"}]
                    </button>
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      style={{
                        "font-size": "10px",
                        color: "var(--danger)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      [remove]
                    </button>
                  </div>
                )}
              </For>
            </Show>

            {/* Requests Section */}
            <Show when={activeSection() === "requests"}>
              <div style={sectionHeaderStyle}>Access Requests</div>

              <For each={requests()} fallback={
                <div style={{ "font-size": "12px", color: "var(--text-muted)" }}>No pending requests</div>
              }>
                {(req) => (
                  <div style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    padding: "6px 0",
                    "border-bottom": "1px solid rgba(201, 168, 76, 0.1)",
                    "font-size": "12px",
                  }}>
                    <span style={{ flex: "1", color: "var(--text-primary)" }}>
                      {req.username}
                    </span>
                    <Show when={req.created_at}>
                      <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
                        {new Date(req.created_at).toLocaleDateString()}
                      </span>
                    </Show>
                    <button
                      onClick={() => handleApprove(req.id)}
                      style={{
                        "font-size": "10px",
                        color: "var(--success, #4caf50)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      [approve]
                    </button>
                    <button
                      onClick={() => handleDeny(req.id)}
                      style={{
                        "font-size": "10px",
                        color: "var(--danger)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      [deny]
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
