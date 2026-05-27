import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { formatDurationSec } from "@/lib/utils";

export interface ContactRow {
  contactId: string;
  channel: string;
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp?: string;
  agentUsername?: string;
  queueName?: string;
  duration?: number;
  sentiment?: string;
  hasRecording?: boolean;
  initiationMethod?: string;
  disconnectReason?: string;
}

type ChannelFilter = "all" | "voice" | "chat" | "email";

interface Props {
  /** phone OR email to query history for. */
  customerKey: string | null;
  selectedContactId: string | null;
  onSelect: (c: ContactRow) => void;
}

const FILTER_LABELS: Record<ChannelFilter, string> = {
  all: "Todos",
  voice: "📞 Voz",
  chat: "💬 Chat / WhatsApp",
  email: "📧 Email",
};

function normalizeChannel(c: ContactRow): "voice" | "chat" | "email" | "other" {
  const ch = (c.channel || "").toUpperCase();
  if (ch === "VOICE" || ch === "TELEPHONY") return "voice";
  if (ch === "CHAT") return "chat";
  if (ch === "EMAIL") return "email";
  return "other";
}

function channelLabel(c: ContactRow): string {
  const n = normalizeChannel(c);
  if (n === "voice") return "Llamada";
  if (n === "chat") {
    if ((c.subChannel || "").toLowerCase().includes("messaging")) return "WhatsApp";
    return "Chat";
  }
  if (n === "email") return "Email";
  return c.channel || "Otro";
}

function channelIcon(c: ContactRow): string {
  const n = normalizeChannel(c);
  if (n === "voice") return "📞";
  if (n === "email") return "📧";
  if (n === "chat") {
    if ((c.subChannel || "").toLowerCase().includes("messaging")) return "💚";
    return "💬";
  }
  return "•";
}

export function CustomerContactsList({
  customerKey,
  selectedContactId,
  onSelect,
}: Props) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChannelFilter>("all");

  useEffect(() => {
    setContacts([]);
    setError(null);
    if (!customerKey) return;

    const endpoints = getApiEndpoints();
    if (!endpoints?.getContactHistory) {
      setError("Endpoint getContactHistory no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(
      `${endpoints.getContactHistory}?phone=${encodeURIComponent(
        customerKey
      )}&limit=200`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        if (ctrl.signal.aborted) return;
        const list: ContactRow[] = data.contacts || [];
        list.sort((a, b) =>
          (b.initiationTimestamp || "").localeCompare(
            a.initiationTimestamp || ""
          )
        );
        setContacts(list);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error cargando historial");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [customerKey]);

  const filtered = useMemo(() => {
    if (filter === "all") return contacts;
    return contacts.filter((c) => normalizeChannel(c) === filter);
  }, [contacts, filter]);

  const counts = useMemo(() => {
    const r: Record<ChannelFilter, number> = {
      all: contacts.length,
      voice: 0,
      chat: 0,
      email: 0,
    };
    for (const c of contacts) {
      const n = normalizeChannel(c);
      if (n === "voice") r.voice += 1;
      else if (n === "chat") r.chat += 1;
      else if (n === "email") r.email += 1;
    }
    return r;
  }, [contacts]);

  if (!customerKey) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <Icon.User size={28} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 10 }}>
          Selecciona un cliente del panel izquierdo para ver su historial.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tabs por canal */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-1)",
          flexWrap: "wrap",
        }}
      >
        {(["all", "voice", "chat", "email"] as ChannelFilter[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`btn btn--sm ${filter === k ? "" : "btn--ghost"}`}
            style={{ fontSize: 11, padding: "0 10px", height: 26 }}
          >
            {FILTER_LABELS[k]}
            <span
              className="mono"
              style={{ marginLeft: 4, opacity: 0.7, fontSize: 10 }}
            >
              {counts[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Loading / error */}
      {loading && (
        <div
          className="muted"
          style={{ padding: 16, textAlign: "center", fontSize: 12 }}
        >
          Cargando historial…
        </div>
      )}
      {error && !loading && (
        <div
          style={{
            margin: 12,
            padding: 10,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            borderRadius: 6,
            fontSize: 11.5,
          }}
        >
          {error}
        </div>
      )}

      {/* Contact list */}
      <div style={{ overflowY: "auto", flex: 1, padding: "6px 8px" }}>
        {!loading && !error && filtered.length === 0 && (
          <div
            className="muted"
            style={{ padding: 18, textAlign: "center", fontSize: 11.5 }}
          >
            {contacts.length === 0
              ? "Sin contactos en el historial."
              : `Sin contactos de ${FILTER_LABELS[filter].toLowerCase()}.`}
          </div>
        )}

        {filtered.map((c) => {
          const isSelected = c.contactId === selectedContactId;
          const ts = c.initiationTimestamp;
          const rel = (() => {
            try {
              return formatDistanceToNow(new Date(ts), {
                addSuffix: true,
                locale: es,
              });
            } catch {
              return "";
            }
          })();
          return (
            <button
              key={c.contactId}
              type="button"
              onClick={() => onSelect(c)}
              style={{
                display: "flex",
                width: "100%",
                padding: "10px 12px",
                gap: 10,
                textAlign: "left",
                background: isSelected
                  ? "var(--accent-cyan-soft)"
                  : "transparent",
                border: 0,
                borderRadius: 8,
                cursor: "pointer",
                color: "var(--text-1)",
                marginBottom: 4,
                alignItems: "flex-start",
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-2)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "transparent";
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  width: 26,
                  textAlign: "center",
                  marginTop: 2,
                }}
              >
                {channelIcon(c)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {channelLabel(c)}
                  </span>
                  <span
                    className="muted mono"
                    style={{ fontSize: 10.5, flexShrink: 0 }}
                  >
                    {c.duration
                      ? formatDurationSec(c.duration)
                      : c.disconnectReason === "EXPIRED"
                      ? "expiró"
                      : ""}
                  </span>
                </span>
                <span
                  className="muted"
                  style={{
                    display: "block",
                    fontSize: 10.5,
                    marginTop: 2,
                  }}
                >
                  {rel}
                  {c.agentUsername && ` · con ${c.agentUsername}`}
                </span>
                <span
                  className="muted"
                  style={{
                    display: "block",
                    fontSize: 10,
                    marginTop: 2,
                  }}
                >
                  {c.queueName && `cola: ${c.queueName}`}
                  {c.sentiment && c.sentiment !== "UNKNOWN" && (
                    <span style={{ marginLeft: 6 }}>
                      sentiment: {c.sentiment.toLowerCase()}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
