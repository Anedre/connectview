import { useState } from "react";
import { useCCP } from "@/hooks/useCCP";
import { SoftphoneDialer } from "@/components/vox/SoftphoneDialer";
import { QuickConnectsList } from "./QuickConnectsList";
import { CreateTaskForm } from "./CreateTaskForm";
import { NewEmailForm } from "./NewEmailForm";
import * as Icon from "@/components/vox/primitives";

type View = "menu" | "number-pad" | "quick-connects" | "create-task" | "new-email";

/**
 * Outbound actions menu — vertical stack of 4 pill-shaped buttons
 * modeled on the native Amazon Connect CCP. Selecting a pill expands
 * the corresponding sub-view IN-PLACE inside the same softphone column
 * (no modals, no overlays). The agent always sees:
 *
 *   [< Atrás · Title]   ← back row when sub-view active
 *   [sub-view body]
 *
 * Sub-views:
 *   - Number pad     → embedded SoftphoneDialer
 *   - Quick connects → embedded QuickConnectsList
 *   - Create Task    → "Próximamente" panel (needs backend wiring)
 *   - New Email      → "Próximamente" panel (needs Connect Email)
 */
export function OutboundActionsMenu() {
  const { agentState } = useCCP();
  const [view, setView] = useState<View>("menu");

  const canOutbound =
    agentState === "Available" ||
    agentState === "Busy" ||
    agentState === "AfterCallWork";

  // ───────────────────────── Sub-view router ─────────────────────
  if (view !== "menu") {
    const TITLES: Record<Exclude<View, "menu">, string> = {
      "number-pad": "Marcador",
      "quick-connects": "Quick connects",
      "create-task": "Crear tarea",
      "new-email": "Nuevo email",
    };
    const ICONS: Record<Exclude<View, "menu">, React.ReactNode> = {
      "number-pad": <Icon.Pad size={14} />,
      "quick-connects": <Icon.User size={14} />,
      "create-task": <Icon.Note size={14} />,
      "new-email": <Icon.Mail size={14} />,
    };

    return (
      <div
        style={{
          padding: "14px 14px 18px",
          borderTop: "1px solid var(--border-1)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Back row — replaces the section header so the column stays
            compact and the agent always knows how to return. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setView("menu")}
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Volver al menú"
            title="Volver al menú"
          >
            <Icon.ArrowLeft size={14} />
          </button>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--text-1)",
            }}
          >
            {ICONS[view]}
            {TITLES[view]}
          </span>
        </div>

        {/* Sub-view body. The SoftphoneDialer & QuickConnectsList own
            their own internal layout; we just give them the column. */}
        {view === "number-pad" && (
          <div style={{ margin: "0 -14px -18px" }}>
            {/* Negative margins cancel the parent padding so the dialer's
                own internal padding (14px) lines up flush with the column
                edges, matching how it looked before this refactor. */}
            <SoftphoneDialer />
          </div>
        )}

        {view === "quick-connects" && (
          <QuickConnectsList onConnected={() => setView("menu")} />
        )}

        {view === "create-task" && (
          <CreateTaskForm onCreated={() => setView("menu")} />
        )}

        {view === "new-email" && (
          <NewEmailForm onSent={() => setView("menu")} />
        )}
      </div>
    );
  }

  // ───────────────────────── Menu (default) ──────────────────────
  const pills: Array<{
    key: Exclude<View, "menu">;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: "quick-connects", label: "Quick connects", icon: <Icon.User size={14} /> },
    { key: "number-pad", label: "Number pad", icon: <Icon.Pad size={14} /> },
    { key: "create-task", label: "Create Task", icon: <Icon.Note size={14} /> },
    { key: "new-email", label: "New Email", icon: <Icon.Mail size={14} /> },
  ];

  return (
    <div
      style={{
        padding: "14px 16px 18px",
        borderTop: "1px solid var(--border-1)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        className="muted"
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          textAlign: "center",
          marginBottom: 2,
        }}
      >
        Iniciar contacto
      </div>
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => setView(p.key)}
          className="pill-btn"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--accent-cyan-soft, rgba(34, 184, 217, 0.35))",
            color: "var(--accent-cyan, #5DD4F0)",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-ui)",
            cursor: "pointer",
            transition: "background 120ms ease, border-color 120ms ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--accent-cyan-soft, rgba(34, 184, 217, 0.12))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          {p.icon}
          <span>{p.label}</span>
        </button>
      ))}
      {!canOutbound && (
        <div
          className="muted"
          style={{
            fontSize: 10.5,
            textAlign: "center",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          Cambia tu estado a Available para Quick connects
        </div>
      )}
    </div>
  );
}

