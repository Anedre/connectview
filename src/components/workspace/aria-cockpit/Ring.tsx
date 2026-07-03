/* ============================================================
   ARIA · Cockpit · Ring (entrante) — MODO DEMO
   Portado de aria-agent.jsx.
   ============================================================ */
import { Av, Icon, Pill } from "@/components/aria";
import type { DemoContact } from "./mockData";

export function Ring({
  contact,
  onAccept,
  onReject,
}: {
  contact: DemoContact;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="incoming-overlay" style={{ position: "fixed", zIndex: 200 }}>
      <div
        className="card card--pop ring-pulse"
        style={{
          padding: 32,
          textAlign: "center",
          maxWidth: 440,
          width: "100%",
          margin: "0 20px",
          borderColor: "color-mix(in srgb,var(--green) 45%,var(--border-1))",
        }}
      >
        <Pill tone="green" icon="arrowIn" style={{ margin: "0 auto" }}>
          Llamada entrante · Admisión
        </Pill>
        <div style={{ margin: "20px auto 14px", width: "fit-content" }}>
          <Av name={contact.name} size={84} radius={26} color="var(--cyan)" />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{contact.name}</div>
        <div className="mono dim" style={{ fontSize: 13, marginTop: 4 }}>
          {contact.phone} · {contact.prog}
        </div>
        <div
          style={{
            margin: "16px 0",
            padding: "11px 14px",
            borderRadius: "var(--r-md)",
            background: "var(--iris-soft)",
            fontSize: 12.5,
            color: "var(--text-2)",
            textAlign: "left",
          }}
        >
          <span className="row gap8" style={{ fontWeight: 700, color: "var(--iris-2)", marginBottom: 3 }}>
            <Icon name="sparkle" size={14} />
            Screen-pop IA
          </span>
          Lead de Meta Ads · 6 toques · última interacción hace 6 días (WhatsApp). Etapa: Interesado.
        </div>
        <div className="row gap12 center">
          <button
            type="button"
            className="btn"
            style={{ background: "var(--red)", color: "#fff", height: 52, width: 52, borderRadius: "50%" }}
            onClick={onReject}
          >
            <Icon name="phone" size={22} style={{ transform: "rotate(135deg)" }} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "var(--green)", color: "#fff", height: 52, padding: "0 26px", borderRadius: 99, fontWeight: 750 }}
            onClick={onAccept}
          >
            <Icon name="phone" size={20} />
            Contestar
          </button>
        </div>
      </div>
    </div>
  );
}
