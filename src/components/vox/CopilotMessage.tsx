import { useMemo, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import MarkdownIt from "markdown-it";
import { ArrowRight, Lightbulb, Zap } from "lucide-react";
import { isAllowedRoute, EXEC_ACTIONS, runExecAction, type ExecAction } from "@/lib/copilotActions";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * CopilotMessage — render RICO de una respuesta del Copilot. El modelo devuelve
 * markdown + marcadores; acá se parsean en bloques interactivos:
 *   [[go|Etiqueta|/ruta]]   → botón que navega (whitelist de copilotActions)
 *   [[do|Etiqueta|actionId]]→ botón que ejecuta una acción (con confirm si aplica)
 *   [[tip|texto]]           → callout de consejo
 *   [[kpi|Etiqueta|valor]]  → chip de métrica
 * Emojis: los pone el modelo (van en el markdown). html:false = salida segura.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const MARKER = /\[\[(go|do|tip|kpi)\|([^\]]+?)\]\]/g;

type Parsed = {
  body: string;
  tips: string[];
  kpis: { label: string; value: string }[];
  goes: { label: string; route: string }[];
  dos: { label: string; action: ExecAction }[];
};

function parse(text: string): Parsed {
  const tips: string[] = [];
  const kpis: { label: string; value: string }[] = [];
  const goes: { label: string; route: string }[] = [];
  const dos: { label: string; action: ExecAction }[] = [];
  const body = text.replace(MARKER, (_all, type: string, payload: string) => {
    const parts = payload.split("|").map((s) => s.trim());
    if (type === "tip") {
      if (parts[0]) tips.push(parts.join(" | "));
    } else if (type === "kpi") {
      if (parts[0]) kpis.push({ label: parts[0], value: parts[1] || "" });
    } else if (type === "go") {
      const [label, route] = parts;
      if (route && isAllowedRoute(route)) goes.push({ label: label || route, route });
    } else if (type === "do") {
      const [label, id] = parts;
      const action = id ? EXEC_ACTIONS[id] : undefined;
      if (action) dos.push({ label: label || action.label, action });
    }
    return "";
  });
  return { body: body.trim(), tips, kpis, goes, dos };
}

export function CopilotMessage({ text }: { text: string }) {
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const p = useMemo(() => parse(text), [text]);
  const html = useMemo(() => md.render(p.body), [p.body]);

  const runDo = async (action: ExecAction) => {
    if (action.confirm && !(await confirm({ title: action.confirm, confirmLabel: action.label }))) {
      return;
    }
    runExecAction(action.id);
  };

  return (
    <div>
      {/* Métricas embebidas */}
      {p.kpis.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {p.kpis.map((k, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 8,
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
                fontSize: 11.5,
              }}
            >
              <span style={{ color: "var(--text-3)" }}>{k.label}</span>
              <b style={{ color: "var(--text-1)", fontSize: 13 }}>{k.value}</b>
            </span>
          ))}
        </div>
      )}

      {/* Cuerpo markdown (con emojis) */}
      <div className="aria-md" dangerouslySetInnerHTML={{ __html: html }} />

      {/* Callouts de consejo */}
      {p.tips.map((t, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 7,
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 9,
            background: "var(--accent-amber-soft)",
            border: "1px solid var(--accent-amber-soft)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <Lightbulb
            size={14}
            style={{ color: "var(--accent-amber)", flex: "0 0 auto", marginTop: 1 }}
          />
          <span style={{ color: "var(--text-1)" }}>{t}</span>
        </div>
      ))}

      {/* Botones de acción (navegar + ejecutar) */}
      {(p.goes.length > 0 || p.dos.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {p.goes.map((g, i) => (
            <button
              key={`go-${i}`}
              type="button"
              onClick={() => navigate(g.route)}
              style={btnStyle("nav")}
            >
              {g.label}
              <ArrowRight size={13} />
            </button>
          ))}
          {p.dos.map((d, i) => (
            <button
              key={`do-${i}`}
              type="button"
              onClick={() => runDo(d.action)}
              style={btnStyle("exec")}
            >
              <Zap size={12} />
              {d.label}
            </button>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function btnStyle(kind: "nav" | "exec"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 11px",
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    border: kind === "nav" ? "none" : "1px solid var(--border-2)",
    background: kind === "nav" ? "linear-gradient(160deg, #9B6DFF, #6E54E0)" : "var(--bg-1)",
    color: kind === "nav" ? "#fff" : "var(--text-1)",
  };
}
