import { Card, CardBody } from "@/components/vox/primitives";
import { ShieldCheck, AlertTriangle, Link2, RefreshCw } from "lucide-react";
import { useWhatsAppHealth, type WaNumberHealth } from "@/hooks/useWhatsAppHealth";

/**
 * WhatsAppHealthPanel — Pilar 4 · #13. Muestra el quality rating de cada número
 * de WhatsApp + el modo (anclado a Connect vs Meta standalone) con sus
 * capacidades de deliverability. Vive en Configuración → Canales.
 */

const QUALITY: Record<string, { label: string; chip: string; dot: string }> = {
  GREEN: { label: "Calidad alta", chip: "chip--green", dot: "var(--accent-green)" },
  YELLOW: { label: "Calidad media", chip: "chip--amber", dot: "var(--accent-amber)" },
  RED: { label: "Calidad baja", chip: "chip--red", dot: "var(--accent-red)" },
  UNKNOWN: { label: "Sin dato", chip: "", dot: "var(--text-3)" },
};

function QualityChip({ rating }: { rating: string }) {
  const q = QUALITY[rating] || QUALITY.UNKNOWN;
  return (
    <span className={`chip ${q.chip}`} style={q.chip ? undefined : { color: "var(--text-3)" }}>
      <span className="dot" style={{ background: q.dot }} /> {q.label} · {rating}
    </span>
  );
}

export function WhatsAppHealthPanel() {
  const { health, loading, reload } = useWhatsAppHealth();

  if (loading) {
    return (
      <Card><CardBody><div className="muted" style={{ fontSize: 12.5, padding: 6 }}>Cargando salud de WhatsApp…</div></CardBody></Card>
    );
  }
  if (!health || !health.configured || health.wabas.length === 0) {
    return (
      <Card>
        <CardBody>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Salud del número de WhatsApp</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {health?.error ? `No se pudo leer la salud: ${health.error}` : "No hay un número de WhatsApp configurado todavía."}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 9, alignItems: "center" }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: "var(--accent-green-soft)", color: "var(--accent-green)" }}>
              <ShieldCheck size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Salud del número de WhatsApp</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                Calidad de Meta + modo de integración. Protege tu número de baneos.
              </div>
            </div>
          </div>
          <button className="btn btn--sm" onClick={reload}><RefreshCw size={12} /> Actualizar</button>
        </div>

        {health.alert && (
          <div
            style={{
              display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12,
              borderRadius: 10, padding: "10px 12px",
              border: `1px solid ${health.alert.level === "critical" ? "var(--accent-red)" : "var(--accent-amber)"}`,
              background: health.alert.level === "critical" ? "var(--accent-red-soft)" : "var(--accent-amber-soft)",
            }}
          >
            <AlertTriangle size={16} style={{ color: health.alert.level === "critical" ? "var(--accent-red)" : "var(--accent-amber)", flex: "0 0 auto", marginTop: 1 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-1)" }}>{health.alert.message}</div>
          </div>
        )}

        <div className="col" style={{ gap: 12, marginTop: 14 }}>
          {health.wabas.map((w) => (
            <div key={w.wabaId || w.wabaName} style={{ borderRadius: 11, border: "1px solid var(--border-1)", background: "var(--bg-1)", padding: "12px 14px" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{w.wabaName}</div>
                {/* Modo + capacidad de deliverability (dual-mode) */}
                {w.anchoredToConnect ? (
                  <span className="row" style={{ gap: 5, alignItems: "center", fontSize: 11.5, color: "var(--accent-cyan)", fontWeight: 600 }}>
                    <Link2 size={12} /> Anclado a Amazon Connect
                  </span>
                ) : (
                  <span className="row" style={{ gap: 5, alignItems: "center", fontSize: 11.5, color: "var(--accent-green)", fontWeight: 600 }}>
                    <ShieldCheck size={12} /> Meta standalone
                  </span>
                )}
              </div>

              {/* Números */}
              <div className="col" style={{ gap: 8, marginTop: 10 }}>
                {w.numbers.map((n: WaNumberHealth, i) => (
                  <div key={n.metaPhoneNumberId || i} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{n.phoneNumber || "—"}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {n.displayName}{n.registrationStatus ? ` · ${n.registrationStatus === "COMPLETE" ? "registrado" : n.registrationStatus}` : ""}
                      </div>
                    </div>
                    <QualityChip rating={n.qualityRating} />
                  </div>
                ))}
              </div>

              {/* Nota de capacidad según el modo */}
              <div className="muted" style={{ fontSize: 11, marginTop: 11, lineHeight: 1.5, borderTop: "1px solid var(--border-1)", paddingTop: 9 }}>
                {w.anchoredToConnect ? (
                  <>📥 <b>Inbound integrado en Connect</b> (los chats entran como contactos del agente), pero el{" "}
                  <b>estado de entrega por-mensaje no está disponible</b> para este número — los eventos van a Connect.
                  Para ver entregado/leído por mensaje, conectá un número de WhatsApp de Meta <b>no anclado a Connect</b>.</>
                ) : (
                  <>✅ <b>Deliverability completa</b>: ARIA recibe los recibos de entrega (entregado/leído/fallido por mensaje) y cuarentena los números inválidos automáticamente.</>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
