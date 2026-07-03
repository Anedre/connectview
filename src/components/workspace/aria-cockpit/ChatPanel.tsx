/* ============================================================
   ARIA · Cockpit · ChatPanel (WhatsApp) — MODO DEMO
   Portado de aria-agent.jsx. Data mock (AG_WA).
   ============================================================ */
import { Btn, Card, Pill } from "@/components/aria";
import { AG_WA } from "./mockData";

export function ChatPanel() {
  return (
    <Card
      title="Conversación · WhatsApp"
      icon="wa"
      extra={
        <Pill tone="green" icon="dot">
          En línea
        </Pill>
      }
      pad={false}
      bodyStyle={{ display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 280 }}>
        {AG_WA.map((m, i) => (
          <div key={i} className={"msg msg--" + (m.dir === "in" ? "in" : "out")}>
            {m.text}
            <div className="msg__time">{m.t}</div>
          </div>
        ))}
      </div>
      <div className="composer">
        <div className="composer__box">
          <Btn variant="quiet" size="sm" icon="paperclip" />
          <input placeholder="Escribe…" />
          <Btn variant="quiet" size="sm" icon="sparkle" />
          <Btn variant="primary" size="sm" icon="send" />
        </div>
      </div>
    </Card>
  );
}
