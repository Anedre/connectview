import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Av, Btn } from "@/components/aria";
import { ChannelChip } from "@/components/vox/primitives";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import {
  useConversations,
  useConversationActions,
  type Conversation,
} from "@/hooks/useConversations";
import { chipType, CH_LABEL } from "./channelMeta";

/** Beep corto de alerta (Web Audio; best-effort, silencioso si el navegador lo bloquea). */
function beep() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.26);
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch {
    /* sin audio — la alerta visual alcanza */
  }
}

/**
 * ChatQueueAlert — pop-up de alerta cuando un chat necesita a un agente humano:
 * el bot derivó (assignee="agent"), un chat entró a la cola sin dueño, o me lo
 * traspasaron. Es global (montado en el AppLayout) para avisar aunque el agente
 * esté en otra sección, igual que el ring de una llamada entrante. "Recibir"
 * toma el chat y abre el inbox en esa conversación.
 */
export function ChatQueueAlert() {
  const { conversations } = useConversations();
  const { user } = useConnectAuth();
  const { assign } = useConversationActions();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Conversation[]>([]);
  // ids ya "vistos" para no re-alertar lo preexistente ni en cada poll.
  const seenRef = useRef<Set<string> | null>(null);
  const myEmailLc = (user?.email || user?.userId || "").toLowerCase();

  useEffect(() => {
    // Chats que requieren a ESTE agente: abiertos, en manos de un humano, y en la
    // cola (sin dueño) o asignados a mí.
    const relevant = conversations.filter(
      (c) =>
        c.status === "open" &&
        c.assignee === "agent" &&
        (!c.ownerAgentId || c.ownerAgentId.toLowerCase() === myEmailLc),
    );
    const ids = new Set(relevant.map((c) => c.conversationId));
    if (seenRef.current === null) {
      // Primer poll tras montar: marcamos lo existente como visto (no alertamos
      // el backlog; solo lo que llegue de aquí en adelante).
      seenRef.current = ids;
      return;
    }
    const prevSeen = seenRef.current;
    const fresh = relevant.filter((c) => !prevSeen.has(c.conversationId));
    if (fresh.length) {
      setAlerts((prev) => {
        const have = new Set(prev.map((p) => p.conversationId));
        const add = fresh.filter((f) => !have.has(f.conversationId));
        return add.length ? [...prev, ...add] : prev;
      });
      beep();
    }
    seenRef.current = ids;
  }, [conversations, myEmailLc]);

  const dismiss = (id: string) => setAlerts((a) => a.filter((c) => c.conversationId !== id));

  const receive = async (c: Conversation) => {
    dismiss(c.conversationId);
    try {
      await assign.mutateAsync({ conversationId: c.conversationId, assignee: "agent" });
      toast.success("Chat recibido — ahora lo atiendes tú");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo recibir el chat");
    }
    navigate(`/inbox?c=${encodeURIComponent(c.conversationId)}`);
  };

  if (!alerts.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        right: 18,
        zIndex: 400,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 330,
        maxWidth: "calc(100vw - 36px)",
      }}
    >
      {alerts.slice(0, 3).map((c) => {
        const name = c.customerName || c.senderId;
        return (
          <div key={c.conversationId} className="card card--pop fadeup" style={{ padding: 14 }}>
            <div className="row gap10" style={{ alignItems: "flex-start" }}>
              <span className="ring-pulse" style={{ flex: "0 0 auto", position: "relative" }}>
                <Av name={name} size={40} radius={12} />
                <span
                  style={{
                    position: "absolute",
                    right: -3,
                    bottom: -3,
                    transform: "scale(0.72)",
                    transformOrigin: "bottom right",
                  }}
                >
                  <ChannelChip type={chipType(c.channel)} />
                </span>
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row gap6" style={{ alignItems: "center" }}>
                  <b style={{ fontSize: 13.5 }}>Nuevo chat en cola</b>
                </div>
                <div className="trunc" style={{ fontSize: 13, fontWeight: 650, marginTop: 1 }}>
                  {name}
                </div>
                <div className="dim trunc" style={{ fontSize: 11.5, marginTop: 1 }}>
                  {CH_LABEL[c.channel] || c.channel} · {c.lastMessagePreview || "—"}
                </div>
              </div>
              <button
                type="button"
                className="ctab__x"
                onClick={() => dismiss(c.conversationId)}
                title="Descartar"
                style={{ flex: "0 0 auto" }}
              >
                ×
              </button>
            </div>
            <div className="row gap8" style={{ marginTop: 11 }}>
              <Btn
                variant="primary"
                size="sm"
                icon="chat"
                onClick={() => receive(c)}
                style={{ flex: 1 }}
              >
                Recibir
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => dismiss(c.conversationId)}>
                Después
              </Btn>
            </div>
          </div>
        );
      })}
    </div>
  );
}
