import type { ElementType } from "react";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

interface Props {
  dialMode: string;
  /** Nº de agentes asignados — es lo que marca el ritmo real. */
  agentCount?: number;
}

/**
 * Ritmo de marcado — INFORMATIVO. Las campañas corren por AGENTES: en progressive
 * el discador lanza una llamada por agente libre; en manual el agente inicia cada
 * llamada él mismo. El ritmo lo da el nº de agentes asignados, no un número que
 * tunear — por eso el control de concurrencia (vestigio del modelo de pool
 * compartido) se quitó. Ver auditoría de campañas 2026-07.
 */
export function PacingControlCard({ dialMode, agentCount = 0 }: Props) {
  const isManual = String(dialMode || "").toLowerCase() === "manual";

  let accent = "var(--accent-green)";
  let Icn: ElementType = Icon.Users;
  let title = "";
  let sub = "";
  if (isManual) {
    accent = "var(--accent-cyan)";
    Icn = Icon.User;
    title = "Modo manual";
    sub = "Cada agente inicia sus llamadas desde su workspace. No hay marcación automática.";
  } else if (agentCount > 0) {
    accent = "var(--accent-green)";
    Icn = Icon.Users;
    title = `El ritmo lo marcan tus ${agentCount} agente${agentCount === 1 ? "" : "s"}`;
    sub = "El discador lanza una llamada por cada agente libre. Para acelerar, asigna más agentes.";
  } else {
    accent = "var(--accent-amber)";
    Icn = Icon.Users;
    title = "Sin agentes asignados";
    sub = "Asigna agentes abajo para que la campaña empiece a marcar.";
  }

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Lightning size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Ritmo de marcado
        </div>
      </div>
      <CardBody>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 12,
            background: `color-mix(in srgb, ${accent} 9%, var(--bg-1))`,
            border: `1px solid color-mix(in srgb, ${accent} 26%, transparent)`,
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 40,
              height: 40,
              borderRadius: 11,
              background: "var(--bg-1)",
              color: accent,
              flexShrink: 0,
            }}
          >
            <Icn size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 14 }}>{title}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
              {sub}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
