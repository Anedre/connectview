/* ============================================================
   ARIA · Cockpit · EmailPanel (canal Email en llamada) — MODO DEMO
   Réplica en mock del EmailThreadPanel real (hilo estilo Gmail).
   Reutiliza <Card> y las clases de la demo — NO rediseña nada.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon, Pill } from "@/components/aria";
import { AG_EMAIL } from "./mockData";

/** Fila De/Para del encabezado, estilo Gmail. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row gap10" style={{ fontSize: 12 }}>
      <span className="dim" style={{ width: 38, flex: "0 0 auto" }}>
        {label}
      </span>
      <span className="mono trunc" style={{ color: "var(--text-1)" }}>
        {value}
      </span>
    </div>
  );
}

export function EmailPanel() {
  const e = AG_EMAIL;
  const [replyOpen, setReplyOpen] = useState(false);

  return (
    <Card
      title="Correo · Email"
      icon="mail"
      extra={
        <Pill tone="gold" icon="mail">
          Entrante
        </Pill>
      }
      pad={false}
    >
      {/* Encabezado: asunto + De/Para */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-1)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>
          {e.subject}
        </div>
        <div className="col gap4">
          <MetaRow label="De" value={e.from} />
          <MetaRow label="Para" value={e.to} />
          <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
            {e.date}
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div
        style={{
          padding: "16px 20px",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          color: "var(--text-1)",
          background: "var(--bg-2)",
        }}
      >
        {e.body}
      </div>

      {/* Adjuntos */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border-1)" }}>
        <div
          className="dim"
          style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}
        >
          {e.attachments.length} adjuntos
        </div>
        <div className="row wrap gap6">
          {e.attachments.map((a) => (
            <span
              key={a.name}
              className="row gap6"
              style={{
                padding: "6px 10px",
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-sm)",
                fontSize: 11.5,
              }}
            >
              <Icon name="paperclip" size={13} />
              <span className="trunc" style={{ maxWidth: 160 }}>
                {a.name}
              </span>
              <span className="dim" style={{ fontSize: 10 }}>
                {a.size}
              </span>
              <Icon name="download" size={12} style={{ color: "var(--accent)" }} />
            </span>
          ))}
        </div>
      </div>

      {/* Composer de respuesta */}
      <div className="composer">
        {replyOpen ? (
          <div className="col gap8">
            <div className="row between">
              <span className="row gap8" style={{ fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="mail" size={13} style={{ color: "var(--gold-2)" }} />
                Responder a {e.fromName}
              </span>
              <button type="button" className="ctab__x" onClick={() => setReplyOpen(false)}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="Escribe tu respuesta…"
              style={{
                width: "100%",
                resize: "vertical",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-md)",
                padding: "10px 12px",
                background: "var(--bg-2)",
                fontSize: 13,
                outline: "none",
              }}
            />
            <div className="row gap8">
              <Btn variant="primary" size="sm" icon="send">
                Enviar respuesta
              </Btn>
              <Btn variant="ghost" size="sm">
                Adjuntar
              </Btn>
            </div>
          </div>
        ) : (
          <div className="row gap6">
            <Btn variant="soft" size="sm" icon="mail" onClick={() => setReplyOpen(true)}>
              Responder
            </Btn>
            <Btn variant="ghost" size="sm">
              Responder a todos
            </Btn>
            <Btn variant="ghost" size="sm">
              Reenviar
            </Btn>
          </div>
        )}
      </div>
    </Card>
  );
}
