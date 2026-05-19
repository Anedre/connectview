import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useMissedContactsHistory,
  type MissedContactRecord,
} from "@/hooks/useMissedContactsHistory";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

/**
 * Collapsible drawer that surfaces the agent's missed contacts from
 * the Connect `SearchContacts` API (via the list-missed-contacts
 * Lambda). Sits at the bottom of the agent desktop and stays
 * collapsed by default — the agent only opens it when they want to
 * audit / call back missed contacts beyond the 30-second live-tab
 * window.
 *
 * One-click "Devolver" button per row places an outbound call. Other
 * channels (chat / email) show the row but don't offer auto-callback
 * — we don't have outbound chat plumbing in this build.
 *
 * Hidden entirely until the Lambda is deployed (the hook reports
 * `available: false`).
 */
export function MissedHistoryDrawer() {
  const { records, loading, error, refetch, available } =
    useMissedContactsHistory({ hours: 24, limit: 50, pollIntervalSec: 90 });
  const [open, setOpen] = useState(false);

  useDebugRender("MissedHistoryDrawer", {
    open,
    count: records.length,
    loading,
    error: error || undefined,
    available,
  });

  if (!available) return null;
  // Hide entirely when there are no missed contacts AND the user
  // hasn't manually opened it — keeps the desktop clean.
  if (records.length === 0 && !open && !loading && !error) return null;

  return (
    <div
      data-debug-component="MissedHistoryDrawer"
      style={{
        borderTop: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        flexShrink: 0,
        maxHeight: open ? "40vh" : "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          all: "unset",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--text-2)",
          width: "100%",
          boxSizing: "border-box",
        }}
        title={open ? "Cerrar historial" : "Ver historial de perdidas"}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
          }}
        >
          <Icon.Hangup size={11} />
        </span>
        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
          Perdidas (24h)
        </span>
        <span
          className="chip chip--red"
          style={{ fontSize: 10, padding: "1px 6px" }}
        >
          {records.length}
        </span>
        {loading && (
          <span className="muted mono" style={{ fontSize: 10 }}>
            actualizando…
          </span>
        )}
        {error && (
          <span style={{ color: "var(--accent-red)", fontSize: 10 }}>
            {error}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div
          style={{
            overflowY: "auto",
            padding: "4px 8px 10px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "0 6px 4px",
            }}
          >
            <button
              type="button"
              onClick={refetch}
              className="btn btn--ghost btn--sm"
              style={{ fontSize: 10.5 }}
              disabled={loading}
            >
              <Icon.Refresh size={11} /> Recargar
            </button>
          </div>
          {records.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                fontSize: 12,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No has perdido contactos en las últimas 24 horas.
            </div>
          ) : (
            records.map((r) => <MissedRow key={r.contactId} record={r} />)
          )}
        </div>
      )}
    </div>
  );
}

function fmtAge(seconds: number): string {
  if (seconds < 60) return `hace ${Math.max(0, seconds)}s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} días`;
}

function channelMeta(channel: string) {
  const k = channel.toUpperCase();
  if (k === "VOICE")
    return { Icn: Icon.Phone, color: "var(--accent-green)", label: "Voz" };
  if (k === "CHAT")
    return { Icn: Icon.Chat, color: "var(--accent-cyan)", label: "Chat" };
  if (k === "EMAIL")
    return { Icn: Icon.Mail, color: "var(--accent-amber)", label: "Email" };
  if (k === "TASK")
    return { Icn: Icon.Note, color: "var(--accent-violet)", label: "Tarea" };
  return { Icn: Icon.Phone, color: "var(--text-3)", label: channel };
}

function MissedRow({ record }: { record: MissedContactRecord }) {
  const { placeCall } = useCCP();
  const meta = useMemo(() => channelMeta(record.channel), [record.channel]);
  const Icn = meta.Icn;
  const [calling, setCalling] = useState(false);
  const isVoice = record.channel.toUpperCase() === "VOICE";
  const canCallback = isVoice && !!record.customerEndpoint;

  const handleCallback = async () => {
    if (!record.customerEndpoint || calling) return;
    setCalling(true);
    try {
      await placeCall(record.customerEndpoint);
      toast.success("Llamando…", {
        description: `Devolviendo llamada a ${record.customerEndpoint}`,
      });
    } catch (err) {
      toast.error("No se pudo iniciar la llamada", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setCalling(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: "var(--bg-2)",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 24,
          height: 24,
          borderRadius: 999,
          background: "var(--accent-red-soft)",
          color: meta.color,
          flexShrink: 0,
        }}
      >
        <Icn size={12} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <span
            className="mono"
            style={{
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {record.customerEndpoint || "—"}
          </span>
          <span
            className="muted"
            style={{ fontSize: 10.5 }}
          >
            {meta.label} · {record.queueName || "Sin cola"} · {fmtAge(record.ageSeconds)}
          </span>
        </div>
        {record.disconnectReason && (
          <div
            className="mono"
            style={{
              fontSize: 9.5,
              color: "var(--text-3)",
              marginTop: 2,
              opacity: 0.7,
            }}
          >
            {record.disconnectReason}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleCallback}
        disabled={!canCallback || calling}
        className="btn btn--success btn--sm"
        style={{ fontSize: 10.5, padding: "4px 10px" }}
        title={
          isVoice
            ? canCallback
              ? "Devolver llamada"
              : "Sin teléfono"
            : "Devolución solo en voz"
        }
      >
        <Icon.PhoneIn size={11} />
        {calling ? "…" : "Devolver"}
      </button>
    </div>
  );
}
