import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCCP, type QuickConnectEntry } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

interface QuickConnectsListProps {
  /** Called after a successful connect so the parent can reset the view
   *  state (typically: back to the menu). */
  onConnected?: () => void;
}

const TYPE_META: Record<
  string,
  { label: string; tone: string; bg: string }
> = {
  agent: {
    label: "Agente",
    tone: "var(--accent-cyan)",
    bg: "var(--accent-cyan-soft)",
  },
  queue: {
    label: "Cola",
    tone: "var(--accent-violet)",
    bg: "var(--bg-2)",
  },
  phone_number: {
    label: "Teléfono",
    tone: "var(--accent-green)",
    bg: "var(--accent-green-soft)",
  },
};

/**
 * Inline quick-connects picker — meant to be embedded inside the
 * softphone column when the agent selects "Quick connects" from the
 * outbound actions menu. No overlay / modal chrome; just a filter +
 * list. The parent (`OutboundActionsMenu`) owns the back button and
 * column header.
 */
export function QuickConnectsList({ onConnected }: QuickConnectsListProps) {
  const { getQuickConnects, connectToEndpoint, agentState } = useCCP();
  const [entries, setEntries] = useState<QuickConnectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const canDial =
    agentState === "Available" ||
    agentState === "Busy" ||
    agentState === "AfterCallWork";

  useEffect(() => {
    setLoading(true);
    getQuickConnects()
      .then(setEntries)
      .finally(() => setLoading(false));
    setTimeout(() => filterRef.current?.focus(), 50);
  }, [getQuickConnects]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.phoneNumber || "").toLowerCase().includes(q) ||
        (e.queue || "").toLowerCase().includes(q)
    );
  }, [entries, filter]);

  const handlePick = async (entry: QuickConnectEntry) => {
    if (!canDial) {
      toast.error("Cambia tu estado a Available para usar Quick connects");
      return;
    }
    setSubmitting(entry.name);
    try {
      await connectToEndpoint(entry._raw);
      toast.success(`Conectando con ${entry.name}…`);
      onConnected?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo iniciar el contacto"
      );
      setSubmitting(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "var(--bg-2)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          padding: "6px 8px",
          alignItems: "center",
        }}
      >
        <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar destino…"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: 0,
            outline: "none",
            fontSize: 12.5,
            color: "var(--text-1)",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {loading && (
          <div
            className="muted"
            style={{ padding: 18, textAlign: "center", fontSize: 12 }}
          >
            Cargando destinos…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div
            className="muted"
            style={{
              padding: 18,
              textAlign: "center",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {filter
              ? "Sin coincidencias"
              : "Tu routing profile no tiene quick connects configurados."}
          </div>
        )}
        {!loading &&
          filtered.map((entry) => {
            const meta = TYPE_META[entry.type] || TYPE_META.phone_number;
            const isLoading = submitting === entry.name;
            return (
              <button
                key={`${entry.type}-${entry.name}-${entry.endpointARN ?? ""}`}
                type="button"
                onClick={() => handlePick(entry)}
                disabled={!!submitting}
                className="btn"
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "8px 10px",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: 8,
                  height: "auto",
                  textAlign: "left",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: meta.bg,
                    color: meta.tone,
                    flexShrink: 0,
                  }}
                >
                  {entry.type === "agent" ? (
                    <Icon.User size={13} />
                  ) : entry.type === "queue" ? (
                    <Icon.Users size={13} />
                  ) : (
                    <Icon.Phone size={13} />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "var(--text-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name}
                  </span>
                  <span
                    className="muted mono"
                    style={{
                      display: "block",
                      fontSize: 10,
                      marginTop: 1,
                    }}
                  >
                    {meta.label}
                    {entry.phoneNumber ? ` · ${entry.phoneNumber}` : ""}
                  </span>
                </span>
                {isLoading ? (
                  <span className="muted mono" style={{ fontSize: 10 }}>
                    …
                  </span>
                ) : (
                  <Icon.PhoneIn
                    size={12}
                    style={{ color: "var(--text-3)" }}
                  />
                )}
              </button>
            );
          })}
      </div>

      {!canDial && !loading && (
        <div
          className="muted"
          style={{
            padding: "6px 8px",
            fontSize: 10.5,
            textAlign: "center",
            background: "var(--bg-2)",
            borderRadius: 6,
          }}
        >
          Cambia tu estado a Available para conectar
        </div>
      )}
    </div>
  );
}
