import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCallbacks,
  type CallbackRecord,
} from "@/hooks/useCallbacks";
import { sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

interface FollowupsDrawerProps {
  /** External refresh counter — bumped by the parent (e.g. when the
   *  ScheduleFollowupModal successfully schedules a new follow-up) to
   *  trigger an immediate refetch instead of waiting for the next
   *  60s poll. */
  refreshKey?: number;
}

type Channel = "voice" | "email" | "whatsapp";

const CHANNEL_META: Record<
  Channel,
  { icon: string; label: string; color: string; bg: string }
> = {
  voice: {
    icon: "📞",
    label: "Llamada",
    color: "var(--accent-cyan)",
    bg: "var(--accent-cyan-soft)",
  },
  email: {
    icon: "📧",
    label: "Email",
    color: "var(--accent-amber)",
    bg: "var(--accent-amber-soft)",
  },
  whatsapp: {
    icon: "💬",
    label: "WhatsApp",
    color: "var(--accent-green)",
    bg: "var(--accent-green-soft)",
  },
};

function channelOf(c: CallbackRecord): Channel {
  return (c.channel as Channel) || "voice";
}

/**
 * Collapsible drawer that surfaces the agent's pending follow-ups
 * (voice callbacks + email + WhatsApp). Polls list-callbacks every
 * 60s so countdowns shrink in (near) real time and dispatched/attended
 * rows disappear from the list.
 *
 * Sits at the bottom of the agent desktop alongside the missed-history
 * drawer. Auto-opens when:
 *  - any voice callback is due in < 5 min (about to dispatch), OR
 *  - any email/whatsapp follow-up is already DUE (needs the agent's
 *    manual action right now).
 *
 * Per-row actions:
 *   • voice (SCHEDULED) → Cancelar
 *   • email / whatsapp (SCHEDULED, before the time) → Cancelar
 *   • email / whatsapp (DUE) → "Marcar enviado" (completes the row)
 *     + Cancelar
 *
 * Hidden entirely until the Lambda is deployed (the hook reports
 * `available: false`).
 */
export function CallbackHistoryDrawer({
  refreshKey,
}: FollowupsDrawerProps = {}) {
  // PENDING = SCHEDULED OR DUE — covers voice callbacks waiting for
  // their dispatch time AND email/whatsapp follow-ups that are due now
  // and need manual attention.
  const { callbacks, loading, error, refetch, cancel, complete, available } =
    useCallbacks({ status: "PENDING", pollIntervalSec: 60 });

  // When the parent bumps `refreshKey`, refetch immediately so a
  // freshly-scheduled follow-up shows up without waiting 60s.
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;
    refetch();
  }, [refreshKey, refetch]);

  // Auto-expand when something is imminent OR already DUE — the agent
  // needs to see it before the dispatcher fires (voice) or right now
  // (email/whatsapp).
  const { dueSoonCount, dueNowCount } = useMemo(() => {
    const soon = Date.now() + 5 * 60 * 1000;
    let dueSoon = 0;
    let dueNow = 0;
    for (const c of callbacks) {
      if (c.status === "DUE") {
        dueNow += 1;
      } else if (new Date(c.scheduledAt).getTime() <= soon) {
        dueSoon += 1;
      }
    }
    return { dueSoonCount: dueSoon, dueNowCount: dueNow };
  }, [callbacks]);

  const [openManual, setOpenManual] = useState<boolean | null>(null);
  const open = openManual ?? dueSoonCount + dueNowCount > 0;

  useDebugRender("FollowupsDrawer", {
    open,
    count: callbacks.length,
    dueSoonCount,
    dueNowCount,
    loading,
    error: error || undefined,
    available,
  });

  if (!available) return null;
  if (callbacks.length === 0 && openManual !== true && !loading && !error)
    return null;

  return (
    <div
      data-debug-component="FollowupsDrawer"
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
        title={open ? "Cerrar follow-ups" : "Ver follow-ups pendientes"}
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
          Mis follow-ups
        </span>
        <span
          className="chip chip--cyan"
          style={{ fontSize: 10, padding: "1px 6px" }}
        >
          {callbacks.length}
        </span>
        {dueNowCount > 0 && (
          <span
            className="chip chip--red"
            style={{ fontSize: 10, padding: "1px 6px", fontWeight: 600 }}
            title="Follow-ups que necesitan tu acción ahora"
          >
            🔴 {dueNowCount} ahora
          </span>
        )}
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
              No tienes follow-ups pendientes. Agéndalos durante una llamada
              con el botón <span style={{ whiteSpace: "nowrap" }}>📅 Agendar</span>.
            </div>
          ) : (
            callbacks.map((c) => (
              <FollowupRow
                key={c.callbackId}
                record={c}
                onCancel={async () => {
                  try {
                    await cancel(c.callbackId);
                    toast.success("Follow-up cancelado");
                    refetch();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "No se pudo cancelar"
                    );
                  }
                }}
                onComplete={async () => {
                  try {
                    await complete(c.callbackId);
                    toast.success("✅ Marcado como enviado");
                    refetch();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "No se pudo completar"
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

function FollowupRow({
  record,
  onCancel,
  onComplete,
}: {
  record: CallbackRecord;
  onCancel: () => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const ch = channelOf(record);
  const meta = CHANNEL_META[ch];
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

  const isDue = record.status === "DUE";

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };
  const handleComplete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: isDue
          ? "var(--accent-red-soft)"
          : countdown.urgent
          ? "var(--accent-amber-soft)"
          : "var(--bg-2)",
        border: isDue
          ? "1px solid var(--accent-red)"
          : countdown.urgent
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
          width: 26,
          height: 26,
          borderRadius: 999,
          background: meta.bg,
          color: meta.color,
          flexShrink: 0,
          fontSize: 13,
        }}
        title={meta.label}
      >
        {meta.icon}
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
              maxWidth: 140,
              whiteSpace: "nowrap",
            }}
          >
            {sanitizeText(record.customerName) || "Cliente"}
          </span>
          <span
            className="mono"
            style={{ color: "var(--text-2)", fontSize: 11 }}
          >
            {ch === "email" && record.emailToAddress
              ? record.emailToAddress
              : record.phone}
          </span>
          {isDue ? (
            <span
              style={{
                fontSize: 10.5,
                color: "var(--accent-red)",
                fontWeight: 600,
              }}
              title={localTime}
            >
              🔴 ACCIÓN AHORA · {localTime}
            </span>
          ) : (
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
          )}
        </div>
        {/* Channel-specific second line */}
        {ch === "email" && record.emailSubject && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={sanitizeText(record.emailSubject)}
          >
            📧 {sanitizeText(record.emailSubject)}
          </div>
        )}
        {ch === "whatsapp" && record.templateName && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              marginTop: 2,
            }}
            title={record.templateName}
          >
            💬 Template: {record.templateName}
          </div>
        )}
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
            title={sanitizeText(record.notes)}
          >
            📝 {sanitizeText(record.notes)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {isDue && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing || cancelling}
            className="btn btn--success btn--sm"
            style={{ fontSize: 10.5, padding: "4px 8px" }}
            title="Marca este follow-up como ya enviado/atendido"
          >
            {completing ? "…" : "✅ Enviado"}
          </button>
        )}
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling || completing}
          className="btn btn--ghost btn--sm"
          style={{ fontSize: 10.5, padding: "4px 8px" }}
          title="Cancelar este follow-up"
        >
          {cancelling ? "…" : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
