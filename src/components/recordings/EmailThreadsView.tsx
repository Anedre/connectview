import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { Mail, Paperclip } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { useContactDetail } from "@/hooks/useContactDetail";
import * as Icon from "@/components/vox/primitives";
import { sanitizeText } from "@/lib/utils";

/**
 * Gmail-style email threads — groups emails by their normalized subject (we
 * strip leading "Re:" / "Fwd:" so a reply chain stays as ONE thread). Each
 * thread expands into a stack of messages with the agent on the left and
 * the customer on the right, attachments rendered as inline chips. The most
 * recent thread is auto-expanded so the user sees the latest exchange first.
 *
 * Used as the dedicated "Emails" lens in /recordings.
 */

interface Props {
  /** Phone OR email address — emails are searched by either side. */
  customerKey: string | null;
}

interface EmailRow {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  agentUsername: string;
  queueName: string;
  customerEndpoint?: string;
}

interface HistoryResponse {
  totalContacts: number;
  contacts: EmailRow[];
}

interface ThreadGroup {
  /** Normalized subject (lowercased, prefix-stripped). */
  key: string;
  /** Display title (first non-empty subject from members, original case). */
  title: string;
  /** Ordered oldest-first inside the thread for natural reading. */
  rows: EmailRow[];
  latestTs: number;
}

/** "Re: Re: foo" → "foo"; preserves original case for display. */
function normalizeSubject(raw: string): { display: string; key: string } {
  const cleaned = (raw || "(sin asunto)")
    .replace(/^\s*(re|fwd|fw|rv|rv:)\s*:\s*/gi, "")
    .replace(/^\s*(re|fwd|fw|rv|rv:)\s*:\s*/gi, "") // a second pass — sometimes "Re: Fwd:"
    .trim();
  return { display: cleaned || "(sin asunto)", key: cleaned.toLowerCase() };
}

export function EmailThreadsView({ customerKey }: Props) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!customerKey) return;
    const ep = getApiEndpoints();
    const url = ep?.getContactHistory;
    if (!url) {
      setError("Endpoint no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${url}?phone=${encodeURIComponent(customerKey)}&limit=200`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!ok) throw new Error(j.message || `HTTP ${status}`);
        setData(j as HistoryResponse);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [customerKey]);

  const emailRows = useMemo(() => {
    if (!data) return [];
    return (data.contacts || []).filter(
      (c) => (c.channel || "").toUpperCase() === "EMAIL"
    );
  }, [data]);

  // We need subjects to group — fetch each detail in parallel to obtain the
  // Subject (Contact.Name in DescribeContact). Light request fan-out: history
  // is capped at 200 → at most 200 detail calls, but the typical customer has
  // <20 emails.
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  useEffect(() => {
    if (emailRows.length === 0) {
      setSubjects({});
      return;
    }
    const ep = getApiEndpoints();
    const url = ep?.getContactDetail;
    if (!url) return;
    let cancelled = false;
    const out: Record<string, string> = {};
    Promise.all(
      emailRows.map(async (row) => {
        try {
          const r = await fetch(
            `${url}?contactId=${encodeURIComponent(row.contactId)}`
          );
          if (!r.ok) return;
          const j = await r.json();
          out[row.contactId] = j.subject || "";
        } catch {
          // ignore individual failures
        }
      })
    ).then(() => {
      if (!cancelled) setSubjects(out);
    });
    return () => {
      cancelled = true;
    };
  }, [emailRows]);

  const threads = useMemo<ThreadGroup[]>(() => {
    const buckets = new Map<string, ThreadGroup>();
    for (const row of emailRows) {
      const sub = subjects[row.contactId] || "(sin asunto)";
      const { display, key } = normalizeSubject(sub);
      const ts = Date.parse(row.initiationTimestamp) || 0;
      const existing = buckets.get(key);
      if (existing) {
        existing.rows.push(row);
        if (ts > existing.latestTs) existing.latestTs = ts;
      } else {
        buckets.set(key, { key, title: display, rows: [row], latestTs: ts });
      }
    }
    // Sort messages oldest → newest within a thread, threads newest → oldest.
    for (const g of buckets.values()) {
      g.rows.sort(
        (a, b) =>
          (Date.parse(a.initiationTimestamp) || 0) -
          (Date.parse(b.initiationTimestamp) || 0)
      );
    }
    return Array.from(buckets.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [emailRows, subjects]);

  // Auto-expand the most recent thread.
  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    if (threads.length > 0 && openKey === null) {
      setOpenKey(threads[0].key);
    }
  }, [threads, openKey]);

  if (!customerKey) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
        Selecciona un cliente para ver sus emails.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
        Cargando emails…
      </div>
    );
  }
  if (error) {
    return (
      <div
        style={{
          margin: 16,
          padding: 12,
          background: "var(--accent-red-soft)",
          color: "var(--accent-red)",
          borderRadius: 8,
          fontSize: 12.5,
        }}
      >
        {error}
      </div>
    );
  }
  if (emailRows.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
        Este cliente no tiene emails registrados.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Icon.User size={14} style={{ color: "var(--text-3)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{customerKey}</div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
            {threads.length} hilo{threads.length === 1 ? "" : "s"} ·{" "}
            {emailRows.length} email{emailRows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div
        style={{
          maxHeight: "64vh",
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {threads.map((g) => (
          <EmailThreadCard
            key={g.key}
            group={g}
            expanded={openKey === g.key}
            onToggle={() =>
              setOpenKey((cur) => (cur === g.key ? null : g.key))
            }
          />
        ))}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function EmailThreadCard({
  group,
  expanded,
  onToggle,
}: {
  group: ThreadGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const latest = group.rows[group.rows.length - 1];
  const latestDt = latest ? new Date(latest.initiationTimestamp) : null;
  const relativeAgo = latestDt
    ? formatDistanceToNow(latestDt, { addSuffix: true, locale: es })
    : "";
  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-amber)",
          }}
        >
          <Mail size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={group.title}
          >
            {group.title}
          </div>
          <div
            className="muted"
            style={{ fontSize: 10.5, marginTop: 2 }}
          >
            {group.rows.length} mensaje{group.rows.length === 1 ? "" : "s"} · último {relativeAgo}
          </div>
        </div>
        <div
          style={{
            fontSize: 14,
            color: "var(--text-3)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ›
        </div>
      </button>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-1)",
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {group.rows.map((row) => (
            <EmailMessageRow key={row.contactId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmailMessageRow({ row }: { row: EmailRow }) {
  const { detail, loading } = useContactDetail(row.contactId);

  // Heuristic: AGENT → outbound (right-aligned, blue tint), CUSTOMER → inbound
  // (left-aligned, neutral). For inbound emails the "agent" is the one who
  // received/replied, so we treat absence of an agent name as inbound.
  const initiationMethod = (detail?.initiationMethod || "").toUpperCase();
  const isOutbound =
    initiationMethod.includes("OUTBOUND") ||
    initiationMethod === "API" ||
    initiationMethod === "AGENT_REPLY";
  const dt = row.initiationTimestamp ? new Date(row.initiationTimestamp) : null;
  const when = dt ? format(dt, "d MMM yyyy · HH:mm", { locale: es }) : "";

  const segs = (detail?.transcript?.segments || []) as Array<{
    participant?: string;
    content?: string;
  }>;
  const body = segs.map((s) => s.content || "").filter(Boolean).join("\n\n");
  const attrs = detail?.attributes || {};
  const from =
    attrs.email_from ||
    attrs.from ||
    attrs.From ||
    (isOutbound ? row.agentUsername : row.customerEndpoint || "");
  const to =
    attrs.email_to ||
    attrs.to ||
    attrs.To ||
    (isOutbound ? row.customerEndpoint || "" : detail?.systemEndpoint || "");

  return (
    <div
      style={{
        background: isOutbound
          ? "var(--accent-blue-soft, #e6f0ff)"
          : "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        padding: 10,
        marginLeft: isOutbound ? 24 : 0,
        marginRight: isOutbound ? 0 : 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 600 }}>
          {isOutbound ? "Agente →" : "← Cliente"} · {sanitizeText(from)}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {when}
        </div>
      </div>
      {to && (
        <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
          Para: {sanitizeText(to)}
        </div>
      )}
      {loading ? (
        <div className="muted" style={{ fontSize: 11 }}>
          Cargando contenido…
        </div>
      ) : body ? (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {sanitizeText(body)}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11.5 }}>
          (sin contenido visible)
        </div>
      )}
      {(detail?.attachments?.length || 0) > 0 && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {(detail?.attachments || []).map((a) => (
            <a
              key={a.fileId}
              href={a.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
                borderRadius: 6,
                fontSize: 11,
                textDecoration: "none",
                color: "var(--text-1)",
              }}
            >
              <Paperclip size={12} style={{ flexShrink: 0 }} /> {a.fileName || a.fileId}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
