import { For } from "solid-js";
import { commands, categoryLabels, type CommandCategory } from "../commandRegistry";
import { currentUser } from "../../../stores/auth";
import TerminalDialog from "../TerminalDialog";

interface HelpDialogProps {
  onClose: () => void;
}

export default function HelpDialog(props: HelpDialogProps) {
  const isAdmin = () => currentUser()?.is_admin ?? false;

  const categories = () => {
    const grouped = new Map<CommandCategory, typeof commands>();
    for (const cmd of commands) {
      if (cmd.adminOnly && !isAdmin()) continue;
      const list = grouped.get(cmd.category) || [];
      list.push(cmd);
      grouped.set(cmd.category, list);
    }
    return Array.from(grouped.entries());
  };

  return (
    <TerminalDialog title="HELP" onClose={props.onClose}>
      <For each={categories()}>
        {([cat, cmds]) => (
          <div style={{ "margin-bottom": "12px" }}>
            <div
              style={{
                "font-size": "11px",
                "font-weight": "600",
                "text-transform": "uppercase",
                "letter-spacing": "1px",
                color: "var(--accent)",
                "margin-bottom": "4px",
                "border-bottom": "1px solid var(--border-gold)",
                "padding-bottom": "2px",
              }}
            >
              {categoryLabels[cat]}
            </div>
            <For each={cmds}>
              {(cmd) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "2px 0",
                    "font-size": "12px",
                    "align-items": "baseline",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary)",
                      "font-weight": "600",
                      "min-width": "140px",
                      "flex-shrink": "0",
                    }}
                  >
                    /{cmd.name}
                    {cmd.args ? (
                      <span style={{ color: "var(--text-muted)", "font-weight": "400" }}>
                        {" "}{cmd.args}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{cmd.description}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </TerminalDialog>
  );
}
