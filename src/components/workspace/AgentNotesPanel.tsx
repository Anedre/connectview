import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useAgentNotes } from "@/hooks/useAgentNotes";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

interface AgentNotesPanelProps {
  contactId: string | null;
  agentUsername: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "10px 12px",
  color: "var(--text-1)",
  outline: "none",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  resize: "vertical",
};

export function AgentNotesPanel({
  contactId,
  agentUsername,
}: AgentNotesPanelProps) {
  const {
    notes,
    wrapUpCode,
    summary,
    saving,
    lastSaved,
    updateNotes,
    updateWrapUpCode,
    updateSummary,
  } = useAgentNotes(contactId, agentUsername);

  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);

  const generateSummary = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;
    setGeneratingSummary(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "summary" }),
      });
      const data = await r.json();
      if (data.result) updateSummary(data.result);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const suggestWrapUp = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;
    setGeneratingCode(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "wrap-up" }),
      });
      const data = await r.json();
      if (data.result) updateWrapUpCode(data.result);
    } finally {
      setGeneratingCode(false);
    }
  };

  if (!contactId) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <Icon.Note size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Notas, resumen y disposición aparecerán cuando haya un contacto
            activo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Notas del agente
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {saving && "Guardando…"}
          {!saving && lastSaved && (
            <span className="row" style={{ gap: 4, display: "inline-flex" }}>
              <Icon.Check size={11} /> Guardado{" "}
              {formatDistanceToNow(lastSaved, { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
          Notas (auto-guardado)
        </div>
        <textarea
          value={notes}
          onChange={(e) => updateNotes(e.target.value)}
          placeholder="Escribe notas durante la llamada…"
          rows={6}
          style={inputStyle}
        />
      </div>

      <div>
        <div className="spread" style={{ marginBottom: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Resumen de la llamada
          </span>
          <button
            className="btn btn--sm"
            onClick={generateSummary}
            disabled={generatingSummary}
          >
            <Icon.Sparkles size={12} />
            {generatingSummary ? "Generando…" : "Generar con IA"}
          </button>
        </div>
        <textarea
          value={summary}
          onChange={(e) => updateSummary(e.target.value)}
          placeholder="El resumen generado por Q aparecerá aquí…"
          rows={3}
          style={inputStyle}
        />
      </div>

      <div>
        <div className="spread" style={{ marginBottom: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Wrap-up · Disposición
          </span>
          <button
            className="btn btn--sm"
            onClick={suggestWrapUp}
            disabled={generatingCode}
          >
            <Icon.Sparkles size={12} />
            {generatingCode ? "Pensando…" : "Sugerir"}
          </button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            value={wrapUpCode}
            onChange={(e) => updateWrapUpCode(e.target.value)}
            placeholder="ej. Facturación resuelta, Transferido…"
            style={{ ...inputStyle, height: 34, padding: "0 12px" }}
          />
          {wrapUpCode && (
            <span className="chip chip--violet" style={{ whiteSpace: "nowrap" }}>
              {wrapUpCode}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
