/* ============================================================
   ARIA · Cockpit · Transcript (burbujas por sentimiento)
   Portado de aria-agent.jsx. Generalizado: por defecto usa la
   data mock (AG_TX), pero acepta `lines` para el rediseño REAL
   (transcripción de Contact Lens mapeada a este shape).
   ============================================================ */
import type { ReactNode } from "react";
import { Av, Card } from "@/components/aria";
import { AG_TX, type DemoTx } from "./mockData";

const SENT_COLOR: Record<string, string> = {
  neutral: "var(--text-3)",
  positivo: "var(--green)",
  mixto: "var(--gold)",
  negativo: "var(--red)",
};

export function Transcript({
  lines = AG_TX,
  agentName = "Camila R",
  customerName = "Andre A",
  extra,
  footer,
  emptyHint,
}: {
  lines?: DemoTx[];
  agentName?: string;
  customerName?: string;
  /** Slot en la cabecera (por defecto el indicador "Contact Lens"). */
  extra?: ReactNode;
  /** Slot al final (por defecto "Cliente escribiendo…"). */
  footer?: ReactNode;
  /** Se muestra cuando no hay líneas. */
  emptyHint?: ReactNode;
}) {
  const headExtra =
    extra !== undefined ? (
      extra
    ) : (
      <span className="row gap8">
        <span className="dot dot--live" />
        <span className="dim" style={{ fontSize: 12 }}>
          Contact Lens
        </span>
      </span>
    );
  return (
    <Card title="Transcripción en vivo" icon="mic" extra={headExtra}>
      <div className="col gap11">
        {lines.length === 0 && emptyHint}
        {lines.map((l, i) => (
          <div
            key={i}
            style={{ display: "flex", gap: 10, flexDirection: l.who === "Agente" ? "row" : "row-reverse" }}
          >
            <Av
              name={l.who === "Agente" ? agentName : customerName}
              size={28}
              color={l.who === "Agente" ? "var(--accent)" : "var(--cyan)"}
            />
            <div
              style={{
                maxWidth: "80%",
                padding: "9px 12px",
                borderRadius: 12,
                fontSize: 13.5,
                lineHeight: 1.5,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderLeft: "3px solid " + (l.who === "Agente" ? "var(--accent)" : SENT_COLOR[l.s]),
              }}
            >
              {l.text}
            </div>
          </div>
        ))}
        {footer !== undefined ? (
          footer
        ) : (
          <div className="row gap8" style={{ color: "var(--text-3)", fontSize: 12, padding: "2px 4px" }}>
            <span className="dot dot--live" />
            Cliente escribiendo…
          </div>
        )}
      </div>
    </Card>
  );
}
