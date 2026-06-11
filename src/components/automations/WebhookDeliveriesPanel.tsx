import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, RotateCw, Webhook } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * WebhookDeliveriesPanel — visibilidad de las entregas de webhooks (#17).
 * Lista las entregas (estado, intentos, último error, próximo reintento) y
 * permite "reintentar ahora". Lee de get-webhook-deliveries.
 */

interface Delivery {
  deliveryId: string;
  url: string;
  ruleName?: string;
  status: string;
  attempts: number;
  lastError?: string;
  lastStatusCode?: number;
  nextAttemptAt?: string;
  createdAt?: string;
  updatedAt?: string;
  deliveredAt?: string;
}

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  delivered: { label: "entregado", bg: "var(--accent-green-soft)", fg: "var(--accent-green)" },
  retrying: { label: "reintentando", bg: "var(--accent-amber-soft)", fg: "var(--accent-amber)" },
  queued: { label: "en cola", bg: "var(--accent-cyan-soft)", fg: "var(--accent-cyan)" },
  delivering: { label: "entregando", bg: "var(--accent-cyan-soft)", fg: "var(--accent-cyan)" },
  exhausted: { label: "agotado", bg: "var(--accent-red-soft)", fg: "var(--accent-red)" },
};

function rel(iso?: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const txt = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  return diff >= 0 ? `en ${txt}` : `hace ${txt}`;
}

export function WebhookDeliveriesPanel() {
  const [rows, setRows] = useState<Delivery[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const ep = getApiEndpoints();
  const url = ep?.getWebhookDeliveries;

  const load = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(`${url}?limit=200`);
      const j = await r.json();
      setRows(Array.isArray(j.deliveries) ? j.deliveries : []);
      setStats(j.stats || {});
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const retryNow = async (deliveryId: string) => {
    if (!url) return;
    setRetrying(deliveryId);
    try {
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast.success("Reintento agendado — el dispatcher lo tomará en el próximo tick");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reintentar");
    } finally {
      setRetrying(null);
    }
  };

  if (!url) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.6 }}>
        <Webhook size={26} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 10, fontWeight: 600 }}>Webhooks con retry no configurado</div>
        <div style={{ marginTop: 4, color: "var(--text-3)" }}>
          Provisioná la infra con <code>node scripts/create-webhook-retry.mjs</code> y pegá la
          Function URL de <code>get-webhook-deliveries</code> en <code>apiEndpoints.getWebhookDeliveries</code>.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {Object.entries(stats).map(([k, n]) => {
          const m = STATUS_META[k] || { label: k, bg: "var(--bg-2)", fg: "var(--text-2)" };
          return (
            <span key={k} className="chip" style={{ background: m.bg, color: m.fg, borderColor: "transparent" }}>
              {n} {m.label}
            </span>
          );
        })}
        <button className="btn btn--sm" style={{ marginLeft: "auto", gap: 5 }} onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refrescar
        </button>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 12.5 }}>Cargando entregas…</div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 12.5 }}>
          Sin entregas todavía. Dispará una regla con acción <strong>webhook</strong> para ver el historial acá.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-3)", borderBottom: "1px solid var(--border-1)" }}>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Estado</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Regla / endpoint</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Intentos</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Detalle</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const m = STATUS_META[d.status] || { label: d.status, bg: "var(--bg-2)", fg: "var(--text-2)" };
                return (
                  <tr key={d.deliveryId} style={{ borderBottom: "1px solid var(--border-1)" }}>
                    <td style={{ padding: "8px" }}>
                      <span className="chip" style={{ background: m.bg, color: m.fg, borderColor: "transparent", height: 19, fontSize: 10.5 }}>{m.label}</span>
                    </td>
                    <td style={{ padding: "8px", minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{d.ruleName || "—"}</div>
                      <div className="mono muted" style={{ fontSize: 10.5, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.url}>{d.url}</div>
                    </td>
                    <td style={{ padding: "8px" }} className="mono">{d.attempts}</td>
                    <td style={{ padding: "8px", color: "var(--text-2)" }}>
                      {d.status === "delivered" ? (
                        <span style={{ color: "var(--accent-green)" }}>HTTP {d.lastStatusCode} · {rel(d.deliveredAt)}</span>
                      ) : d.status === "exhausted" ? (
                        <span title={d.lastError}>agotó reintentos · {d.lastError?.slice(0, 40)}</span>
                      ) : d.nextAttemptAt ? (
                        <span title={d.lastError}>próximo {rel(d.nextAttemptAt)}{d.lastError ? ` · ${d.lastError.slice(0, 30)}` : ""}</span>
                      ) : (
                        <span title={d.lastError}>{d.lastError?.slice(0, 40) || "—"}</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {d.status !== "delivered" && (
                        <button className="btn btn--ghost btn--sm" style={{ gap: 4 }} onClick={() => retryNow(d.deliveryId)} disabled={retrying === d.deliveryId} title="Reintentar ahora">
                          <RotateCw size={12} /> {retrying === d.deliveryId ? "…" : "Reintentar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
