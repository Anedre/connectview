/* ============================================================
   ARIA · Cockpit · Coach IA (bajo el Copiloto) — MODO DEMO
   Réplica en mock del AICoachPanel real: bloques callout / script /
   checklist / action. Vive como <Card> debajo del Copiloto en la
   columna 3, tal como el real tiene AIAssistPanel + AICoachPanel.
   Reutiliza <Card> y las clases de la demo — NO rediseña nada.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon } from "@/components/aria";
import { AG_COACH, type DemoCoachBlock } from "./mockData";

const CALL_TONE: Record<string, { bg: string; fg: string; border: string; icon: string }> = {
  info: { bg: "var(--iris-soft)", fg: "var(--iris-2)", border: "color-mix(in srgb,var(--iris) 24%,transparent)", icon: "sparkle" },
  warn: { bg: "var(--gold-soft)", fg: "var(--gold-2)", border: "color-mix(in srgb,var(--gold) 30%,transparent)", icon: "target" },
  success: { bg: "var(--green-soft)", fg: "var(--green)", border: "color-mix(in srgb,var(--green) 30%,transparent)", icon: "check" },
};

function CalloutBlock({ b }: { b: DemoCoachBlock }) {
  const c = CALL_TONE[b.tone || "info"];
  return (
    <div
      className="row gap8"
      style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: c.bg, border: "1px solid " + c.border, alignItems: "flex-start" }}
    >
      <Icon name={c.icon} size={14} style={{ color: c.fg, marginTop: 1, flex: "0 0 auto" }} />
      <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.45 }}>{b.text}</span>
    </div>
  );
}

function ScriptBlock({ b }: { b: DemoCoachBlock }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: "var(--r-md)",
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderLeft: "3px solid var(--iris)",
      }}
    >
      <div className="row between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em", color: "var(--iris-2)" }}>
          GUION · {b.title}
        </span>
        <button type="button" className="ctab__x" onClick={() => setCopied(true)} style={{ fontSize: 11 }}>
          <Icon name="copy" size={13} />
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-1)", fontStyle: "italic", lineHeight: 1.5 }}>“{b.text}”</div>
      {copied && (
        <div className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>
          Copiado ✓
        </div>
      )}
    </div>
  );
}

function ChecklistBlock({ b }: { b: DemoCoachBlock }) {
  const items = b.items || [];
  const [checked, setChecked] = useState<boolean[]>(items.map(() => false));
  const done = checked.filter(Boolean).length;
  return (
    <div style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--bg-2)", border: "1px solid var(--border-1)" }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="row gap6" style={{ fontSize: 11.5, fontWeight: 700 }}>
          <Icon name="check" size={12} /> {b.title}
        </span>
        <span className="dim" style={{ fontSize: 11 }}>
          {done}/{items.length}
        </span>
      </div>
      <div className="col gap4">
        {items.map((it, i) => (
          <label key={it} className="row gap8" style={{ fontSize: 12.5, cursor: "pointer", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
              style={{ marginTop: 2, accentColor: "var(--accent)" }}
            />
            <span style={{ color: checked[i] ? "var(--text-3)" : "var(--text-1)", textDecoration: checked[i] ? "line-through" : "none" }}>
              {it}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ActionBlock({ b }: { b: DemoCoachBlock }) {
  return (
    <div
      className="row gap10"
      style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--bg-2)", border: "1px solid var(--border-1)", alignItems: "flex-start" }}
    >
      <div className="tl__ico" style={{ ["--_c" as string]: "var(--iris)", width: 26, height: 26, flex: "0 0 auto" }}>
        <Icon name="sparkle" size={13} />
      </div>
      <div className="grow">
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.title}</div>
        <Btn variant="primary" size="sm" icon="send" style={{ marginTop: 8 }}>
          {b.cta}
        </Btn>
      </div>
    </div>
  );
}

export function CoachPanel() {
  const [loading, setLoading] = useState(false);
  return (
    <Card
      title="Coach · Claude"
      icon="bot"
      accent="var(--iris)"
      extra={
        <Btn variant="quiet" size="sm" icon="refresh" onClick={() => setLoading((l) => !l)}>
          {loading ? "Pensando…" : "Actualizar"}
        </Btn>
      }
    >
      <div className="col gap9">
        {AG_COACH.map((b, i) => {
          if (b.kind === "callout") return <CalloutBlock key={i} b={b} />;
          if (b.kind === "script") return <ScriptBlock key={i} b={b} />;
          if (b.kind === "checklist") return <ChecklistBlock key={i} b={b} />;
          return <ActionBlock key={i} b={b} />;
        })}
      </div>
    </Card>
  );
}
