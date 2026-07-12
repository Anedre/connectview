import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Card, CardBody } from "@/components/vox/primitives";

/**
 * ConsumptionManager — Configuración → Consumo. Le explica al cliente cuánto gasta
 * en su Amazon Connect y su Meta (WhatsApp) según su uso de ARIA, con ESTIMACIÓN
 * (volumen × modelo de precios) y el COBRO REAL cuando hay fuente (WhatsApp vía la
 * Graph API del WABA; Connect vía Cost Explorer, build-ahead). Lo alimenta el
 * Lambda get-cost-report. Ver design/consumo.md.
 */

interface CostLine {
  component: string;
  label: string;
  group: "connect" | "meta" | "platform";
  volume: number;
  unit: string;
  unitCost: number;
  estimated: number;
  real: number | null;
  note?: string;
  free?: boolean;
}
interface CostReport {
  period: { from: string; to: string; days: number };
  currency: string;
  lines: CostLine[];
  summary: {
    connect: number;
    connectReal: number | null;
    meta: number;
    platform: number;
    platformReal: number | null;
    total: number;
    realTotal: number | null;
  };
  realAvailable: { whatsapp: boolean; connect: boolean; platform: boolean };
  notes?: Record<string, string>;
  generatedAt: string;
}

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PERIODS = [
  { d: 7, label: "7 días" },
  { d: 30, label: "30 días" },
  { d: 90, label: "90 días" },
];

const GROUP_META: Record<string, { title: string; color: string }> = {
  connect: { title: "Amazon Connect y AWS", color: "#FF9900" },
  meta: { title: "Meta · WhatsApp", color: "#25D366" },
  platform: { title: "Plataforma ARIA", color: "var(--accent-violet)" },
};

function Kpi({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 12,
        border: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        padding: "16px 18px",
        overflow: "hidden",
      }}
    >
      <span
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }}
      />
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color }}>{value}</div>
      {sub && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function ConsumptionManager() {
  const ep = getApiEndpoints();
  const endpoint = ep?.getCostReport;
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await authedFetch(`${endpoint}?days=${days}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j as CostReport);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar el consumo");
    } finally {
      setLoading(false);
    }
  }, [endpoint, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = ["connect", "meta", "platform"] as const;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Consumo</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 720, lineHeight: 1.5 }}
          >
            Lo que cuesta tu operación: <strong>tu Amazon Connect</strong>, <strong>tu Meta</strong>{" "}
            y la <strong>infraestructura de ARIA</strong> (Lambda, base de datos, identidad…) según
            tu uso. Mostramos la <strong>estimación</strong> (volumen × precios) y, cuando hay
            fuente, el <strong>cobro real</strong>.
          </div>
        </div>
        <div
          className="row"
          style={{
            gap: 6,
            border: "1px solid var(--border-2)",
            borderRadius: 8,
            overflow: "hidden",
            flex: "0 0 auto",
          }}
        >
          {PERIODS.map((p) => (
            <button
              key={p.d}
              onClick={() => setDays(p.d)}
              style={{
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                background: days === p.d ? "var(--bg-3)" : "transparent",
                color: days === p.d ? "var(--text-1)" : "var(--text-3)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!endpoint && (
        <Card>
          <CardBody>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              El reporte de consumo se habilita al desplegar el backend <code>get-cost-report</code>
              . Ya puedes ver el modelo de precios en <code>design/consumo.md</code>.
            </div>
          </CardBody>
        </Card>
      )}

      {endpoint && loading && !data && (
        <div className="muted" style={{ fontSize: 13, padding: "24px 4px" }}>
          Calculando consumo…
        </div>
      )}

      {endpoint && err && (
        <Card>
          <CardBody>
            <div style={{ color: "var(--accent-red)", fontSize: 13 }}>{err}</div>
          </CardBody>
        </Card>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 14,
            }}
          >
            <Kpi
              label="Amazon Connect y AWS"
              value={money(data.summary.connect)}
              color="#FF9900"
              sub={`estimado · ${data.period.days} días`}
            />
            <Kpi
              label="Meta · WhatsApp"
              value={money(data.summary.meta)}
              color="#25D366"
              sub="estimado"
            />
            <Kpi
              label="Plataforma ARIA"
              value={money(data.summary.platform)}
              color="var(--accent-violet)"
              sub="infra · estimado"
            />
            <Kpi
              label="Total estimado"
              value={money(data.summary.total)}
              color="var(--accent-cyan)"
              sub="Connect + Meta + Plataforma"
            />
            <Kpi
              label="Cobro real (parcial)"
              value={money(data.summary.realTotal)}
              color="var(--text-1)"
              sub={
                [
                  data.realAvailable.whatsapp && "WhatsApp (Meta)",
                  data.realAvailable.connect && "Connect (AWS)",
                ]
                  .filter(Boolean)
                  .join(" + ") || "conecta las fuentes de facturación"
              }
            />
          </div>

          {/* Aviso sobre el "real" */}
          <Card>
            <CardBody>
              <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                <strong>Estimado vs. real.</strong> La estimación usa tu volumen real (mensajes,
                llamadas, turnos de bot) × los precios del modelo (us-east-1). El{" "}
                <strong>cobro real</strong> se toma directo de la fuente:{" "}
                {data.realAvailable.whatsapp ? (
                  <span style={{ color: "var(--accent-green)" }}>
                    WhatsApp ✓ conectado (Graph de Meta)
                  </span>
                ) : (
                  <span>WhatsApp — conecta tu número de Meta para verlo</span>
                )}
                {"; "}
                {data.realAvailable.connect ? (
                  <span style={{ color: "var(--accent-green)" }}>Connect ✓</span>
                ) : (
                  <span>
                    Connect — el cobro real de AWS se activa dando permiso de facturación (Cost
                    Explorer) a tu rol de acceso.
                  </span>
                )}
                . Las tarifas de telefonía Perú están marcadas a validar.
              </div>
            </CardBody>
          </Card>

          {/* Desglose por grupo */}
          {groups.map((g) => {
            const rows = data.lines.filter((l) => l.group === g);
            if (!rows.length) return null;
            const gm = GROUP_META[g];
            return (
              <Card key={g}>
                <CardBody flush>
                  <div
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border-1)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{ width: 9, height: 9, borderRadius: "50%", background: gm.color }}
                    />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{gm.title}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="t" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th style={{ textAlign: "right" }}>Volumen</th>
                          <th style={{ textAlign: "right" }}>Estimado</th>
                          <th style={{ textAlign: "right" }}>Real</th>
                          <th style={{ textAlign: "right" }}>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((l) => {
                          // Real efectivo: número real; o $0 cuando es gratis-por-diseño
                          // (IAM) o plataforma RASTREADA por tag sin costo facturado (→ gratis).
                          // Si no, null = real no atribuible (Connect por-fila sin CE).
                          const platformTracked = g === "platform" && data.realAvailable.platform;
                          const effReal =
                            l.real != null ? l.real : l.free || platformTracked ? 0 : null;
                          const isFreeZero = l.real == null && effReal === 0;
                          const delta = effReal != null ? effReal - l.estimated : null;
                          return (
                            <tr key={l.component}>
                              <td>
                                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{l.label}</div>
                                {l.note && (
                                  <div
                                    className="muted"
                                    style={{
                                      fontSize: 10.5,
                                      lineHeight: 1.45,
                                      marginTop: 2,
                                      maxWidth: 460,
                                    }}
                                  >
                                    {l.note}
                                  </div>
                                )}
                              </td>
                              <td
                                style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12 }}
                              >
                                {l.volume.toLocaleString("es-PE")}{" "}
                                <span className="muted">{l.unit}</span>
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  fontWeight: 600,
                                  fontSize: 12.5,
                                }}
                              >
                                {money(l.estimated)}
                              </td>
                              <td
                                style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5 }}
                              >
                                {effReal != null ? (
                                  <>
                                    {money(effReal)}
                                    {isFreeZero && (
                                      <span
                                        className="muted"
                                        style={{ fontSize: 10, marginLeft: 4 }}
                                      >
                                        · gratis
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td
                                style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12 }}
                              >
                                {delta == null ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <span
                                    style={{
                                      color:
                                        delta > 0 ? "var(--accent-red)" : "var(--accent-green)",
                                    }}
                                  >
                                    {delta > 0 ? "+" : ""}
                                    {money(delta)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {g === "connect" && data.summary.connectReal != null && (
                    <div
                      style={{
                        padding: "10px 16px",
                        borderTop: "1px solid var(--border-1)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className="muted"
                        style={{ fontSize: 11.5, maxWidth: 560, lineHeight: 1.5 }}
                      >
                        <strong style={{ color: "var(--text-1)" }}>Cobro real de AWS</strong> (Cost
                        Explorer): todo el gasto de Amazon Connect y servicios asociados (Voz,
                        WhatsApp, Bedrock, y también <b>renta de números y telefonía</b>) en tu
                        cuenta este período. Por eso <b>puede superar la suma de las filas</b>{" "}
                        estimadas. La facturación de AWS tiene ~24 h de retraso.
                      </span>
                      <span
                        style={{ fontWeight: 800, fontSize: 16, color: "var(--accent-violet)" }}
                      >
                        {money(data.summary.connectReal)}
                      </span>
                    </div>
                  )}
                  {g === "platform" &&
                    (data.summary.platformReal != null ? (
                      <div
                        style={{
                          padding: "10px 16px",
                          borderTop: "1px solid var(--border-1)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          className="muted"
                          style={{ fontSize: 11.5, maxWidth: 580, lineHeight: 1.5 }}
                        >
                          <strong style={{ color: "var(--text-1)" }}>Real de solo ARIA</strong>{" "}
                          (Cost Explorer filtrado por la etiqueta <code>aria:product=ARIA</code>):
                          el gasto de <strong>únicamente la infraestructura de ARIA</strong>, sin el
                          resto de la cuenta. Es el total de la plataforma (compartida entre
                          tenants); tu estimación es tu porción. <strong>IAM es gratis.</strong>
                        </span>
                        <span
                          style={{ fontWeight: 800, fontSize: 16, color: "var(--accent-violet)" }}
                        >
                          {money(data.summary.platformReal)}
                        </span>
                      </div>
                    ) : (
                      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border-1)" }}>
                        <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                          <strong style={{ color: "var(--text-1)" }}>Estimado.</strong> Para ver el{" "}
                          <strong>cobro real de solo ARIA</strong>, activa la etiqueta{" "}
                          <code>aria:product=ARIA</code> como <em>cost allocation tag</em> en
                          Facturación de AWS (~24 h, no retroactivo) y etiqueta los recursos (los
                          Lambdas ya están; DynamoDB y demás con{" "}
                          <code>scripts/tag-resources.mjs</code>
                          ). Cost Explorer devuelve entonces el gasto de <strong>solo ARIA</strong>,
                          servicio por servicio. <strong>IAM es gratis.</strong> El hosting web es
                          un fijo de plataforma que no se atribuye por cliente.
                        </span>
                      </div>
                    ))}
                </CardBody>
              </Card>
            );
          })}

          <div className="muted" style={{ fontSize: 11, textAlign: "right" }}>
            Modelo de precios: {data.notes?.pricingModel || "us-east-1"} · generado{" "}
            {new Date(data.generatedAt).toLocaleString("es-PE")}
          </div>
        </>
      )}
    </div>
  );
}
