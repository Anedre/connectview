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

export function AIAssistPanel({ latestCustomerUtterance }: AIAssistPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<QSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

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
          placeholder="Pregúntale a Q o busca en la base de conocimiento…"
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

      {suggestions.length === 0 && !loading && (
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
