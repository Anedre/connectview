import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useCallbacks, type CallbackRecord } from "@/hooks/useCallbacks";
import { useConnections } from "@/hooks/useConnections";
import * as Icon from "@/components/vox/primitives";
import { colorFromName as avatarColor, initialsOf } from "@/components/vox/primitives";
import { NotIntegrated } from "@/components/vox/NotIntegrated";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { displayCustomerName } from "@/lib/customerName";

/**
 * Citas — Google-Calendar-styled scheduler. Unified with Follow-ups:
 * a Cita is a callback record (voice / WhatsApp / email / generic
 * task) scheduled to be executed at a future time. The agent sees the
 * same items in the Citas calendar view AND in the floating Follow-ups
 * widget on the Agent Desktop — single source of truth.
 *
 * Layout: [sidebar 256 | calendar 1fr]. Floating popovers for create
 * and detail (no persistent right inspector).
 *
 * Backend: listCallbacks / scheduleCallback / cancelCallback Lambdas
 * via the existing useCallbacks hook.
 */

type Channel = "voice" | "whatsapp" | "email" | "task";

/** Cita — projected from a CallbackRecord into the calendar's display
 *  shape. Same data, different field names. */
interface Appt {
  apptId: string;
  customerPhone: string;
  customerName?: string;
  title?: string;
  whenISO: string;
  durationMin?: number;
  agent?: string;
  notes?: string;
  status: string;
  channel: Channel;
  /** Original callback row — kept so the detail popover can render
   *  channel-specific extras (email subject, WhatsApp template, etc). */
  raw?: CallbackRecord;
}

const CHANNEL_META: Record<
  Channel,
  { label: string; color: string; soft: string; icon: typeof Icon.Phone }
> = {
  voice: {
    label: "Llamada",
    color: "var(--accent-green)",
    soft: "var(--accent-green-soft)",
    icon: Icon.Phone,
  },
  whatsapp: {
    label: "WhatsApp",
    color: "var(--accent-cyan)",
    soft: "var(--accent-cyan-soft)",
    icon: Icon.WhatsApp,
  },
  email: {
    label: "Email",
    color: "var(--accent-amber)",
    soft: "var(--accent-amber-soft)",
    icon: Icon.Mail,
  },
  task: {
    label: "Tarea",
    color: "var(--accent-violet)",
    soft: "var(--accent-violet-soft)",
    icon: Icon.Note,
  },
};
function channelMeta(c: Channel | string | undefined) {
  return CHANNEL_META[(c as Channel) || "voice"] || CHANNEL_META.voice;
}

/** A unified customer suggestion shown in the typeahead — sourced from
 *  either the search-customer-profiles Lambda or the list-recent-
 *  customers Lambda (which already enriches with profile names). */
interface CustomerSuggestion {
  profileId: string;
  displayName: string;
  phone?: string;
  email?: string;
  /** Where this row came from — used to show a small tag in the row. */
  source: "search" | "recent";
}

/** Map a callback row from the API into the calendar shape. */
function callbackToAppt(c: CallbackRecord): Appt {
  // Map back-end statuses → the same lowercase tokens the UI uses
  // (keeps the status filter chips + the EventDetailPopover untouched).
  const status: string = (() => {
    switch (c.status) {
      case "SCHEDULED": return "scheduled";
      case "DUE": return "scheduled"; // still pending, just due now
      case "RINGING": return "scheduled";
      case "COMPLETED": return "done";
      case "CANCELLED": return "cancelled";
      case "FAILED": return "no_show";
      default: return "scheduled";
    }
  })();
  return {
    apptId: c.callbackId,
    customerPhone: c.phone,
    customerName: c.customerName,
    title: c.title,
    whenISO: c.scheduledAt,
    // Display duration — back-end doesn't track this; default to 60.
    durationMin: c.durationMin || 60,
    agent: c.assignedAgentUserId,
    notes: c.notes,
    status,
    channel: (c.channel as Channel) || "voice",
    raw: c,
  };
}

function apptLabel(a: Appt) {
  return (
    a.title?.trim() ||
    a.customerName?.trim() ||
    a.customerPhone ||
    channelMeta(a.channel).label
  );
}

type View = "day" | "week" | "month";
type Preview = { dayIndex: number; startMin: number; endMin: number };
type DragOp =
  | {
      kind: "move";
      apptId: string;
      durationMin: number;
      grabOffsetMin: number;
      /** Original click position — used to anchor the detail popover
       *  when the user clicks (not drags) an existing event. */
      clientX: number;
      clientY: number;
    }
  | { kind: "resize"; apptId: string; startMin: number; dayIndex: number }
  | {
      kind: "create";
      dayIndex: number;
      anchorMin: number;
      /** Original click position — used to anchor the quick-create popover. */
      clientX: number;
      clientY: number;
    };
/** Pending appointment shown as a violet ghost on the grid while the
 *  quick-create popover is open. Mirrors what Google Calendar does. */
type Pending = {
  dayIndex: number;
  startMin: number;
  endMin: number;
  /** Viewport coords of the original click — anchors the popover. */
  anchorX: number;
  anchorY: number;
};

const STATUS_META: Record<
  string,
  { label: string; color: string; soft: string }
> = {
  scheduled: { label: "Agendadas", color: "var(--accent-cyan)", soft: "var(--accent-cyan-soft)" },
  done: { label: "Completadas", color: "var(--accent-green)", soft: "var(--accent-green-soft)" },
  cancelled: { label: "Canceladas", color: "var(--accent-red)", soft: "var(--accent-red-soft)" },
  no_show: { label: "No asistió", color: "var(--accent-amber)", soft: "var(--accent-amber-soft)" },
};
function statusMeta(s: string) {
  return STATUS_META[s] || { label: s, color: "var(--accent-violet)", soft: "var(--bg-3)" };
}

const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_PX = 48;
const SNAP = 15;
const GUTTER = 60;
const SMIN = START_HOUR * 60;
const EMIN = END_HOUR * 60;
const DAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAYS_MINI = ["D", "L", "M", "X", "J", "V", "S"];
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}
/** Sunday-first start for the MINI calendar (Google uses Sunday). */
function startOfWeekSun(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function hhmmMin(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function minutesOf(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function dateAtMin(day: Date, min: number) {
  const d = new Date(day);
  d.setHours(0, min, 0, 0);
  return d;
}

const STATUS_ORDER = ["scheduled", "done", "no_show", "cancelled"] as const;

export function AppointmentsPage() {
  const { user } = useAuth();
  // Load EVERYTHING the agent has scheduled — Citas page shows past +
  // future, completed + cancelled. The widget on Agent Desktop only
  // shows PENDING; we cast a wider net here so the cancelled / done
  // events still appear (greyed-out by the status filter).
  const {
    callbacks,
    loading,
    refetch: refetchCallbacks,
    cancel: cancelCallbackRow,
    complete: completeCallbackRow,
  } = useCallbacks({ limit: 200, pollIntervalSec: 60 });
  const appts = useMemo<Appt[]>(
    () => callbacks.map(callbackToAppt),
    [callbacks]
  );
  const { config } = useConnections();
  const { confirm, confirmDialog } = useConfirm();
  // Las citas persisten como callbacks en la base de datos del tenant (BYO Data
  // Plane). Sin ella, avisamos que falta integrar en vez de un calendario vacío.
  const dataPlaneEnabled = !!config?.connect?.dataPlaneEnabled;
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [now, setNow] = useState<Date>(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    () => new Set(STATUS_ORDER)
  );
  // Anchor for the mini calendar — independent from the main `anchor`
  // so the user can browse a different month in the mini without
  // changing the main grid.
  const [miniAnchor, setMiniAnchor] = useState<Date>(() => new Date());
  // Pending placeholder + popover anchor while the agent is filling in
  // a new appointment via the Google-style quick popover.
  const [pending, setPending] = useState<Pending | null>(null);
  // Anchor for the event-detail popover (saved appointment view).
  const [eventPopover, setEventPopover] = useState<{
    apptId: string;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setPending(null);
        setEventPopover(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = () => refetchCallbacks();

  // Status changes use the cancel-callback Lambda's `action` field
  // (which already supports "cancel" and "complete"). "done" maps to
  // complete (the agent attended the follow-up); "cancelled" maps to
  // cancel; "no_show" → cancel + flag as failed-by-agent (kept simple
  // as a cancel for now, the audit trail records who did it).
  const setStatus = async (apptId: string, status: string) => {
    try {
      if (status === "done") await completeCallbackRow(apptId);
      else if (status === "cancelled" || status === "no_show")
        await cancelCallbackRow(apptId);
      else return; // unknown status — no-op
      refetchCallbacks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    }
  };

  // Reschedule = create a new callback at the new time + cancel the
  // old one. The schedule-callback Lambda doesn't support in-place
  // update right now; this is the safest way to keep both calendars
  // (Citas + Follow-ups widget) in sync.
  const reschedule = async (apptId: string, whenISO: string, durationMin?: number) => {
    const cur = callbacks.find((c) => c.callbackId === apptId);
    if (!cur) return;
    const ep = getApiEndpoints();
    if (!ep?.scheduleCallback) return;
    try {
      const payload: Record<string, unknown> = {
        phone: cur.phone,
        customerName: cur.customerName,
        scheduledAt: whenISO,
        assignedAgentUserId: cur.assignedAgentUserId,
        notes: cur.notes,
        channel: cur.channel || "voice",
        title: cur.title,
        durationMin: durationMin || cur.durationMin || 60,
      };
      if (cur.channel === "email") {
        payload.emailToAddress = cur.emailToAddress;
        payload.emailSubject = cur.emailSubject;
        payload.emailBody = cur.emailBody;
        if (cur.emailFromAddress) payload.emailFromAddress = cur.emailFromAddress;
      }
      if (cur.channel === "whatsapp") {
        payload.templateName = cur.templateName;
        payload.templateLanguage = cur.templateLanguage;
        if (cur.templateVariables) {
          try {
            payload.templateVariables = JSON.parse(cur.templateVariables);
          } catch { /* keep undefined */ }
        }
      }
      const r = await fetch(ep.scheduleCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json())?.error || `HTTP ${r.status}`);
      // Cancel the original now that the replacement is queued.
      await cancelCallbackRow(apptId).catch(() => { /* best-effort */ });
      refetchCallbacks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reprogramar");
    }
  };

  // Title / notes / customerName updates — currently no dedicated
  // endpoint; we recreate the callback with the new fields (same flow
  // as reschedule). Lighter alternative: add an "update" action to the
  // cancel-callback Lambda later.
  const updateAppt = async (
    apptId: string,
    fields: Partial<Pick<Appt, "title" | "notes" | "customerName">>
  ) => {
    const cur = callbacks.find((c) => c.callbackId === apptId);
    if (!cur) return;
    const ep = getApiEndpoints();
    if (!ep?.scheduleCallback) return;
    try {
      const payload: Record<string, unknown> = {
        phone: cur.phone,
        customerName: fields.customerName ?? cur.customerName,
        scheduledAt: cur.scheduledAt,
        assignedAgentUserId: cur.assignedAgentUserId,
        notes: fields.notes ?? cur.notes,
        channel: cur.channel || "voice",
        title: fields.title ?? cur.title,
        durationMin: cur.durationMin || 60,
      };
      const r = await fetch(ep.scheduleCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json())?.error || `HTTP ${r.status}`);
      await cancelCallbackRow(apptId).catch(() => { /* best-effort */ });
      refetchCallbacks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    }
  };

  const del = async (apptId: string) => {
    if (!(await confirm({ title: "¿Eliminar esta cita?", destructive: true, confirmLabel: "Eliminar" }))) return;
    try {
      await cancelCallbackRow(apptId);
      setSelectedId(null);
      refetchCallbacks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  };

  const { days, title } = useMemo(() => {
    if (view === "day")
      return {
        days: [startOfDay(anchor)],
        title: anchor.toLocaleDateString("es-PE", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      };
    if (view === "week") {
      const s = startOfWeek(anchor);
      const ds = Array.from({ length: 7 }, (_, i) => addDays(s, i));
      const e = ds[6];
      const t =
        s.getMonth() === e.getMonth()
          ? `${MONTHS_ES[s.getMonth()]} ${e.getFullYear()}`
          : `${MONTHS_ES[s.getMonth()].slice(0, 3)} – ${MONTHS_ES[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
      return { days: ds, title: t };
    }
    const gridStart = startOfWeek(startOfMonth(anchor));
    return {
      days: Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
      title: `${MONTHS_ES[anchor.getMonth()]} ${anchor.getFullYear()}`,
    };
  }, [view, anchor]);

  // Apply the sidebar status filter — the calendar/agenda use the
  // FILTERED list; cards in the inspector use the raw list since they
  // need to render even disabled-status events.
  const visibleAppts = useMemo(
    () => appts.filter((a) => activeStatuses.has(a.status)),
    [appts, activeStatuses]
  );

  const apptsForDay = (d: Date) =>
    visibleAppts
      .filter((a) => sameDay(new Date(a.whenISO), d))
      .sort((a, b) => a.whenISO.localeCompare(b.whenISO));

  const go = (dir: -1 | 1) =>
    setAnchor((a) =>
      view === "day"
        ? addDays(a, dir)
        : view === "week"
        ? addDays(a, dir * 7)
        : new Date(a.getFullYear(), a.getMonth() + dir, 1)
    );

  /** Open the Google-style quick-create popover at the click anchor.
   *  Sets `pending` which both renders the violet ghost on the grid
   *  AND positions the popover. */
  const openPopover = (p: Pending) => {
    setSelectedId(null);
    setPending(p);
    setEventPopover(null);
  };

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    []
  );
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  const upcomingCount = appts.filter(
    (a) => a.status === "scheduled" && new Date(a.whenISO) >= startOfDay(now)
  ).length;

  // Per-status counts for the sidebar filter chips.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of appts) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [appts]);

  const toggleStatus = (s: string) => {
    setActiveStatuses((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const pointToSlot = (
    clientX: number,
    clientY: number
  ): { dayIndex: number; minutes: number } | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const colW = (rect.width - GUTTER) / days.length;
    const dayIndex = clamp(
      Math.floor((clientX - rect.left - GUTTER) / colW),
      0,
      days.length - 1
    );
    let minutes = SMIN + ((clientY - rect.top) / HOUR_PX) * 60;
    minutes = clamp(Math.round(minutes / SNAP) * SNAP, SMIN, EMIN);
    return { dayIndex, minutes };
  };

  const beginDrag = (op: DragOp) => {
    let moved = false;
    let pv: Preview | null = null;
    const onMove = (e: PointerEvent) => {
      const p = pointToSlot(e.clientX, e.clientY);
      if (!p) return;
      moved = true;
      if (op.kind === "move") {
        const s = clamp(p.minutes - op.grabOffsetMin, SMIN, EMIN - op.durationMin);
        pv = { dayIndex: p.dayIndex, startMin: s, endMin: s + op.durationMin };
      } else if (op.kind === "resize") {
        const end = clamp(Math.max(op.startMin + SNAP, p.minutes), op.startMin + SNAP, EMIN);
        pv = { dayIndex: op.dayIndex, startMin: op.startMin, endMin: end };
      } else {
        const lo = Math.min(op.anchorMin, p.minutes);
        const hi = Math.max(op.anchorMin, p.minutes);
        pv = { dayIndex: op.dayIndex, startMin: lo, endMin: Math.max(hi, lo + SNAP) };
      }
      setPreview(pv);
    };
    const onUp = (upEvent?: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPreview(null);
      if (!moved) {
        if (op.kind === "create") {
          // Single click → 30-minute slot at the click position.
          const startMin = op.anchorMin;
          openPopover({
            dayIndex: op.dayIndex,
            startMin,
            endMin: Math.min(EMIN, startMin + 60),
            anchorX: op.clientX,
            anchorY: op.clientY,
          });
        } else if (op.kind === "move") {
          // Click on an existing event → open the floating detail
          // popover anchored next to the click + highlight the block.
          setEventPopover({
            apptId: op.apptId,
            anchorX: op.clientX,
            anchorY: op.clientY,
          });
          setSelectedId(op.apptId);
          setPending(null);
        }
        return;
      }
      if (!pv) return;
      if (op.kind === "create") {
        // Use the up-event coords (or the last drag point) as the anchor.
        openPopover({
          dayIndex: pv.dayIndex,
          startMin: pv.startMin,
          endMin: pv.endMin,
          anchorX: upEvent?.clientX ?? op.clientX,
          anchorY: upEvent?.clientY ?? op.clientY,
        });
      } else if (op.kind === "resize")
        reschedule(
          op.apptId,
          dateAtMin(days[pv.dayIndex], pv.startMin).toISOString(),
          Math.max(SNAP, pv.endMin - pv.startMin)
        );
      else
        reschedule(
          op.apptId,
          dateAtMin(days[pv.dayIndex], pv.startMin).toISOString(),
          op.durationMin
        );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** Open the quick-create popover anchored to the + Crear button
   *  (or the screen center if the button rect isn't available). Pre-
   *  fills the slot at the user's current local time, rounded down to
   *  the nearest 15 min and clamped within the visible day. */
  const startNewNow = (anchorEl?: HTMLElement | null) => {
    const startHour = clamp(now.getHours(), START_HOUR, END_HOUR - 1);
    const startMinute = Math.floor(now.getMinutes() / SNAP) * SNAP;
    const startMin = startHour * 60 + startMinute;
    // Try to find today's column in the current view; fall back to col 0.
    const dayIdx = days.findIndex((d) => sameDay(d, now));
    const rect = anchorEl?.getBoundingClientRect();
    const anchorX = rect
      ? rect.right
      : Math.floor(window.innerWidth / 2);
    const anchorY = rect
      ? rect.top + rect.height / 2
      : Math.floor(window.innerHeight / 2);
    openPopover({
      dayIndex: dayIdx >= 0 ? dayIdx : 0,
      startMin,
      endMin: Math.min(EMIN, startMin + 60),
      anchorX,
      anchorY,
    });
  };

  return (
    <>
    {!loading && appts.length === 0 && !dataPlaneEnabled && (
      <div style={{ padding: "14px 22px 0" }}>
        <NotIntegrated
          title="Todavía no integraste tu base de datos"
          message="Tus citas y seguimientos se guardan en TU cuenta AWS (BYO Data Plane). Activala en Integraciones para agendar y ver tu calendario con datos."
          ctaLabel="Conectar base de datos"
        />
      </div>
    )}
    <div className={`gcal${sidebarOpen ? "" : " gcal--sidebar-hidden"}`}>
      {/* ───────── SIDEBAR ───────── */}
      {sidebarOpen && (
        <aside className="gcal__sidebar">
          <div className="gcal__sidebar-inner">
            <button
              className="gcal__create"
              onClick={(e) => startNewNow(e.currentTarget)}
            >
              <span className="gcal__create-icon">
                <Icon.Plus size={14} />
              </span>
              Crear
            </button>

            <MiniMonth
              anchor={miniAnchor}
              selected={anchor}
              today={now}
              appts={visibleAppts}
              onPrev={() => setMiniAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
              onNext={() => setMiniAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
              onPick={(d) => {
                setAnchor(d);
                if (view === "month") setMiniAnchor(d);
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="gcal__section-title">Mis filtros</div>
              {STATUS_ORDER.map((s) => {
                const meta = statusMeta(s);
                const on = activeStatuses.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    className={`gcal__check${on ? " gcal__check--on" : ""}`}
                    onClick={() => toggleStatus(s)}
                    style={{ ["--gc" as string]: meta.color }}
                  >
                    <span className="gcal__check-box">
                      <Icon.Check size={10} />
                    </span>
                    <span className="gcal__check-label">{meta.label}</span>
                    <span className="gcal__check-count">{statusCounts[s] || 0}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="gcal__section-title">Próximamente</div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--text-3)",
                  lineHeight: 1.5,
                  padding: "0 4px",
                }}
              >
                {upcomingCount > 0 ? (
                  <>
                    Tienes <b style={{ color: "var(--accent-cyan)" }}>{upcomingCount}</b> cita
                    {upcomingCount === 1 ? "" : "s"} agendada{upcomingCount === 1 ? "" : "s"}.
                  </>
                ) : (
                  "No tienes citas próximas."
                )}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* ───────── MAIN ───────── */}
      <div className="gcal__main">
        {/* TOPBAR */}
        <div className="gcal__bar">
          <button
            type="button"
            className="gcal__bar-sidetoggle"
            onClick={() => setSidebarOpen((s) => !s)}
            title={sidebarOpen ? "Ocultar menú" : "Mostrar menú"}
            aria-label="Menú lateral"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <button
            type="button"
            className="gcal__bar-today"
            onClick={() => {
              setAnchor(new Date());
              setMiniAnchor(new Date());
            }}
          >
            Hoy
          </button>
          <button
            type="button"
            className="gcal__bar-arrow"
            onClick={() => go(-1)}
            title="Anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="gcal__bar-arrow"
            onClick={() => go(1)}
            title="Siguiente"
          >
            ›
          </button>
          <span className="gcal__bar-title">{title}</span>
          <div className="gcal__bar-spacer" />
          <span className="gcal__bar-count">{upcomingCount} próximas</span>
          <button
            type="button"
            className="gcal__bar-iconbtn"
            onClick={load}
            disabled={loading}
            title="Recargar"
          >
            <Icon.Refresh size={16} />
          </button>
          <div className="gcal__bar-view" role="tablist">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={`gcal__bar-view-opt${view === v ? " gcal__bar-view-opt--active" : ""}`}
                onClick={() => setView(v)}
              >
                {v === "day" ? "Día" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>

        {/* PANE — calendar only. Popovers are the single surface for
            create / detail (no persistent right inspector). */}
        <div className="gcal__pane gcal__pane--no-inspector">
          <div className="gcal__calendar">
            {view === "month" ? (
              <MonthView
                days={days}
                anchor={anchor}
                now={now}
                apptsForDay={apptsForDay}
                selectedId={selectedId}
                onSelectAt={(apptId, x, y) => {
                  setEventPopover({ apptId, anchorX: x, anchorY: y });
                  setSelectedId(apptId);
                }}
                onCreateAt={(d, x, y) => {
                  openPopover({
                    dayIndex: days.indexOf(d),
                    startMin: 9 * 60,
                    endMin: 10 * 60,
                    anchorX: x,
                    anchorY: y,
                  });
                }}
              />
            ) : (
              <WeekView
                days={days}
                hours={hours}
                gridHeight={gridHeight}
                now={now}
                apptsForDay={apptsForDay}
                selectedId={selectedId}
                preview={preview}
                pending={pending}
                gridRef={gridRef}
                beginDrag={beginDrag}
                pointToSlot={pointToSlot}
              />
            )}
          </div>
        </div>
      </div>

      {/* Quick-create popover — anchored to the click position */}
      {pending && (
        <QuickCreatePopover
          pending={pending}
          day={days[pending.dayIndex]}
          defaultAgent={user?.username}
          defaultAgentUserId={user?.userId}
          onClose={() => setPending(null)}
          onBooked={() => {
            setPending(null);
            load();
          }}
        />
      )}

      {/* Event-detail popover — anchored to an existing event */}
      {eventPopover && (() => {
        const appt = appts.find((a) => a.apptId === eventPopover.apptId);
        if (!appt) return null;
        return (
          <EventDetailPopover
            appt={appt}
            anchorX={eventPopover.anchorX}
            anchorY={eventPopover.anchorY}
            onClose={() => {
              setEventPopover(null);
              setSelectedId(null);
            }}
            onStatus={setStatus}
            onUpdate={updateAppt}
            onReschedule={reschedule}
            onDelete={del}
          />
        );
      })()}
    </div>
    {confirmDialog}
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   MINI MONTH calendar (left sidebar). Sunday-first like Google.
   Clicking a day jumps the main view to that date.
   ──────────────────────────────────────────────────────────── */
function MiniMonth({
  anchor,
  selected,
  today,
  appts,
  onPrev,
  onNext,
  onPick,
}: {
  anchor: Date;
  selected: Date;
  today: Date;
  appts: Appt[];
  onPrev: () => void;
  onNext: () => void;
  onPick: (d: Date) => void;
}) {
  const gridStart = useMemo(() => startOfWeekSun(startOfMonth(anchor)), [anchor]);
  const cells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    [gridStart]
  );
  // For each visible cell, mark a dot when at least one appointment
  // exists that day — gives the agent at-a-glance density.
  const hasAppt = useMemo(() => {
    const set = new Set<string>();
    for (const a of appts) {
      const d = new Date(a.whenISO);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  }, [appts]);

  return (
    <div className="gcal__mini">
      <div className="gcal__mini-bar">
        <span>
          {MONTHS_ES[anchor.getMonth()][0].toUpperCase()}
          {MONTHS_ES[anchor.getMonth()].slice(1)} {anchor.getFullYear()}
        </span>
        <div className="gcal__mini-nav">
          <button type="button" onClick={onPrev} aria-label="Mes anterior">
            ‹
          </button>
          <button type="button" onClick={onNext} aria-label="Mes siguiente">
            ›
          </button>
        </div>
      </div>
      <div className="gcal__mini-grid">
        {DAYS_MINI.map((d) => (
          <span key={d} className="gcal__mini-dow">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const isSelected = sameDay(d, selected);
          const has = hasAppt.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              className={[
                "gcal__mini-day",
                !inMonth && "gcal__mini-day--out",
                isToday && "gcal__mini-day--today",
                !isToday && isSelected && "gcal__mini-day--selected",
                has && "gcal__mini-day--has",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   WEEK / DAY VIEW
   ──────────────────────────────────────────────────────────── */
function WeekView({
  days,
  hours,
  gridHeight,
  now,
  apptsForDay,
  selectedId,
  preview,
  pending,
  gridRef,
  beginDrag,
  pointToSlot,
}: {
  days: Date[];
  hours: number[];
  gridHeight: number;
  now: Date;
  apptsForDay: (d: Date) => Appt[];
  selectedId: string | null;
  preview: Preview | null;
  pending: Pending | null;
  gridRef: React.RefObject<HTMLDivElement | null>;
  beginDrag: (op: DragOp) => void;
  pointToSlot: (x: number, y: number) => { dayIndex: number; minutes: number } | null;
}) {
  // GMT label uses the user's timezone offset hours, signed.
  const gmtLabel = useMemo(() => {
    const off = -new Date().getTimezoneOffset() / 60;
    return `GMT${off >= 0 ? "+" : ""}${off}`;
  }, []);
  const gridTemplate = `${GUTTER}px repeat(${days.length}, 1fr)`;

  return (
    <>
      {/* Day header row */}
      <div className="gcal__weekhead" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="gcal__weekhead-gutter">{gmtLabel}</div>
        {days.map((d, i) => {
          const today = sameDay(d, now);
          return (
            <div
              key={i}
              className={`gcal__weekhead-day${today ? " gcal__weekhead-day--today" : ""}`}
            >
              <span className="gcal__weekhead-dow">
                {DAYS_ES[(d.getDay() + 6) % 7]}
              </span>
              <span className="gcal__weekhead-dnum">{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      {/* Scrollable hour grid */}
      <div className="gcal__weekbody">
        <div
          className="gcal__weekgrid"
          ref={gridRef}
          style={{ gridTemplateColumns: gridTemplate, height: gridHeight }}
        >
          <div className="gcal__gutter">
            {hours.map((h) => (
              <div key={h} className="gcal__gutter-h" style={{ height: HOUR_PX }}>
                {h === START_HOUR ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d, di) => {
            const today = sameDay(d, now);
            const nowTop = (now.getHours() + now.getMinutes() / 60 - START_HOUR) * HOUR_PX;
            const showNow = today && now.getHours() >= START_HOUR && now.getHours() < END_HOUR;
            const weekendIdx = (d.getDay() + 6) % 7;
            const isWeekend = weekendIdx === 5 || weekendIdx === 6;
            return (
              <div
                key={di}
                className={`gcal__col${isWeekend ? " gcal__col--weekend" : ""}`}
              >
                {hours.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="gcal__slot"
                    style={{ height: HOUR_PX }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const p = pointToSlot(e.clientX, e.clientY);
                      if (p)
                        beginDrag({
                          kind: "create",
                          dayIndex: p.dayIndex,
                          anchorMin: p.minutes,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                    }}
                  />
                ))}
                {showNow && (
                  <div className="gcal__now" style={{ top: nowTop }}>
                    <span className="gcal__now-dot" />
                  </div>
                )}
                {preview && preview.dayIndex === di && (
                  <div
                    className="gcal__ghost"
                    style={{
                      top: ((preview.startMin - SMIN) / 60) * HOUR_PX,
                      height: Math.max(
                        16,
                        ((preview.endMin - preview.startMin) / 60) * HOUR_PX
                      ),
                    }}
                  >
                    {hhmmMin(preview.startMin)}–{hhmmMin(preview.endMin)}
                  </div>
                )}
                {pending && pending.dayIndex === di && (
                  <div
                    className="gcal__pending"
                    style={{
                      top: ((pending.startMin - SMIN) / 60) * HOUR_PX,
                      height: Math.max(
                        24,
                        ((pending.endMin - pending.startMin) / 60) * HOUR_PX
                      ),
                    }}
                  >
                    <span className="gcal__pending-title">(Sin título)</span>
                    <span className="gcal__pending-time">
                      {hhmmMin(pending.startMin)}–{hhmmMin(pending.endMin)}
                    </span>
                  </div>
                )}
                {apptsForDay(d).map((a) => {
                  const s = new Date(a.whenISO);
                  const startMin = minutesOf(a.whenISO);
                  const top = ((startMin - SMIN) / 60) * HOUR_PX;
                  const h = Math.max(24, ((a.durationMin || 30) / 60) * HOUR_PX);
                  if (top < -HOUR_PX || top > gridHeight) return null;
                  const m = statusMeta(a.status);
                  const cm = channelMeta(a.channel);
                  const ChIcon = cm.icon;
                  const sel = selectedId === a.apptId;
                  const compact = h < 40;
                  return (
                    <div
                      key={a.apptId}
                      className={`gcal__ev${compact ? " gcal__ev--compact" : ""}${
                        sel ? " gcal__ev--selected" : ""
                      }`}
                      style={
                        {
                          top: Math.max(0, top),
                          height: h,
                          "--ev-soft": m.soft,
                          "--ev-color": m.color,
                        } as React.CSSProperties
                      }
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const p = pointToSlot(e.clientX, e.clientY);
                        beginDrag({
                          kind: "move",
                          apptId: a.apptId,
                          durationMin: a.durationMin || 30,
                          grabOffsetMin: p ? p.minutes - startMin : 0,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                      }}
                    >
                      {compact ? (
                        <span className="gcal__ev-oneline">
                          <ChIcon size={10} style={{ color: cm.color, flexShrink: 0 }} />
                          <b>{hhmm(s)}</b>
                          {apptLabel(a)}
                        </span>
                      ) : (
                        <>
                          <span
                            className="gcal__ev-time"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <ChIcon size={11} style={{ color: cm.color, flexShrink: 0 }} />
                            {hhmm(s)}
                          </span>
                          <span className="gcal__ev-name">{apptLabel(a)}</span>
                          {a.title?.trim() && (a.customerName || a.customerPhone) && (
                            <span className="gcal__ev-sub">
                              {a.customerName || a.customerPhone}
                            </span>
                          )}
                        </>
                      )}
                      <div
                        className="gcal__ev-resize"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          beginDrag({
                            kind: "resize",
                            apptId: a.apptId,
                            startMin,
                            dayIndex: di,
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="gcal__hint">
        Arrastra para mover · estira el borde inferior para la duración · arrastra en un hueco para crear
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   MONTH VIEW
   ──────────────────────────────────────────────────────────── */
function MonthView({
  days,
  anchor,
  now,
  apptsForDay,
  selectedId,
  onSelectAt,
  onCreateAt,
}: {
  days: Date[];
  anchor: Date;
  now: Date;
  apptsForDay: (d: Date) => Appt[];
  selectedId: string | null;
  onSelectAt: (id: string, anchorX: number, anchorY: number) => void;
  onCreateAt: (d: Date, anchorX: number, anchorY: number) => void;
}) {
  return (
    <div className="gcal__month">
      <div className="gcal__month-head">
        {DAYS_ES.map((d) => (
          <div key={d} className="gcal__month-hd">
            {d}
          </div>
        ))}
      </div>
      <div className="gcal__month-grid">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, now);
          const list = apptsForDay(d);
          return (
            <div
              key={i}
              className={[
                "gcal__month-cell",
                !inMonth && "gcal__month-cell--out",
                today && "gcal__month-cell--today",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={(e) => onCreateAt(d, e.clientX, e.clientY)}
            >
              <div className="gcal__month-date">{d.getDate()}</div>
              <div className="gcal__month-items">
                {list.slice(0, 4).map((a) => {
                  const m = statusMeta(a.status);
                  return (
                    <div
                      key={a.apptId}
                      className="gcal__month-chip"
                      style={
                        {
                          "--ev-soft": m.soft,
                          "--ev-color": m.color,
                          outline:
                            selectedId === a.apptId
                              ? `1px solid ${m.color}`
                              : undefined,
                        } as React.CSSProperties
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAt(a.apptId, e.clientX, e.clientY);
                      }}
                    >
                      <span className="gcal__month-chip__dot" />
                      <span className="gcal__month-chip__time">
                        {hhmm(new Date(a.whenISO))}
                      </span>
                      {apptLabel(a)}
                    </div>
                  );
                })}
                {list.length > 4 && (
                  <div className="gcal__month-more">+{list.length - 4} más</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   EVENT DETAIL POPOVER — Google-Calendar-style floating card for a
   saved appointment. Action icons in the header (edit/delete/call/
   whatsapp/more/close), title with status dot, date/time, reminder,
   agent. Closes on outside click or Esc.
   ──────────────────────────────────────────────────────────── */
function EventDetailPopover({
  appt,
  anchorX,
  anchorY,
  onClose,
  onStatus,
  onUpdate,
  onReschedule,
  onDelete,
}: {
  appt: Appt;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
  onStatus: (id: string, s: string) => void;
  onUpdate: (
    id: string,
    fields: Partial<Pick<Appt, "title" | "notes" | "customerName">>
  ) => void;
  onReschedule: (id: string, whenISO: string, durationMin?: number) => void;
  onDelete: (id: string) => void;
}) {
  const m = statusMeta(appt.status);
  const when = new Date(appt.whenISO);
  const digits = (appt.customerPhone || "").replace(/\D/g, "");
  const [titleEdit, setTitleEdit] = useState(false);
  const [title2, setTitle2] = useState(appt.title || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click closes (small delay so the click that opened it
  // doesn't immediately close it again).
  useEffect(() => {
    const id = setTimeout(() => {
      const onDown = (e: MouseEvent) => {
        if (popRef.current && !popRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      window.addEventListener("mousedown", onDown);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__gcalEvOff = () =>
        window.removeEventListener("mousedown", onDown);
    }, 120);
    return () => {
      clearTimeout(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__gcalEvOff?.();
    };
  }, [onClose]);

  // Close the inner status menu on outside click within the popover.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Position to the right of the click; flip if overflow.
  const popStyle = useMemo<React.CSSProperties>(() => {
    const W = 392;
    const H_EST = 360;
    const margin = 12;
    let left = anchorX + 18;
    if (left + W > window.innerWidth - margin) {
      left = anchorX - W - 18;
    }
    left = Math.max(margin, Math.min(window.innerWidth - W - margin, left));
    let top = anchorY - 90;
    top = Math.max(70, Math.min(window.innerHeight - H_EST - margin, top));
    return { top, left };
  }, [anchorX, anchorY]);

  const dayLabel = when.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const endTime = new Date(when.getTime() + (appt.durationMin || 30) * 60_000);

  const saveTitle = () => {
    setTitleEdit(false);
    const v = title2.trim();
    if (v !== (appt.title || "")) {
      onUpdate(appt.apptId, { title: v });
      if (v) toast.success("Asunto actualizado");
    }
  };

  return (
    <div
      ref={popRef}
      className="gcal-evpop"
      style={popStyle}
      role="dialog"
      aria-label="Detalle de la cita"
    >
      {/* Action header */}
      <div className="gcal-evpop__head">
        <button
          type="button"
          className="gcal-evpop__act"
          onClick={() => {
            setTitle2(appt.title || "");
            setTitleEdit(true);
          }}
          title="Editar asunto"
        >
          <Icon.Pencil size={14} />
        </button>
        <button
          type="button"
          className="gcal-evpop__act gcal-evpop__act--danger"
          onClick={() => {
            onDelete(appt.apptId);
            onClose();
          }}
          title="Eliminar"
        >
          <Icon.Trash size={14} />
        </button>
        {digits && (
          <a
            className="gcal-evpop__act"
            href={`tel:${digits}`}
            title="Llamar al cliente"
          >
            <Icon.Phone size={14} />
          </a>
        )}
        {digits && (
          <a
            className="gcal-evpop__act"
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noreferrer"
            title="Abrir WhatsApp"
          >
            <Icon.WhatsApp size={14} />
          </a>
        )}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="gcal-evpop__act"
            onClick={() => setMenuOpen((v) => !v)}
            title="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Icon.More size={15} />
          </button>
          {menuOpen && (
            <div className="gcal-evpop__menu" role="menu">
              {appt.status === "scheduled" && (
                <>
                  <button
                    type="button"
                    className="gcal-evpop__menu-item"
                    onClick={() => {
                      onStatus(appt.apptId, "done");
                      setMenuOpen(false);
                      toast.success("Cita marcada como hecha");
                    }}
                  >
                    <Icon.Check
                      size={13}
                      style={{ color: "var(--accent-green)" }}
                    />
                    Marcar hecha
                  </button>
                  <button
                    type="button"
                    className="gcal-evpop__menu-item"
                    onClick={() => {
                      onStatus(appt.apptId, "no_show");
                      setMenuOpen(false);
                    }}
                  >
                    <Icon.Close
                      size={13}
                      style={{ color: "var(--accent-amber)" }}
                    />
                    No asistió
                  </button>
                  <button
                    type="button"
                    className="gcal-evpop__menu-item"
                    onClick={() => {
                      onStatus(appt.apptId, "cancelled");
                      setMenuOpen(false);
                    }}
                  >
                    <Icon.Close
                      size={13}
                      style={{ color: "var(--accent-red)" }}
                    />
                    Cancelar cita
                  </button>
                </>
              )}
              {appt.status !== "scheduled" && (
                <button
                  type="button"
                  className="gcal-evpop__menu-item"
                  onClick={() => {
                    onStatus(appt.apptId, "scheduled");
                    setMenuOpen(false);
                    toast.success("Cita reabierta");
                  }}
                >
                  <Icon.Refresh size={13} />
                  Reabrir
                </button>
              )}
              <button
                type="button"
                className="gcal-evpop__menu-item"
                onClick={() => {
                  // Quick-reschedule to "+1 day same time".
                  const next = new Date(when);
                  next.setDate(next.getDate() + 1);
                  onReschedule(appt.apptId, next.toISOString(), appt.durationMin);
                  setMenuOpen(false);
                  toast.success("Reprogramada a mañana");
                }}
              >
                <Icon.Calendar size={13} />
                Reprogramar +1 día
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="gcal-evpop__act"
          onClick={onClose}
          title="Cerrar"
          aria-label="Cerrar"
        >
          <Icon.Close size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="gcal-evpop__body">
        <div className="gcal-evpop__title-row">
          {(() => {
            const ch = channelMeta(appt.channel);
            const ChIcn = ch.icon;
            return (
              <span
                className="gcal-evpop__dot"
                style={{
                  background: ch.color,
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  color: "white",
                  marginTop: 0,
                }}
                title={ch.label}
              >
                <ChIcn size={13} />
              </span>
            );
          })()}
          <div className="gcal-evpop__title-wrap">
            {titleEdit ? (
              <input
                autoFocus
                className="gcal-evpop__title-input"
                value={title2}
                onChange={(e) => setTitle2(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setTitle2(appt.title || "");
                    setTitleEdit(false);
                  }
                }}
                placeholder="Añade un título"
              />
            ) : (
              <div
                className="gcal-evpop__title"
                onClick={() => {
                  setTitle2(appt.title || "");
                  setTitleEdit(true);
                }}
                title="Clic para editar"
                style={{ cursor: "text" }}
              >
                {appt.title?.trim() ? (
                  appt.title
                ) : (
                  <span
                    style={{
                      color: "var(--text-3)",
                      fontStyle: "italic",
                      fontWeight: 400,
                    }}
                  >
                    (Sin título)
                  </span>
                )}
              </div>
            )}
            <div className="gcal-evpop__when">
              {dayLabel} · {hhmm(when)} – {hhmm(endTime)}
            </div>
          </div>
        </div>

        {/* Status chip */}
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <span
            className="gcal-evpop__chip"
            style={{ background: m.soft, color: m.color }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: m.color,
              }}
            />
            {m.label.replace(/s$/, "")}
          </span>
        </div>

        {/* Customer (name + phone) */}
        <div className="gcal-evpop__row">
          <span className="gcal-evpop__row-icon">
            <Icon.User size={14} />
          </span>
          <div className="gcal-evpop__row-text" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontWeight: 500 }}>
              {appt.customerName || appt.customerPhone}
            </span>
            {appt.customerName && appt.customerPhone && (
              <span
                className="mono"
                style={{ color: "var(--text-3)", fontSize: 11.5 }}
              >
                {appt.customerPhone}
              </span>
            )}
          </div>
        </div>

        {/* Duration as a reminder line, Google-style */}
        <div className="gcal-evpop__row">
          <span className="gcal-evpop__row-icon">
            <Icon.Clock size={14} />
          </span>
          <span className="gcal-evpop__row-text">
            Duración · {appt.durationMin || 30} min
          </span>
        </div>

        {/* Notes (when set) */}
        {appt.notes && (
          <div className="gcal-evpop__row" style={{ alignItems: "flex-start" }}>
            <span className="gcal-evpop__row-icon" style={{ marginTop: 1 }}>
              <Icon.Note size={14} />
            </span>
            <span
              className="gcal-evpop__row-text"
              style={{
                whiteSpace: "normal",
                color: "var(--text-2)",
                lineHeight: 1.5,
              }}
            >
              {appt.notes}
            </span>
          </div>
        )}

        {/* Agent */}
        <div className="gcal-evpop__row">
          <span className="gcal-evpop__row-icon">
            <Icon.Calendar size={14} />
          </span>
          <span
            className="gcal-evpop__row-text"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: m.color,
                flexShrink: 0,
              }}
            />
            {appt.agent || "Sin asignar"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   QUICK CREATE POPOVER — Google-Calendar-style floating form
   Anchored to the user's click position.
   ──────────────────────────────────────────────────────────── */
function QuickCreatePopover({
  pending,
  day,
  defaultAgent,
  defaultAgentUserId,
  onClose,
  onBooked,
}: {
  pending: Pending;
  day: Date;
  /** Display label of the agent (username). */
  defaultAgent?: string;
  /** Connect user-id of the agent — sent to the callback API. */
  defaultAgentUserId?: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const startDate = useMemo(() => dateAtMin(day, pending.startMin), [day, pending.startMin]);
  const endDate = useMemo(() => dateAtMin(day, pending.endMin), [day, pending.endMin]);
  const [channel, setChannel] = useState<Channel>("voice");
  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [startTime, setStartTime] = useState(hhmm(startDate));
  const [endTime, setEndTime] = useState(hhmm(endDate));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Lead / Customer Profile autocomplete state
  const [customerSuggestions, setCustomerSuggestions] = useState<
    CustomerSuggestion[]
  >([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const recentsLoaded = useRef(false);
  const popRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the title input when the popover opens — matches Google.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Lazily load the "recent customers" pool the first time the agent
  // focuses the name field — so even with no typed text the dropdown
  // gives them something useful (their last 12 attended customers).
  // The pool stays cached for the lifetime of the popover.
  const [recentsPool, setRecentsPool] = useState<CustomerSuggestion[]>([]);
  const loadRecents = async () => {
    if (recentsLoaded.current) return;
    recentsLoaded.current = true;
    const ep = getApiEndpoints();
    const me = defaultAgent;
    if (!ep?.listRecentCustomers || !me) return;
    try {
      const r = await fetch(
        `${ep.listRecentCustomers}?agentUsername=${encodeURIComponent(me)}&limit=20`
      );
      const j = await r.json();
      const items = Array.isArray(j.items) ? j.items : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: CustomerSuggestion[] = items.map((it: any) => {
        const phoneIsEmail = it.customerPhone?.includes("@");
        return {
          profileId: it.customerPhone,
          displayName: displayCustomerName(
            {
              firstName: it.firstName,
              lastName: it.lastName,
              businessName: it.businessName,
              email: it.email || (phoneIsEmail ? it.customerPhone : undefined),
              phoneNumber: phoneIsEmail ? undefined : it.customerPhone,
            },
            it.customerPhone
          ),
          phone: phoneIsEmail ? undefined : it.customerPhone,
          email: it.email || (phoneIsEmail ? it.customerPhone : undefined),
          source: "recent",
        };
      });
      setRecentsPool(mapped);
    } catch {
      /* swallow — recents are nice-to-have */
    }
  };

  // Debounced search-as-you-type against searchCustomerProfiles. We
  // KEEP the recents pool side-by-side so client-side filtering can
  // fall back to it when the server returns no exact-match hits.
  const handleNameChange = (v: string) => {
    setCustomerName(v);
    setPickedProfileId(null); // typing again invalidates the picked profile
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    const trimmed = v.trim();
    setSuggestionsOpen(true);
    if (trimmed.length < 2) {
      loadRecents();
      setCustomerSuggestions([]);
      return;
    }
    nameDebounceRef.current = setTimeout(async () => {
      const ep = getApiEndpoints();
      if (!ep?.searchCustomerProfiles) return;
      try {
        const r = await fetch(
          `${ep.searchCustomerProfiles}?q=${encodeURIComponent(trimmed)}`
        );
        const j = await r.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: CustomerSuggestion[] = (j.results || []).map((s: any) => ({
          profileId: s.profileId,
          displayName: displayCustomerName(
            {
              firstName: s.firstName,
              lastName: s.lastName,
              businessName: s.businessName,
              email: s.email,
              phoneNumber: s.phoneNumber,
            },
            "(sin nombre)"
          ),
          phone: s.phoneNumber,
          email: s.email,
          source: "search",
        }));
        setCustomerSuggestions(mapped);
      } catch {
        setCustomerSuggestions([]);
      }
    }, 250);
  };

  /** What actually renders in the dropdown — merge server hits with
   *  recents-pool client-filtered by the current text. */
  const visibleSuggestions = useMemo<CustomerSuggestion[]>(() => {
    const q = customerName.trim().toLowerCase();
    // No text → just show the recents pool as-is.
    if (q.length < 2) return recentsPool.slice(0, 12);
    // Filter recents pool client-side by substring (covers partial
    // matches that the exact-match _fullName key misses).
    const filteredRecents = recentsPool.filter((s) => {
      const hay = `${s.displayName} ${s.phone || ""} ${s.email || ""}`.toLowerCase();
      return hay.includes(q);
    });
    // Server hits first, then client-filtered recents. Dedupe by phone+name.
    const seen = new Set<string>();
    const out: CustomerSuggestion[] = [];
    for (const s of [...customerSuggestions, ...filteredRecents]) {
      const k = `${s.displayName}|${s.phone || s.email || ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out.slice(0, 12);
  }, [customerName, customerSuggestions, recentsPool]);

  /** Apply a picked suggestion to the form. */
  const pickSuggestion = (s: CustomerSuggestion) => {
    setCustomerName(s.displayName);
    if (s.phone) setCustomerPhone(s.phone);
    if (s.email) setCustomerEmail(s.email);
    setPickedProfileId(s.profileId);
    setSuggestionsOpen(false);
  };

  // Outside click closes the popover (after a short delay so the
  // pointerup that opened it doesn't also close it).
  useEffect(() => {
    const id = setTimeout(() => {
      const onDown = (e: MouseEvent) => {
        if (popRef.current && !popRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      window.addEventListener("mousedown", onDown);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__gcalPopupOff = () =>
        window.removeEventListener("mousedown", onDown);
    }, 120);
    return () => {
      clearTimeout(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__gcalPopupOff?.();
    };
  }, [onClose]);

  // Position the popover next to the click. Tries the right side
  // first; if it would overflow the viewport, flips to the left.
  // Vertically, centers on the click but clamps inside the viewport.
  const popStyle = useMemo<React.CSSProperties>(() => {
    const W = 416;
    const H_EST = 480;
    const margin = 12;
    let left = pending.anchorX + 18;
    if (left + W > window.innerWidth - margin) {
      left = pending.anchorX - W - 18;
    }
    left = Math.max(margin, Math.min(window.innerWidth - W - margin, left));
    let top = pending.anchorY - 90;
    top = Math.max(70, Math.min(window.innerHeight - H_EST - margin, top));
    return { top, left };
  }, [pending.anchorX, pending.anchorY]);

  // Per-channel validation: voice/whatsapp need phone; email needs
  // recipient email; task has no contact requirement.
  const contactValid = (() => {
    if (channel === "email") return customerEmail.trim().length > 3;
    if (channel === "task") return true;
    return customerPhone.trim().length > 4;
  })();

  const book = async () => {
    const ep = getApiEndpoints();
    if (!ep?.scheduleCallback) {
      toast.error("Endpoint scheduleCallback no configurado");
      return;
    }
    if (!contactValid) {
      toast.error(
        channel === "email"
          ? "Falta el email del cliente"
          : channel === "task"
          ? ""
          : "Falta el teléfono del cliente"
      );
      return;
    }
    // Recompute start/end from the typed times so the agent can adjust.
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    const durationMin = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000));
    setSaving(true);
    try {
      // Phone is what the Lambda keys the row by. For email/task with
      // no phone, fall back to a synthetic key so the row is still
      // valid; the agent will know it's task-style from the channel.
      const phone =
        customerPhone.trim() ||
        (channel === "email" && customerEmail.trim()
          ? `email:${customerEmail.trim()}`
          : `task:${Date.now()}`);
      const payload: Record<string, unknown> = {
        title: title.trim() || undefined,
        phone,
        customerName: customerName.trim() || undefined,
        scheduledAt: start.toISOString(),
        durationMin,
        notes: notes.trim() || undefined,
        assignedAgentUserId: defaultAgentUserId,
        channel,
      };
      if (channel === "email") {
        payload.emailToAddress = customerEmail.trim();
        // Use the title as the email subject when present.
        if (title.trim()) payload.emailSubject = title.trim();
      }
      const r = await fetch(ep.scheduleCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json())?.error || `HTTP ${r.status}`);
      const meta = channelMeta(channel);
      toast.success(`${meta.label} agendada`);
      onBooked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agendar");
    } finally {
      setSaving(false);
    }
  };

  const dayLabel = day.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div ref={popRef} className="gcal-pop" style={popStyle} role="dialog" aria-label="Crear cita">
      <div className="gcal-pop__head">
        <span className="gcal-pop__handle" aria-hidden="true">
          ⋮⋮
        </span>
        <button
          type="button"
          className="gcal-pop__close"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <Icon.Close size={14} />
        </button>
      </div>

      <div className="gcal-pop__body">
        <input
          ref={titleRef}
          className="gcal-pop__title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Añade un título"
          onKeyDown={(e) => {
            if (e.key === "Enter" && customerPhone.trim()) book();
          }}
        />

        {/* Channel picker — each pill colored by channel */}
        <div className="gcal-pop__tabs">
          {(["voice", "whatsapp", "email", "task"] as Channel[]).map((c) => {
            const meta = channelMeta(c);
            const Icn = meta.icon;
            const active = channel === c;
            return (
              <button
                key={c}
                type="button"
                className={`gcal-pop__tab${active ? " gcal-pop__tab--active" : ""}`}
                onClick={() => setChannel(c)}
                style={
                  active
                    ? { background: meta.soft, color: meta.color }
                    : undefined
                }
              >
                <Icn size={13} /> {meta.label}
              </button>
            );
          })}
        </div>

        {/* Date + time */}
        <div className="gcal-pop__row">
          <span className="gcal-pop__row-icon">
            <Icon.Clock size={14} />
          </span>
          <div className="gcal-pop__row-content">
            <div className="gcal-pop__row-main">
              <span style={{ textTransform: "capitalize" }}>{dayLabel}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step={900}
                  className="gcal-pop__row-input gcal-pop__row-input--time"
                  style={{ width: 112, padding: "3px 6px" }}
                />
                <span style={{ color: "var(--text-3)" }}>–</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  step={900}
                  className="gcal-pop__row-input gcal-pop__row-input--time"
                  style={{ width: 112, padding: "3px 6px" }}
                />
              </span>
            </div>
            <div className="gcal-pop__row-sub">Zona horaria local · No se repite</div>
          </div>
        </div>

        {/* Customer typeahead — searches Customer Profiles (which
            includes leads propagated via manage-leads) + a "recents"
            pool when input is empty. Picking a result auto-fills
            phone + email. */}
        <div className="gcal-pop__row" style={{ position: "relative" }}>
          <span className="gcal-pop__row-icon">
            <Icon.User size={14} />
          </span>
          <div className="gcal-pop__row-content" style={{ position: "relative" }}>
            <input
              ref={nameInputRef}
              className="gcal-pop__row-input"
              placeholder="Buscar cliente o lead…"
              value={customerName}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => {
                setSuggestionsOpen(true);
                if (!customerName.trim()) loadRecents();
              }}
              onBlur={() => {
                // Delay so a click on a suggestion can register first.
                setTimeout(() => setSuggestionsOpen(false), 150);
              }}
              style={{ fontWeight: 500 }}
            />
            {pickedProfileId && (
              <span
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--accent-green)",
                  background: "var(--accent-green-soft)",
                  padding: "2px 7px",
                  borderRadius: 999,
                  pointerEvents: "none",
                }}
                title="Perfil seleccionado"
              >
                ✓ Lead
              </span>
            )}
            {suggestionsOpen && visibleSuggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: -22,
                  background: "var(--bg-1)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 10,
                  boxShadow: "var(--shadow-pop)",
                  zIndex: 230,
                  maxHeight: 240,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                {visibleSuggestions.map((s) => (
                  <button
                    key={`${s.profileId}-${s.displayName}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      background: "transparent",
                      border: 0,
                      borderRadius: 7,
                      textAlign: "left",
                      cursor: "pointer",
                      color: "var(--text-1)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: avatarColor(s.displayName),
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {initialsOf(s.displayName)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.displayName}
                      </span>
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          color: "var(--text-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.phone || s.email || "—"}
                      </span>
                    </span>
                    {s.source === "recent" && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--text-3)",
                          background: "var(--bg-2)",
                          padding: "2px 6px",
                          borderRadius: 999,
                          flexShrink: 0,
                        }}
                      >
                        Reciente
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contact — varies by channel.
            voice / whatsapp → phone
            email           → email
            task            → no contact required (still shows phone optional) */}
        {(channel === "voice" || channel === "whatsapp" || channel === "task") && (
          <div className="gcal-pop__row">
            <span className="gcal-pop__row-icon">
              <Icon.Phone
                size={14}
                style={{
                  color:
                    channel === "whatsapp"
                      ? "var(--accent-cyan)"
                      : "var(--accent-green)",
                }}
              />
            </span>
            <div className="gcal-pop__row-content">
              <input
                className="gcal-pop__row-input"
                placeholder={
                  channel === "task"
                    ? "Teléfono (opcional)"
                    : "Teléfono · ej. +51953730189"
                }
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                inputMode="tel"
              />
            </div>
          </div>
        )}
        {channel === "email" && (
          <div className="gcal-pop__row">
            <span className="gcal-pop__row-icon">
              <Icon.Mail size={14} style={{ color: "var(--accent-amber)" }} />
            </span>
            <div className="gcal-pop__row-content">
              <input
                className="gcal-pop__row-input"
                placeholder="Email · ej. cliente@empresa.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                type="email"
              />
            </div>
          </div>
        )}

        {/* Notes (replaces "descripción") */}
        <div className="gcal-pop__row">
          <span className="gcal-pop__row-icon">
            <Icon.Note size={14} />
          </span>
          <div className="gcal-pop__row-content">
            <input
              className="gcal-pop__row-input"
              placeholder="Añadir descripción"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Agent (replaces "calendar selector") */}
        <div className="gcal-pop__row">
          <span className="gcal-pop__row-icon">
            <Icon.Users size={14} />
          </span>
          <div className="gcal-pop__row-content">
            <div className="gcal-pop__row-main">
              <span>
                <span className="gcal-pop__cal-dot" />
                {defaultAgent || "Sin asignar"}
              </span>
            </div>
            <div className="gcal-pop__row-sub">Visibilidad predeterminada</div>
          </div>
        </div>
      </div>

      <div className="gcal-pop__foot">
        <button
          type="button"
          className="gcal-pop__more"
          onClick={onClose}
          title="Cancelar"
        >
          Cancelar
        </button>
        <button
          type="button"
          className="gcal-pop__save"
          onClick={book}
          disabled={saving || !contactValid}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
