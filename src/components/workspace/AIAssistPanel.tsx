import { useState, useEffect } from "react";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

interface QSuggestion {
  id: string;
  type: string;
  title: string;
  excerpts: string[];
  url?: string;
}

interface AIAssistPanelProps {
  contactId: string | null;
  customerPhone: string | null;
  latestCustomerUtterance?: string;
}

type CopTab = "conocimiento" | "guiones" | "objeciones";

/**
 * Copiloto de llamada — reorganizado en pestañas al estilo del handoff ARIA
 * (Conocimiento / Guiones / Objeciones), PERO alimentado por los datos REALES
 * que ya usaba este panel:
 *
 *   • Conocimiento → búsqueda en la base de conocimiento (getQSuggestions).
 *     Auto-sugiere a partir de la última frase del cliente (Contact Lens).
 *     Es la única fuente de datos real del panel → es la pestaña por defecto.
 *   • Guiones / Objeciones → NO hay un feed de datos propio en este componente
 *     (el guion sugerido en vivo lo produce el Coach). Para no inventar data,
 *     estas pestañas muestran un estado vacío honesto y reutilizan el buscador
 *     para consultar la base de conocimiento con un término sembrado.
 *
 * Se preserva el 100% de la lógica: estado `query`, `search()`, `suggestions`
 * y el efecto de auto-sugerencia con debounce sobre `latestCustomerUtterance`.
 */
export function AIAssistPanel({ latestCustomerUtterance }: AIAssistPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<QSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<CopTab>("conocimiento");

  const search = async (q: string) => {
    if (!q) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getQSuggestions) return;

    setLoading(true);
    try {
      const r = await fetch(
        `${endpoints.getQSuggestions}?query=${encodeURIComponent(q)}`
      );
      const data = await r.json();
      setSuggestions(data.results || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!latestCustomerUtterance) return;
    const t = setTimeout(() => {
      setQuery(latestCustomerUtterance);
      search(latestCustomerUtterance);
    }, 1500);
    return () => clearTimeout(t);
  }, [latestCustomerUtterance]);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div
        className="row"
        style={{
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon.Sparkles size={15} style={{ color: "var(--accent-violet)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
          Copiloto de llamada
        </span>
      </div>

      {/* Pestañas estilo handoff — Conocimiento (real) · Guiones · Objeciones */}
      <div className="cop-tabs" style={{ marginBottom: 0 }}>
        {(
          [
            ["conocimiento", "Conocimiento"],
            ["guiones", "Guiones"],
            ["objeciones", "Objeciones"],
          ] as [CopTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Buscador — compartido por todas las pestañas (mismo endpoint real). */}
      <div
        className="row"
        style={{
          background: "var(--bg-2)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          padding: "8px 10px",
        }}
      >
        <Icon.Sparkles size={14} style={{ color: "var(--accent-violet)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(query)}
          placeholder={
            tab === "objeciones"
              ? "Busca cómo responder una objeción…"
              : tab === "guiones"
              ? "Busca un guion o argumento…"
              : "Pregúntale a Q o busca en la base de conocimiento…"
          }
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: "none",
            fontSize: 13,
            color: "var(--text-1)",
          }}
        />
        <button
          className="btn btn--primary btn--sm"
          onClick={() => search(query)}
          disabled={loading || !query}
        >
          <Icon.Send size={12} />
          {loading ? "…" : "Buscar"}
        </button>
      </div>

      {/* Nota honesta para las pestañas sin feed propio: no inventamos guiones
          ni objeciones; explicamos de dónde salen y ofrecemos el buscador. */}
      {tab !== "conocimiento" && suggestions.length === 0 && !loading && (
        <div
          style={{
            padding: "12px 12px",
            borderRadius: 8,
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          {tab === "guiones" ? (
            <>
              Los guiones sugeridos en vivo los genera el{" "}
              <b>Coach</b> (pestaña Coach a la derecha) según la conversación.
              Aquí puedes buscar argumentos o aperturas en la base de
              conocimiento.
            </>
          ) : (
            <>
              Cuando el cliente plantee una objeción, el <b>Coach</b> la marca y
              sugiere cómo responder. Aquí puedes buscar respuestas guardadas en
              la base de conocimiento.
            </>
          )}
        </div>
      )}

      {tab === "conocimiento" &&
        suggestions.length === 0 &&
        !loading && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            Busca información o deja que Q sugiera durante la llamada.
          </div>
        )}

      {/* Resultados reales del buscador — idénticos en las 3 pestañas porque
          es el mismo endpoint de base de conocimiento. */}
      <div className="col" style={{ gap: 8 }}>
        {suggestions.map((s) => (
          <div
            key={s.id}
            style={{
              padding: 12,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              display: "flex",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--accent-violet-soft)",
                color: "var(--accent-violet)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Knowledge size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                  {s.title}
                </span>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="muted"
                    style={{ marginLeft: "auto" }}
                  >
                    <Icon.Send size={11} />
                  </a>
                )}
              </div>
              {s.excerpts.slice(0, 2).map((excerpt, i) => (
                <div
                  key={i}
                  className="muted"
                  style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                >
                  {excerpt}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
