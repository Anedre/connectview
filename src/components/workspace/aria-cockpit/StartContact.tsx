/* ============================================================
   ARIA · Cockpit · Iniciar contacto (idle) — MODO DEMO
   Réplica en mock del OutboundActionsMenu real: tiles Quick
   connects · Capturar lead · Tarea · Email. Al elegir un tile se
   expande su sub-panel mock in-place (como el real). Reutiliza
   .tl__ico .card INP_STYLE <Btn> — NO rediseña nada.
   ============================================================ */
import { useState } from "react";
import { Btn, Icon } from "@/components/aria";
import { AG_START_TILES, AG_QUICK_CONNECTS, DEMO_PROGRAMAS } from "./mockData";
import { INP_STYLE } from "./styles";

type View = "menu" | "quick" | "lead" | "task" | "email";

const TITLES: Record<Exclude<View, "menu">, string> = {
  quick: "Quick connects",
  lead: "Capturar lead",
  task: "Crear tarea",
  email: "Nuevo email",
};

function SubHeader({ view, onBack }: { view: Exclude<View, "menu">; onBack: () => void }) {
  return (
    <div className="row gap8" style={{ marginBottom: 12 }}>
      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Volver" onClick={onBack}>
        <Icon name="chevL" size={14} />
      </button>
      <b style={{ fontSize: 13 }}>{TITLES[view]}</b>
    </div>
  );
}

function QuickConnects({ onCall }: { onCall: (label: string) => void }) {
  return (
    <div className="col gap6">
      {AG_QUICK_CONNECTS.map((qc) => (
        <button
          key={qc.name}
          type="button"
          className="row gap10"
          onClick={() => onCall(qc.name)}
          style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--bg-2)", border: "1px solid var(--border-1)", cursor: "pointer", textAlign: "left" }}
        >
          <div className="tl__ico" style={{ ["--_c" as string]: "var(--cyan)", width: 30, height: 30, flex: "0 0 auto" }}>
            <Icon name={qc.type === "Cola" ? "users" : "user"} size={14} />
          </div>
          <div className="grow">
            <b style={{ fontSize: 13 }}>{qc.name}</b>
            <div className="dim" style={{ fontSize: 11.5 }}>
              {qc.type}
            </div>
          </div>
          <Icon name="phone" size={14} style={{ color: "var(--text-3)" }} />
        </button>
      ))}
    </div>
  );
}

function LeadForm() {
  return (
    <div className="col gap10">
      <input placeholder="Nombres" style={INP_STYLE} />
      <input placeholder="Apellidos" style={INP_STYLE} />
      <input placeholder="Teléfono (ej. +51953730189)" style={INP_STYLE} />
      <select style={INP_STYLE} defaultValue="adm27">
        {DEMO_PROGRAMAS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <Btn variant="primary" icon="userplus" style={{ width: "100%" }}>
        Capturar lead
      </Btn>
    </div>
  );
}

function TaskForm() {
  return (
    <div className="col gap10">
      <input placeholder="Título de la tarea" style={INP_STYLE} />
      <textarea rows={3} placeholder="Descripción…" style={{ ...INP_STYLE, resize: "vertical" }} />
      <input type="datetime-local" style={INP_STYLE} />
      <Btn variant="primary" icon="check" style={{ width: "100%" }}>
        Crear tarea
      </Btn>
    </div>
  );
}

function EmailForm() {
  return (
    <div className="col gap10">
      <input placeholder="Para (email)" style={INP_STYLE} />
      <input placeholder="Asunto" style={INP_STYLE} />
      <textarea rows={4} placeholder="Mensaje…" style={{ ...INP_STYLE, resize: "vertical" }} />
      <Btn variant="primary" icon="send" style={{ width: "100%" }}>
        Enviar email
      </Btn>
    </div>
  );
}

export function StartContact({
  onCall,
  variant = "tiles",
}: {
  onCall: (phone: string) => void;
  /** "tiles" = grid 2-col (tab); "rail" = columna flotante al costado. */
  variant?: "tiles" | "rail";
}) {
  const [view, setView] = useState<View>("menu");

  if (view !== "menu") {
    return (
      <div>
        <SubHeader view={view} onBack={() => setView("menu")} />
        {view === "quick" && <QuickConnects onCall={onCall} />}
        {view === "lead" && <LeadForm />}
        {view === "task" && <TaskForm />}
        {view === "email" && <EmailForm />}
      </div>
    );
  }

  if (variant === "rail") {
    return (
      <div className="actrail">
        <div className="actrail__hd">Más acciones</div>
        {AG_START_TILES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="actrail__btn"
            onClick={() => setView(t.id as Exclude<View, "menu">)}
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
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {AG_START_TILES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setView(t.id as Exclude<View, "menu">)}
          className="card card__pad"
          style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}
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
  );
}
