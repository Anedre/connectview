/* ============================================================
   ARIA · Cockpit · Llamadas perdidas (idle)
   Réplica en mock de MissedCallBanner + MissedHistoryDrawer:
   una card-aviso que despliega la lista de perdidas (reintentar /
   ver). Reutiliza .card .tl__ico .chdot .btn — NO rediseña nada.

   GENERALIZADO: acepta `items` reales por props (desde
   useMissedContactsHistory). Sin props → cae al mock (MODO DEMO).
   Si `items` viene como [] la card no se renderiza (nada perdido).
   ============================================================ */
import { useState } from "react";
import { Btn, Icon, Pill } from "@/components/aria";
import { AG_MISSED } from "./mockData";

const CH_ICON: Record<string, string> = { voz: "phone", wa: "wa", email: "mail" };

/** Fila normalizada — sirve tanto al mock como a los datos reales. */
export interface MissedItem {
  id: string;
  name: string;
  phone: string;
  /** Canal en la nomenclatura de la demo ("voz" | "wa" | "email"). */
  channel: string;
  prog: string;
  ago: string;
  reason: string;
  /** Solo voz con teléfono puede reintentarse. */
  canRetry?: boolean;
}

/** Adapta AG_MISSED (mock) al shape MissedItem. */
function fromMock(): MissedItem[] {
  return AG_MISSED.map((m) => ({
    ...m,
    canRetry: m.channel === "voz",
  }));
}

function MissedRow({ m, onCall }: { m: MissedItem; onCall: (phone: string) => void }) {
  const retry = m.canRetry ?? m.channel === "voz";
  return (
    <div
      className="row gap10"
      style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--bg-2)", border: "1px solid var(--border-1)" }}
    >
      <div className="tl__ico" style={{ ["--_c" as string]: "var(--red)", width: 30, height: 30, flex: "0 0 auto" }}>
        <Icon name={CH_ICON[m.channel] || "phone"} size={14} />
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap8">
          <b style={{ fontSize: 13 }}>{m.name}</b>
          <span className="mono dim" style={{ fontSize: 11 }}>
            {m.phone}
          </span>
        </div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 1 }}>
          {[m.prog, m.ago, m.reason].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="row gap6" style={{ flex: "0 0 auto" }}>
        {retry && (
          <Btn variant="soft" size="sm" icon="phone" onClick={() => onCall(m.phone)}>
            Reintentar
          </Btn>
        )}
      </div>
    </div>
  );
}

export function MissedCalls({
  onCall,
  items,
  hint = "24 h",
}: {
  onCall: (phone: string) => void;
  /** Perdidas reales. undefined = mock (demo). [] = ocultar la card. */
  items?: MissedItem[];
  /** Pill superior derecha (ventana temporal). */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = items ?? fromMock();
  const n = list.length;

  // Datos reales sin perdidas → no ensuciamos la cabina idle.
  if (items && n === 0) return null;

  return (
    <div className="card" style={{ borderColor: "color-mix(in srgb,var(--red) 30%,var(--border-1))" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="card__pad"
        style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, background: "var(--red-soft)" }}
      >
        <div className="tl__ico" style={{ ["--_c" as string]: "var(--red)", flex: "0 0 auto" }}>
          <Icon name="missed" size={16} />
        </div>
        <div className="grow">
          <div className="row gap8">
            <b style={{ fontSize: 13.5 }}>
              Tienes {n} {n === 1 ? "llamada perdida" : "llamadas perdidas"}
            </b>
            <Pill tone="red">{hint}</Pill>
          </div>
          <div className="dim" style={{ fontSize: 12 }}>
            Devuélvelas antes de que se enfríen.
          </div>
        </div>
        <Icon name={open ? "chevU" : "chevD"} size={16} style={{ color: "var(--text-3)" }} />
      </button>
      {open && (
        <div className="card__pad" style={{ paddingTop: 0 }}>
          <div className="col gap8">
            {list.map((m) => (
              <MissedRow key={m.id} m={m} onCall={onCall} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
