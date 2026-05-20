import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCallbacks,
  type CallbackRecord,
} from "@/hooks/useCallbacks";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

interface CallbackHistoryDrawerProps {
  /** External refresh counter — bumped by the parent (e.g. when the
   *  ScheduleCallbackModal successfully schedules a new callback) to
   *  trigger an immediate refetch instead of waiting for the next
   *  60s poll. */
  refreshKey?: number;
}

/**
 * Collapsible drawer that surfaces the agent's pending scheduled
 * callbacks. Polls list-callbacks every 60s so the countdown shrinks
 * in (near) real time and dispatched callbacks disappear from the
 * list.
 *
 * Sits at the bottom of the agent desktop alongside the missed-history
 * drawer. Stays collapsed by default — but auto-opens if a callback is
 * due in <5 minutes so the agent doesn't miss it.
 *
 * Per-row "Cancelar" button issues a soft-cancel via the cancel-callback
 * Lambda; the row stays in DynamoDB for audit but is moved to
 * status=CANCELLED so the dispatcher skips it.
 *
 * Hidden entirely until the Lambda is deployed (the hook reports
 * `available: false`).
 */
export function CallbackHistoryDrawer({
  refreshKey,
}: CallbackHistoryDrawerProps = {}) {
  const { callbacks, loading, error, refetch, cancel, available } =
    useCallbacks({ status: "SCHEDULED", pollIntervalSec: 60 });
  // When the parent bumps `refreshKey`, refetch immediately so a
  // freshly-scheduled callback shows up without waiting 60s.
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;
    refetch();
  }, [refreshKey, refetch]);
  // Auto-expand when something is imminent — the agent needs to see it
  // before the dispatcher fires.
  const dueSoonCount = useMemo(() => {
    const soon = Date.now() + 5 * 60 * 1000;
    return callbacks.filter(
      (c) => new Date(c.scheduledAt).getTime() <= soon
    ).length;
  }, [callbacks]);
  const [openManual, setOpenManual] = useState<boolean | null>(null);
  const open = openManual ?? dueSoonCount > 0;

  useDebugRender("CallbackHistoryDrawer", {
    open,
    count: callbacks.length,
    dueSoonCount,
    loading,
    error: error || undefined,
    available,
  });

  if (!available) return null;
  // Hide entirely when there are no pending callbacks AND the agent
  // hasn't manually opened it — keeps the desktop clean.
  if (callbacks.length === 0 && openManual !== true && !loading && !error)
    return null;

  return (
    <div
      data-debug-component="CallbackHistoryDrawer"
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
        onClick={() => setOpenManual((o) => !(o ?? open))}
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
        title={open ? "Cerrar callbacks" : "Ver callbacks programados"}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "var(--accent-cyan-soft)",
            color: "var(--accent-cyan)",
            fontSize: 11,
          }}
        >
          📅
        </span>
        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
          Callbacks programados
        </span>
        <span
          className="chip chip--cyan"
          style={{ fontSize: 10, padding: "1px 6px" }}
        >
          {callbacks.length}
        </span>
        {dueSoonCount > 0 && (
          <span
            className="chip chip--amber"
            style={{ fontSize: 10, padding: "1px 6px" }}
            title="Callbacks que se disparan en menos de 5 minutos"
          >
            ⏰ {dueSoonCount} pronto
          </span>
        )}
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
          {callbacks.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                fontSize: 12,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No tienes callbacks programados. Promételos durante una llamada
              con el botón <span style={{ whiteSpace: "nowrap" }}>📅 Agendar</span>.
            </div>
          ) : (
            callbacks.map((c) => (
              <CallbackRow
                key={c.callbackId}
                record={c}
                onCancel={async () => {
                  try {
                    await cancel(c.callbackId);
                    toast.success("Callback cancelado");
                    refetch();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "No se pudo cancelar"
                    );
                  }
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function fmtCountdown(scheduledAt: string): {
  label: string;
  urgent: boolean;
  past: boolean;
} {
  const ts = new Date(scheduledAt).getTime();
  const now = Date.now();
  const diffSec = Math.round((ts - now) / 1000);
  if (diffSec < -60) {
    // Past — the dispatcher should have fired it already; if it hasn't
    // there's likely a problem upstream.
    const abs = Math.abs(diffSec);
    if (abs < 3600) return { label: `hace ${Math.floor(abs / 60)} min`, urgent: false, past: true };
    if (abs < 86400) return { label: `hace ${Math.floor(abs / 3600)} h`, urgent: false, past: true };
    return { label: `hace ${Math.floor(abs / 86400)} días`, urgent: false, past: true };
  }
  if (diffSec < 0) return { label: "ahora", urgent: true, past: false };
  if (diffSec < 60) return { label: `en ${diffSec}s`, urgent: true, past: false };
  if (diffSec < 300) return { label: `en ${Math.floor(diffSec / 60)} min`, urgent: true, past: false };
  if (diffSec < 3600)
    return { label: `en ${Math.floor(diffSec / 60)} min`, urgent: false, past: false };
  if (diffSec < 86400)
    return { label: `en ${Math.floor(diffSec / 3600)} h`, urgent: false, past: false };
  return { label: `en ${Math.floor(diffSec / 86400)} días`, urgent: false, past: false };
}

function CallbackRow({
  record,
  onCancel,
}: {
  record: CallbackRecord;
  onCancel: () => void | Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const countdown = useMemo(
    () => fmtCountdown(record.scheduledAt),
    [record.scheduledAt]
  );
  const localTime = useMemo(() => {
    try {
      return new Date(record.scheduledAt).toLocaleString("es-PE", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return record.scheduledAt;
    }
  }, [record.scheduledAt]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: countdown.urgent ? "var(--accent-amber-soft)" : "var(--bg-2)",
        border: countdown.urgent
          ? "1px solid var(--accent-amber)"
          : "1px solid transparent",
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
          background: "var(--accent-cyan-soft)",
          color: "var(--accent-cyan)",
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        📅
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
            style={{
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 160,
              whiteSpace: "nowrap",
            }}
          >
            {record.customerName || "Cliente"}
          </span>
          <span
            className="mono"
            style={{ color: "var(--text-2)", fontSize: 11 }}
          >
            {record.phone}
          </span>
          <span
            className={countdown.urgent ? "" : "muted"}
            style={{
              fontSize: 10.5,
              color: countdown.urgent
                ? "var(--accent-amber)"
                : countdown.past
                ? "var(--accent-red)"
                : undefined,
              fontWeight: countdown.urgent ? 600 : 400,
            }}
            title={localTime}
          >
            {countdown.past ? "⚠ " : "⏰ "}
            {countdown.label} · {localTime}
          </span>
        </div>
        {record.notes && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={record.notes}
          >
            📝 {record.notes}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleCancel}
        disabled={cancelling}
        className="btn btn--ghost btn--sm"
        style={{ fontSize: 10.5, padding: "4px 10px" }}
        title="Cancelar este callback"
      >
        {cancelling ? "…" : "Cancelar"}
      </button>
    </div>
  );
}
