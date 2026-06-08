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

  // Only allow outbound when idle and available. While Busy/ACW the agent
  // is in or wrapping up a contact — placing a fresh outbound from here
  // would create a confusing parallel leg.
  const canOutbound = agentState === "Available";

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
  const cards: Array<{
    key: Exclude<View, "menu">;
    label: string;
    sub: string;
    color: string;
    icon: React.ReactNode;
  }> = [
    {
      key: "number-pad",
      label: "Marcador",
      sub: "Llamar a un número",
      color: "var(--accent-green)",
      icon: <Icon.Pad size={16} />,
    },
    {
      key: "quick-connects",
      label: "Quick connects",
      sub: "Colas y agentes",
      color: "var(--accent-cyan)",
      icon: <Icon.User size={16} />,
    },
    {
      key: "create-task",
      label: "Tarea",
      sub: "Crear seguimiento",
      color: "var(--accent-violet)",
      icon: <Icon.Note size={16} />,
    },
    {
      key: "new-email",
      label: "Email",
      sub: "Enviar correo",
      color: "var(--accent-amber)",
      icon: <Icon.Mail size={16} />,
    },
  ];

  return (
    <div className="vox-start">
      <div className="vox-start__title">Iniciar contacto</div>
      <div className="vox-start__grid">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setView(c.key)}
            className="vox-start__card"
            style={{ ["--vsa" as string]: c.color }}
          >
            <span className="vox-start__card-icon">{c.icon}</span>
            <div>
              <div className="vox-start__card-label">{c.label}</div>
              <div className="vox-start__card-sub">{c.sub}</div>
            </div>
          </button>
        ))}
      </div>
      {!canOutbound && (
        <div
          className="muted"
          style={{
            fontSize: 11,
            textAlign: "center",
            lineHeight: 1.5,
            padding: "6px 0 2px",
          }}
        >
          Cambia tu estado a Available para Quick connects
        </div>
      )}
    </div>
  );
}

