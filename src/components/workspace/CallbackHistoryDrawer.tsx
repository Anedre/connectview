import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, Mail, MessageCircle, PenLine, ListTodo } from "lucide-react";
import {
  useCallbacks,
  type CallbackRecord,
} from "@/hooks/useCallbacks";
import { sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

const POSITION_KEY = "vox.followups.position";

interface WidgetPosition {
  /** Distance from the right edge of the viewport, in px. */
  right: number;
  /** Distance from the bottom edge of the viewport, in px. */
  bottom: number;
}

function loadPosition(): WidgetPosition {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (
        typeof p?.right === "number" &&
        typeof p?.bottom === "number" &&
        Number.isFinite(p.right) &&
        Number.isFinite(p.bottom)
      ) {
        return { right: p.right, bottom: p.bottom };
      }
    }
  } catch {
    /* ignore */
  }
  return { right: 12, bottom: 12 };
}

function savePosition(p: WidgetPosition) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

interface FollowupsDrawerProps {
  /** External refresh counter — bumped by the parent (e.g. when the
   *  ScheduleFollowupModal successfully schedules a new follow-up) to
   *  trigger an immediate refetch instead of waiting for the next
   *  60s poll. */
  refreshKey?: number;
}

type Channel = "voice" | "email" | "whatsapp" | "task";

const CHANNEL_META: Record<
  Channel,
  { icon: React.ElementType; label: string; color: string; bg: string }
> = {
  voice: {
    icon: Phone,
    label: "Llamada",
    color: "var(--accent-cyan)",
    bg: "var(--accent-cyan-soft)",
  },
  email: {
    icon: Mail,
    label: "Email",
    color: "var(--accent-amber)",
    bg: "var(--accent-amber-soft)",
  },
  whatsapp: {
    icon: MessageCircle,
    label: "WhatsApp",
    color: "var(--accent-green)",
    bg: "var(--accent-green-soft)",
  },
  task: {
    icon: ListTodo,
    label: "Tarea",
    color: "var(--accent-violet)",
    bg: "var(--accent-violet-soft)",
  },
};

// Defaulta a "voice" para filas legacy; cualquier canal desconocido cae a
// "task" para no romper el render (CHANNEL_META siempre tiene la entrada).
function channelOf(c: CallbackRecord): Channel {
  const ch = (c.channel as Channel) || "voice";
  return ch in CHANNEL_META ? ch : "task";
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

  // Drawer starts collapsed by default — even when items are due, we
  // surface urgency through the red/amber chips in the header bar so
  // the agent notices without losing softphone real estate. They click
  // to expand. `openManual` overrides this once the user interacts.
  const [openManual, setOpenManual] = useState<boolean | null>(null);
  const open = openManual ?? false;

  useDebugRender("FollowupsDrawer", {
    open,
    count: callbacks.length,
    dueSoonCount,
    dueNowCount,
    loading,
    error: error || undefined,
    available,
  });

  // ─── Draggable widget plumbing ────────────────────────────────
  // Position is stored as (right, bottom) px from the viewport edges
  // so the widget stays anchored relative to wherever the user
  // dropped it — including after window resizes that don't change the
  // edge distances. Persisted to localStorage.
  const [position, setPosition] = useState<WidgetPosition>(() => loadPosition());
  // Mirror of `position` in a ref so the pointerUp handler can read
  // the LATEST value without being trapped in its render-time closure
  // (setState is async; the closure pointerUp captures may still hold
  // the pre-drag position when pointerUp fires).
  const positionRef = useRef<WidgetPosition>(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);
  // Survives past pointerUp into the click event so the click handler
  // can tell apart "user actually clicked" from "drag just ended".
  const justDraggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-followups-toggle]")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom,
      moved: false,
    };
    justDraggedRef.current = false;
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!s.moved) {
      s.moved = true;
      setDragging(true);
    }
    const margin = 4;
    const widgetW = 340;
    const widgetH = 280;
    const right = Math.max(
      margin,
      Math.min(window.innerWidth - widgetW - margin, s.startRight - dx)
    );
    const bottom = Math.max(
      margin,
      Math.min(window.innerHeight - widgetH - margin, s.startBottom - dy)
    );
    const next = { right, bottom };
    positionRef.current = next;
    setPosition(next);
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* noop */ }
    if (s.moved) {
      // Read from the ref — `position` from this closure may be stale
      // because setState is async and pointerUp can fire before the
      // last setPosition has flushed.
      savePosition(positionRef.current);
      setDragging(false);
      // Flag so the click event that fires next swallows the toggle.
      justDraggedRef.current = true;
    }
    dragStateRef.current = null;
  };

  const onHeaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Swallow the click that always fires after a successful drag.
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.stopPropagation();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("[data-followups-noclick]")) return;
    setOpenManual((o) => !(o ?? open));
  };

  // Solo se oculta si el endpoint no está desplegado. Antes también se ocultaba
  // cuando no había tareas pendientes → el agente "no veía" el bubble y creía
  // que la función había desaparecido. Ahora el bubble está SIEMPRE visible
  // (aunque sea "Tareas 0") para que sea descubrible y accionable.
  if (!available) return null;

  return (
    <div
      data-debug-component="FollowupsDrawer"
      style={{
        position: "fixed",
        bottom: position.bottom,
        right: position.right,
        width: open ? 340 : "auto",
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 12,
        boxShadow: dragging
          ? "0 24px 60px -12px rgba(0,0,0,0.7), 0 0 0 1px var(--accent-violet)"
          : open
          ? "0 20px 48px -16px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.35)"
          : "0 6px 20px -8px rgba(0,0,0,0.45)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 90,
        transition: dragging ? "none" : "box-shadow .2s ease",
        userSelect: dragging ? "none" : "auto",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onClick={onHeaderClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpenManual((o) => !(o ?? open));
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: dragging ? "grabbing" : "grab",
          fontSize: 11.5,
          color: "var(--text-2)",
          height: 38,
          flexShrink: 0,
          touchAction: "none",
        }}
        title={open ? "Cerrar · arrastra para mover" : "Abrir · arrastra para mover"}
      >
        <Icon.More size={12} style={{ color: "var(--text-4)", opacity: 0.7 }} />
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 7,
            background: dueNowCount > 0
              ? "var(--accent-red-soft)"
              : dueSoonCount > 0
              ? "var(--accent-amber-soft)"
              : "var(--accent-cyan-soft)",
            color: dueNowCount > 0
              ? "var(--accent-red)"
              : dueSoonCount > 0
              ? "var(--accent-amber)"
              : "var(--accent-cyan)",
            fontSize: 11,
          }}
        >
          <Icon.Calendar size={12} />
        </span>
        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
          Tareas
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--text-3)" }}
        >
          {callbacks.length}
        </span>
        {dueNowCount > 0 && (
          <span
            className="chip chip--red"
            style={{ fontSize: 9.5, padding: "1px 6px", fontWeight: 700, height: 18 }}
            title="Follow-ups que necesitan tu acción ahora"
          >
            {dueNowCount} ahora
          </span>
        )}
        {dueSoonCount > 0 && (
          <span
            className="chip chip--amber"
            style={{ fontSize: 9.5, padding: "1px 6px", height: 18 }}
            title="Se disparan en menos de 5 min"
          >
            {dueSoonCount} pronto
          </span>
        )}
        {loading && (
          <span className="muted mono" style={{ fontSize: 9.5 }}>
            …
          </span>
        )}
        <span
          data-followups-toggle
          style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 10 }}
        >
          {open ? "▾" : "▴"}
        </span>
      </div>

      {open && (
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            padding: "4px 8px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            borderTop: "1px solid var(--border-1)",
          }}
        >
          {callbacks.length === 0 ? (
            <div
              style={{
                padding: "10px 14px",
                fontSize: 11.5,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No tienes tareas pendientes.
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
                    toast.success("Marcado como enviado");
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

export function FollowupRow({
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

  const isTask = ch === "task";
  // Una tarea es un to-do, no un cliente: si no tiene nombre, el "título" es la
  // nota, y ocultamos el teléfono sintético (task:...).
  const primaryLabel =
    sanitizeText(record.customerName) ||
    (isTask ? sanitizeText(record.notes) || "Tarea" : "Cliente");
  const syntheticPhone = !!record.phone && record.phone.startsWith("task:");
  const destination =
    ch === "email" && record.emailToAddress
      ? record.emailToAddress
      : syntheticPhone
      ? ""
      : record.phone;

  // Channel-specific detail line — subject for email, template for
  // whatsapp, falls back to notes for voice. Para una tarea sin nombre la
  // nota ya es el título → no la repetimos abajo.
  const detailText: string | null =
    ch === "email" && record.emailSubject
      ? sanitizeText(record.emailSubject)
      : ch === "whatsapp" && record.templateName
      ? `Template · ${record.templateName}`
      : isTask && !record.customerName
      ? null
      : record.notes
      ? sanitizeText(record.notes)
      : null;

  return (
    <div
      data-followups-noclick
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 8px",
        background: isDue
          ? "var(--accent-red-soft)"
          : countdown.urgent
          ? "var(--accent-amber-soft)"
          : "var(--bg-2)",
        border: isDue
          ? "1px solid var(--accent-red)"
          : countdown.urgent
          ? "1px solid var(--accent-amber)"
          : "1px solid var(--border-1)",
        borderRadius: 8,
        fontSize: 11.5,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 7,
          background: meta.bg,
          color: meta.color,
          flexShrink: 0,
          fontSize: 11,
          marginTop: 1,
        }}
        title={meta.label}
      >
        <meta.icon size={13} />
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* Line 1 — name · destination · countdown */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: destination ? 130 : 210,
              fontSize: 12,
            }}
            title={primaryLabel}
          >
            {primaryLabel}
          </span>
          {destination && (
            <span
              className="mono"
              style={{
                color: "var(--text-3)",
                fontSize: 10,
                overflow: "hidden",
                textOverflow: "ellipsis",
                flexShrink: 1,
                minWidth: 0,
              }}
              title={destination}
            >
              {destination}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: isDue
                ? "var(--accent-red)"
                : countdown.urgent
                ? "var(--accent-amber)"
                : countdown.past
                ? "var(--accent-red)"
                : "var(--text-3)",
              fontWeight: isDue || countdown.urgent ? 700 : 500,
              marginLeft: "auto",
              flexShrink: 0,
              letterSpacing: "0.02em",
            }}
            title={localTime}
          >
            {isDue ? "AHORA" : countdown.label}
          </span>
        </div>
        {/* Line 2 — detail (subject / template / notes) */}
        {detailText && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.35,
            }}
            title={detailText}
          >
            {ch === "email" ? (
              <Mail size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            ) : ch === "whatsapp" ? (
              <MessageCircle size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            ) : (
              <PenLine size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            )}
            {detailText}
          </div>
        )}
        {/* Line 3 — exact local time */}
        <div
          style={{
            fontSize: 9.5,
            color: "var(--text-4)",
            lineHeight: 1.3,
          }}
        >
          {localTime}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          flexShrink: 0,
          alignItems: "flex-end",
        }}
      >
        {isDue && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing || cancelling}
            className="btn btn--success btn--sm"
            style={{ fontSize: 10, padding: "2px 7px", height: 22 }}
            title="Marca como enviado"
          >
            {completing ? "…" : "Enviado"}
          </button>
        )}
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling || completing}
          className="btn btn--ghost btn--sm btn--icon"
          style={{ width: 22, height: 22 }}
          title="Cancelar follow-up"
          aria-label="Cancelar"
        >
          <Icon.Close size={11} />
        </button>
      </div>
    </div>
  );
}
