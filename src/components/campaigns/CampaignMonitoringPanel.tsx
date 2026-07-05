import { Circle, Phone } from "lucide-react";
import type { CampaignAgentLive, CampaignQueueLive } from "@/hooks/useCampaignStats";
import { initials } from "@/lib/initials";
import * as Icon from "@/components/vox/primitives";

/**
 * CampaignMonitoringPanel — monitoreo EN VIVO de una campaña (feature B):
 * cuántos contactos hay en vuelo por COLA y por AGENTE, + los NOMBRES de las
 * personas que se están llamando/atendiendo ahora. Se alimenta de byQueue /
 * byAgent de get-campaign-stats (poll cada 3s vía useCampaignStats).
 */
export function CampaignMonitoringPanel({
  byQueue,
  byAgent,
}: {
  byQueue?: CampaignQueueLive[];
  byAgent?: CampaignAgentLive[];
}) {
  const queues = byQueue || [];
  const agents = byAgent || [];
  if (queues.length === 0 && agents.length === 0) return null;

  const liveTotal = agents.reduce((n, a) => n + a.dialing + a.connected, 0);

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 14,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        marginBottom: 16,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 14 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: liveTotal > 0 ? "var(--accent-green)" : "var(--text-3)",
            boxShadow: liveTotal > 0 ? "0 0 8px var(--accent-green)" : "none",
          }}
        />
        <div style={{ fontWeight: 700, fontSize: 15 }}>Monitoreo en vivo</div>
        <span className="muted" style={{ fontSize: 12 }}>
          {liveTotal > 0 ? `${liveTotal} en vivo` : "sin actividad ahora"}
        </span>
      </div>

      {/* Por cola */}
      {queues.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Por cola
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 8,
              marginBottom: 18,
            }}
          >
            {queues.map((q) => {
              const live = q.dialing + q.connected;
              return (
                <div
                  key={q.queueId || q.queueName}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                  }}
                >
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <Icon.Queue size={13} style={{ color: "var(--accent-cyan)" }} />
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {q.queueName || "—"}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 10, marginTop: 6 }}>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {q.agents} agentes
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: live > 0 ? "var(--accent-green)" : "var(--text-3)",
                      }}
                    >
                      {live} en vivo
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Por agente */}
      {agents.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Por agente
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {agents.map((a) => {
              const onCall = a.connected > 0;
              const dialing = a.dialing > 0;
              const liveName = a.liveNames[0];
              return (
                <div
                  key={a.userId}
                  className="row"
                  style={{
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "var(--bg-2)",
                    border: `1px solid ${onCall ? "color-mix(in srgb, var(--accent-green) 35%, transparent)" : "var(--border-1)"}`,
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 auto",
                      display: "grid",
                      placeItems: "center",
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "var(--accent-violet-soft)",
                      color: "var(--accent-violet)",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {initials(a.username)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.username}
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {a.queueName}
                    </div>
                  </div>
                  <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                    {onCall ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--accent-green)",
                        }}
                      >
                        <Circle size={9} fill="currentColor" /> En llamada
                        {liveName ? ` · ${liveName}` : ""}
                      </span>
                    ) : dialing ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--accent-amber)",
                        }}
                      >
                        <Phone size={12} /> Marcando{liveName ? ` · ${liveName}` : ""}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        Libre
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
