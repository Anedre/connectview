import { useState } from "react";
import { useCCP } from "@/hooks/useCCP";
import { QuickConnectsList } from "./QuickConnectsList";
import { CreateTaskForm } from "./CreateTaskForm";
import { NewEmailForm } from "./NewEmailForm";
import { QuickCaptureLeadForm } from "./QuickCaptureLeadForm";
import { Icon } from "@/components/aria";

type View = "menu" | "quick-connects" | "create-task" | "new-email" | "capture-lead";

/**
 * Outbound actions menu — tiles al estilo de la "Vista demo" (StartContact
 * del aria-cockpit): cuadrícula 2-col sobre `.card` con ícono en cuadrito de
 * color (`.tl__ico`) + título + subtítulo. Al elegir un tile se expande su
 * sub-vista IN-PLACE dentro de la misma columna (sin modales ni overlays):
 *
 *   [< Volver · Título]   ← fila de retorno con la sub-vista activa
 *   [cuerpo de la sub-vista]
 *
 * El tile "Marcador" se omite a propósito: el Dialer que envuelve este menú
 * ya expone su propia pestaña "Marcador". Sub-vistas reales preservadas:
 *   - Quick connects → QuickConnectsList embebido (Amazon Connect)
 *   - Capturar lead  → QuickCaptureLeadForm
 *   - Tarea          → CreateTaskForm
 *   - Email          → NewEmailForm
 */
export function OutboundActionsMenu({
  hideTitle = false,
  variant = "tiles",
}: {
  /** Oculta el encabezado "Iniciar contacto" del menú — útil cuando el
   *  componente se embebe dentro de una Card que ya lleva ese título
   *  (p.ej. la pestaña "Más acciones" del cockpit idle). Sin la prop,
   *  el título se muestra (comportamiento original del softphone .call). */
  hideTitle?: boolean;
  /** "tiles" = grid 2-col; "rail" = columna flotante al costado del
   *  marcador (aprovecha el espacio lateral del tab Marcador). */
  variant?: "tiles" | "rail";
} = {}) {
  const { agentState } = useCCP();
  const [view, setView] = useState<View>("menu");

  // Only allow outbound when idle and available. While Busy/ACW the agent
  // is in or wrapping up a contact — placing a fresh outbound from here
  // would create a confusing parallel leg.
  const canOutbound = agentState === "Available";

  // ───────────────────────── Sub-view router ─────────────────────
  if (view !== "menu") {
    const TITLES: Record<Exclude<View, "menu">, string> = {
      "quick-connects": "Quick connects",
      "create-task": "Crear tarea",
      "new-email": "Nuevo email",
      "capture-lead": "Capturar lead",
    };

    return (
      <div>
        {/* Fila "Volver" — estilo demo (SubHeader del StartContact):
            botón fantasma pequeño + título de la sub-vista. */}
        <div className="row gap8" style={{ marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setView("menu")}
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Volver al menú"
            title="Volver al menú"
          >
            <Icon name="chevL" size={14} />
          </button>
          <b style={{ fontSize: 13 }}>{TITLES[view]}</b>
        </div>

        {/* Cuerpo de la sub-vista. QuickConnectsList / los formularios
            manejan su propio layout interno; aquí sólo les damos la columna. */}
        {view === "quick-connects" && (
          <QuickConnectsList onConnected={() => setView("menu")} />
        )}
        {view === "create-task" && (
          <CreateTaskForm onCreated={() => setView("menu")} />
        )}
        {view === "new-email" && (
          <NewEmailForm onSent={() => setView("menu")} />
        )}
        {view === "capture-lead" && (
          <QuickCaptureLeadForm onCreated={() => setView("menu")} />
        )}
      </div>
    );
  }

  // ───────────────────────── Menu (default) ──────────────────────
  // Tiles al estilo demo: ícono en `.tl__ico` de color + label + sub.
  const tiles: Array<{
    key: Exclude<View, "menu">;
    label: string;
    sub: string;
    color: string;
    icon: string;
  }> = [
    {
      key: "quick-connects",
      label: "Quick connects",
      sub: "Colas y agentes",
      color: "var(--cyan)",
      icon: "users",
    },
    {
      key: "capture-lead",
      label: "Capturar lead",
      sub: "Referido / nuevo nº",
      color: "var(--green)",
      icon: "userplus",
    },
    {
      key: "create-task",
      label: "Tarea",
      sub: "Crear seguimiento",
      color: "var(--iris)",
      icon: "check",
    },
    {
      key: "new-email",
      label: "Email",
      sub: "Enviar correo",
      color: "var(--gold)",
      icon: "mail",
    },
  ];

  const outboundHint = !canOutbound ? (
    <div
      className="dim"
      style={{
        fontSize: 11,
        textAlign: "center",
        lineHeight: 1.5,
        padding: "10px 0 2px",
      }}
    >
      Cambia tu estado a Available para Quick connects
    </div>
  ) : null;

  // Rail: columna vertical de botones flotantes al costado del marcador.
  if (variant === "rail") {
    return (
      <div className="actrail">
        <div className="actrail__hd">Más acciones</div>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            className="actrail__btn"
            onClick={() => setView(t.key)}
          >
            <div className="tl__ico" style={{ ["--_c" as string]: t.color }}>
              <Icon name={t.icon} size={16} />
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="actrail__lbl">{t.label}</div>
              <div className="dim actrail__sub">{t.sub}</div>
            </div>
            <Icon name="chevR" size={15} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
          </button>
        ))}
        {outboundHint}
      </div>
    );
  }

  return (
    <div>
      {!hideTitle && (
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          Iniciar contacto
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className="card card__pad"
            style={{
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <div className="tl__ico" style={{ ["--_c" as string]: t.color }}>
              <Icon name={t.icon} size={16} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
              <div className="dim" style={{ fontSize: 11 }}>
                {t.sub}
              </div>
            </div>
          </button>
        ))}
      </div>
      {outboundHint}
    </div>
  );
}
