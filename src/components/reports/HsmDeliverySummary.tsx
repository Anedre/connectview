import { SegmentedRing } from "@/components/aria/SegmentedRing";

/**
 * HsmDeliverySummary — resumen visual de entrega de plantillas (HSM), con dos
 * anillos: ENTREGADOS (respondidos / leídos / no leídos) y NO ENTREGADOS
 * (fallidos / expirados / pendientes), + los KPIs de nivel de entrega y tiempo
 * de respuesta. Espeja el "HSM Shipment Summary" de los competidores, alimentado
 * por los datos que ARIA ya trackea en get-hsm-report.
 */

interface Response {
  respondedPhones: number;
  sentPhones: number;
  responseRate: number;
  avgFirstResponseSec: number | null;
  inboundTracked: boolean;
}

const fmtDur = (sec: number | null): string => {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

function Legend({ rows }: { rows: { color: string; label: string; value: number; of: number }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: 1 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: r.color,
              flex: "0 0 auto",
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>{r.label}</span>
              <span
                style={{
                  fontWeight: 700,
                  color: "var(--text-1)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct(r.value, r.of).toFixed(2)}%
              </span>
            </div>
            {/* barra fina proporcional */}
            <div
              style={{
                height: 4,
                borderRadius: 3,
                background: "color-mix(in srgb, var(--accent-violet) 12%, transparent)",
                marginTop: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, pct(r.value, r.of))}%`,
                  height: "100%",
                  background: r.color,
                }}
              />
            </div>
          </div>
          <span
            style={{
              fontSize: 11.5,
              color: "var(--text-3)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 24,
              textAlign: "right",
            }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function RingBlock({
  title,
  tone,
  reached,
  total,
  pctLabel,
  segments,
  legend,
}: {
  title: string;
  tone: string;
  reached: number;
  total: number;
  pctLabel: string;
  segments: { value: number; color: string }[];
  legend: { color: string; label: string; value: number; of: number }[];
}) {
  return (
    <div
      style={{
        flex: "1 1 300px",
        minWidth: 0,
        border: "1px solid var(--border-1)",
        borderRadius: 12,
        background: "var(--bg-1)",
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-3)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        {/* Doble anillo concéntrico (como Chattigo): exterior = desglose,
            interior = la tasa (arco de progreso). */}
        <SegmentedRing
          size={168}
          thickness={9}
          gapDeg={3}
          track="color-mix(in srgb, var(--accent-violet) 16%, transparent)"
          segments={segments}
          center={
            <SegmentedRing
              size={124}
              thickness={9}
              gapDeg={2}
              track="color-mix(in srgb, var(--accent-violet) 16%, transparent)"
              segments={[
                { value: reached, color: tone },
                { value: Math.max(0, total - reached), color: "transparent" },
              ]}
              center={
                <div>
                  <div
                    style={{
                      fontSize: 30,
                      fontWeight: 800,
                      color: tone,
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {reached}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                    / {total}
                  </div>
                  <div
                    style={{
                      fontSize: 9.5,
                      color: "var(--text-3)",
                      marginTop: 4,
                      maxWidth: 78,
                      lineHeight: 1.3,
                      fontWeight: 600,
                    }}
                  >
                    {pctLabel}
                  </div>
                </div>
              }
            />
          }
        />
        <Legend rows={legend} />
      </div>
    </div>
  );
}

export function HsmDeliverySummary({
  totals,
  response,
  rates,
}: {
  totals: Record<string, number>;
  response?: Response;
  rates: { readRate: number; failRate: number };
}) {
  const total = totals.total || 0;
  if (total === 0) return null;

  const read = totals.read || 0;
  const deliveredOnly = totals.delivered || 0; // entregado pero no leído
  const reachedDelivered = deliveredOnly + read; // llegó al teléfono
  const failed = totals.failed || 0;
  const expired = totals.expired || 0;
  const pendingRaw = (totals.pending || 0) + (totals.sent || 0); // en vuelo / sin confirmar
  const undelivered = failed + expired + pendingRaw;

  const tracked = !!response?.inboundTracked;
  const replied = tracked ? Math.min(response!.respondedPhones || 0, read) : 0;
  const readNotReplied = Math.max(0, read - replied);

  const cGreen = "var(--accent-green)";
  const cViolet = "var(--accent-violet)";
  const cCyan = "var(--accent-cyan)";
  const cRed = "var(--accent-red)";
  const cAmber = "var(--accent-amber)";
  const cNavy = "var(--accent)"; // "Pendientes" en azul de marca (no gris)

  const deliveredSegs = [
    ...(tracked ? [{ value: replied, color: cGreen }] : []),
    { value: readNotReplied, color: cViolet },
    { value: deliveredOnly, color: cCyan },
  ];
  const undeliveredSegs = [
    { value: failed, color: cRed },
    { value: expired, color: cAmber },
    { value: pendingRaw, color: cNavy },
  ];

  const kpi = (label: string, value: string, color: string) => (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 0,
        border: "1px solid var(--border-1)",
        borderRadius: 12,
        background: "var(--bg-1)",
        padding: "14px 16px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }}
      />
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {kpi("Nivel de entregados", `${Math.round(pct(reachedDelivered, total))}%`, cCyan)}
        {kpi(
          "Nivel de no entregados",
          `${Math.round(pct(undelivered, total))}%`,
          undelivered > 0 ? cRed : cNavy,
        )}
        {kpi(
          "Tiempo de respuesta prom.",
          tracked ? fmtDur(response!.avgFirstResponseSec) : "—",
          cGreen,
        )}
      </div>

      {/* Donas */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <RingBlock
          title="Mensajes entregados"
          tone={cCyan}
          reached={reachedDelivered}
          total={total}
          pctLabel={`${Math.round(pct(reachedDelivered, total))}% entregados`}
          segments={deliveredSegs}
          legend={[
            ...(tracked
              ? [{ color: cGreen, label: "Respondidos", value: replied, of: reachedDelivered }]
              : []),
            { color: cViolet, label: "Leídos", value: readNotReplied, of: reachedDelivered },
            {
              color: cCyan,
              label: "Entregados (no leídos)",
              value: deliveredOnly,
              of: reachedDelivered,
            },
          ]}
        />
        <RingBlock
          title="Mensajes no entregados"
          tone={undelivered > 0 ? cRed : cNavy}
          reached={undelivered}
          total={total}
          pctLabel={`${Math.round(pct(undelivered, total))}% no entregados`}
          segments={undeliveredSegs}
          legend={[
            { color: cRed, label: "Fallidos", value: failed, of: undelivered },
            { color: cAmber, label: "Expirados", value: expired, of: undelivered },
            { color: cNavy, label: "Pendientes", value: pendingRaw, of: undelivered },
          ]}
        />
      </div>

      {/* nota de tasas (espeja lo que ya decía el reporte) */}
      <div className="muted" style={{ fontSize: 11 }}>
        Tasa de lectura <b>{rates.readRate}%</b> (leídos / entregados) · Tasa de fallo{" "}
        <b>{rates.failRate}%</b>
        {!tracked &&
          " · el tiempo de respuesta y los respondidos se miden desde números Meta no anclados a Connect"}
      </div>
    </div>
  );
}
