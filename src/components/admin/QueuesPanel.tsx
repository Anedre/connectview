import { useState } from "react";
import { toast } from "sonner";
import { useQueues, type QueueSummary } from "@/hooks/useQueues";
import { useConnections } from "@/hooks/useConnections";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

/**
 * QueuesPanel — "Configuración → Colas". Lista las colas del Amazon Connect del
 * tenant Y deja elegir la PRINCIPAL. Al marcarla, ARIA re-provisiona el flow
 * ARIA-Outbound (campañas) + ARIA-Inbound para que ruteen a esa cola — así el
 * discador conecta al agente de esa cola (ej. UDEP-Pregrado), no a BasicQueue.
 *
 * Antes esta sección era un placeholder "Próximamente"; ahora lee + configura.
 */
export function QueuesPanel() {
  const { queues, loading, error } = useQueues();
  const { config, refetch } = useConnections();
  const [settingId, setSettingId] = useState<string | null>(null);

  const ep = getApiEndpoints();
  const primaryId = config.connect?.defaultQueueId || "";

  const setPrimary = async (q: QueueSummary) => {
    if (!ep?.provisionContactFlows) {
      toast.message("La provisión de flows aún no está desplegada.");
      return;
    }
    setSettingId(q.id);
    try {
      const r = await authedFetch(ep.provisionContactFlows, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, defaultQueueId: q.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo aplicar la cola");
      toast.success(`Cola principal: ${q.name}. El flow de campañas (ARIA-Outbound) ya rutea ahí.`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo aplicar la cola");
    } finally {
      setSettingId(null);
    }
  };

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>Colas de Amazon Connect</div>
        {queues.length > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--accent-cyan)",
              background: "var(--accent-cyan-soft)",
              borderRadius: 999,
              padding: "2px 10px",
            }}
          >
            {queues.length}
          </span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
        Se leen en vivo desde tu instancia de Connect. Marcá una como{" "}
        <b>principal</b>: ARIA re-rutea el flow de campañas (ARIA-Outbound) y
        entrantes a esa cola, así el discador conecta al agente correcto. Para
        crear o editar colas, andá a tu consola de Amazon Connect.
      </div>

      {loading && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          Cargando colas…
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 12.5,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
          }}
        >
          No se pudieron leer las colas: {error}
        </div>
      )}

      {!loading && !error && queues.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No encontramos colas. Verificá que tu Amazon Connect esté conectado
          (Integraciones) y que tenga al menos una cola.
        </div>
      )}

      {queues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queues.map((q) => {
            const isPrimary = q.id === primaryId;
            const busy = settingId === q.id;
            return (
              <div
                key={q.id}
                className="row"
                style={{
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 8,
                  background: isPrimary ? "var(--accent-green-soft)" : "var(--bg-2)",
                  border: `1px solid ${isPrimary ? "color-mix(in srgb, var(--accent-green) 35%, transparent)" : "var(--border-1)"}`,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    display: "grid",
                    placeItems: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: isPrimary ? "var(--accent-green-soft)" : "var(--accent-cyan-soft)",
                    color: isPrimary ? "var(--accent-green)" : "var(--accent-cyan)",
                  }}
                >
                  <Icon.Queue size={14} />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>
                  {q.name}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "var(--text-3)",
                    background: "var(--bg-1)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {q.type === "STANDARD" ? "Estándar" : q.type}
                </span>
                {isPrimary ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--accent-green)",
                      background: "var(--bg-1)",
                      border: "1px solid color-mix(in srgb, var(--accent-green) 35%, transparent)",
                      borderRadius: 999,
                      padding: "3px 10px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Icon.Check size={11} /> Principal
                  </span>
                ) : (
                  <button
                    className="btn btn--sm"
                    onClick={() => setPrimary(q)}
                    disabled={!!settingId}
                    title="Rutea el flow de campañas y entrantes a esta cola"
                  >
                    {busy ? "Aplicando…" : "Marcar como principal"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
