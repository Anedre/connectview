import { ChannelChip } from "@/components/vox/primitives";
import { Av } from "@/components/aria";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import type { Conversation } from "@/hooks/useConversations";
import { chipType, CH_COLOR, displayName } from "./channelMeta";
import { slaInfo, fmtWait, slaChipStyle } from "./sla";

/** Primer nombre/token corto para el chip de dueño en la lista. */
function shortName(s?: string): string {
  if (!s) return "Agente";
  return s.split(/[\s@]/)[0].slice(0, 12);
}

/** Color del puntito de "tipificada" según la valoración de la última gestión. */
function dispoColor(v?: string): string {
  if (v === "negativa") return "var(--red)";
  if (v === "cierre") return "var(--iris)";
  if (v === "positiva") return "var(--green)";
  return "var(--text-3)";
}

/** Hora relativa corta: HH:MM hoy, "ayer", o DD/MM. */
function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "ayer";
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

/**
 * ConversationList — items del inbox con las clases del handoff ARIA
 * (`.conv` / `.conv--active` / `.conv__name` / `.conv__prev`). Preserva TODA la
 * lógica: nombre (customerName || senderId), chip de canal, badge no-leídos y el
 * indicador de conversación cerrada.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { user } = useConnectAuth();
  const myEmailLc = (user?.email || user?.userId || "").toLowerCase();
  return (
    <>
      {conversations.map((c) => {
        const name = displayName(c);
        const active = c.conversationId === selectedId;
        const color = CH_COLOR[c.channel] || "var(--accent)";
        const sla = slaInfo(c);
        return (
          <div
            key={c.conversationId}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(c.conversationId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(c.conversationId);
              }
            }}
            className={
              "conv" +
              (active ? " conv--active" : "") +
              (c.status === "closed" ? " conv--closed" : "")
            }
            style={
              sla?.level === "breach"
                ? { boxShadow: "inset 3px 0 0 var(--red)" }
                : sla?.level === "warn"
                  ? { boxShadow: "inset 3px 0 0 var(--gold)" }
                  : undefined
            }
          >
            {/* Avatar con chip de canal abajo-derecha */}
            <div style={{ position: "relative", flex: "0 0 auto" }}>
              <Av
                name={name}
                size={40}
                radius={12}
                color={`color-mix(in srgb, ${color} 18%, transparent)`}
                style={{ color }}
              />
              <span
                style={{
                  position: "absolute",
                  right: -3,
                  bottom: -3,
                  transform: "scale(0.74)",
                  transformOrigin: "bottom right",
                }}
              >
                <ChannelChip type={chipType(c.channel)} />
              </span>
            </div>

            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row between" style={{ gap: 6 }}>
                <span
                  className="conv__name trunc"
                  style={{ fontWeight: c.unread ? 800 : 700, flex: 1, minWidth: 0 }}
                >
                  {name}
                </span>
                <span className="row gap6" style={{ flex: "0 0 auto", alignItems: "center" }}>
                  {sla && (
                    <span
                      style={slaChipStyle(sla.level)}
                      title={`Esperando respuesta hace ${fmtWait(sla.mins)}`}
                    >
                      ⏱ {fmtWait(sla.mins)}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {fmtWhen(c.lastMessageAt)}
                  </span>
                </span>
              </div>
              <div className="row between" style={{ gap: 6 }}>
                <span
                  className="conv__prev"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: c.unread ? "var(--text-2)" : "var(--text-3)",
                    fontWeight: c.unread ? 600 : 400,
                  }}
                >
                  {c.lastMessagePreview || "—"}
                </span>
                <span className="row gap6" style={{ flex: "0 0 auto", alignItems: "center" }}>
                  {c.assignee === "bot" && c.status !== "closed" && (
                    <span
                      className="chip chip--violet"
                      style={{ height: 16, fontSize: 9, padding: "0 5px" }}
                      title="La atiende el Agente IA"
                    >
                      IA
                    </span>
                  )}
                  {c.assignee === "agent" && !c.ownerAgentId && c.status !== "closed" && (
                    <span
                      className="chip"
                      style={{
                        height: 16,
                        fontSize: 9,
                        padding: "0 5px",
                        fontWeight: 700,
                        background: "color-mix(in srgb, var(--cyan) 15%, transparent)",
                        color: "var(--cyan)",
                      }}
                      title="Sin asignar — en la cola"
                    >
                      En cola
                    </span>
                  )}
                  {c.assignee === "agent" &&
                    c.ownerAgentId &&
                    c.ownerAgentId.toLowerCase() !== myEmailLc &&
                    c.status !== "closed" && (
                      <span
                        className="chip"
                        style={{ height: 16, fontSize: 9, padding: "0 5px" }}
                        title={`Atiende ${c.ownerAgentName || c.ownerAgentId}`}
                      >
                        {shortName(c.ownerAgentName || c.ownerAgentId)}
                      </span>
                    )}
                  {c.lastDisposition && (
                    <span
                      title={`Tipificada · ${c.lastDisposition.stageLabel}`}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: dispoColor(c.lastDisposition.valoracion),
                        flex: "0 0 auto",
                      }}
                    />
                  )}
                  {c.unread > 0 && <span className="conv__badge">{c.unread}</span>}
                  {c.status === "closed" && (
                    <span style={{ fontSize: 10, color: "var(--text-3)" }} title="Cerrada">
                      ✓
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
