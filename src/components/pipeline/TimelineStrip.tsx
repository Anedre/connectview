import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Phone,
  FileStack,
  Clock,
  Headphones,
  CheckCircle2,
  RotateCw,
  MessageSquare,
  Mail,
  CheckSquare,
} from "lucide-react";
import type {
  TimelineContactEvent,
  TimelineTick,
} from "@/hooks/usePipelineHistory";

interface Props {
  ticks: TimelineTick[];
  events: TimelineContactEvent[];
  windowMs?: number; // default 15 min
  heightPx?: number;
}

type StageId = TimelineContactEvent["stage"];
type SwimlaneId = Exclude<StageId, "RETRY">;

const SWIMLANES: {
  id: SwimlaneId;
  label: string;
  Icon: React.ElementType;
  dot: string;
  lane: string;
  accent: string;
}[] = [
  {
    id: "ARRIVED",
    label: "Llegada",
    Icon: Phone,
    dot: "bg-[var(--accent-amber)]",
    lane: "from-[var(--accent-amber)] to-[var(--accent-amber-soft)]",
    accent: "text-[var(--accent-amber)]",
  },
  {
    id: "IN_IVR",
    label: "IVR / Dialing",
    Icon: FileStack,
    dot: "bg-[var(--accent-violet)]",
    lane: "from-[var(--accent-violet)] to-[var(--accent-violet-soft)]",
    accent: "text-[var(--accent-violet)]",
  },
  {
    id: "IN_QUEUE",
    label: "En cola",
    Icon: Clock,
    dot: "bg-[var(--accent-cyan)]",
    lane: "from-[var(--accent-cyan)] to-[var(--accent-cyan-soft)]",
    accent: "text-[var(--accent-cyan)]",
  },
  {
    id: "WITH_AGENT",
    label: "Con agente",
    Icon: Headphones,
    dot: "bg-[var(--accent-green)]",
    lane: "from-[var(--accent-green)] to-[var(--accent-green-soft)]",
    accent: "text-[var(--accent-green)]",
  },
  {
    id: "FINISHED",
    label: "Finalizado",
    Icon: CheckCircle2,
    dot: "bg-[var(--text-3)]",
    lane: "from-[var(--bg-3)] to-[var(--bg-2)]",
    accent: "text-[var(--text-2)]",
  },
];

const STAGE_ROW: Record<StageId, number> = {
  ARRIVED: 0,
  IN_IVR: 1,
  IN_QUEUE: 2,
  WITH_AGENT: 3,
  FINISHED: 4,
  RETRY: 0, // retries visually sit on the Llegada row with a distinct marker
};

const CHANNEL_META: Record<
  string,
  { Icon: React.ElementType; color: string; label: string }
> = {
  VOICE: { Icon: Phone, color: "bg-[var(--accent-cyan)]", label: "Voz" },
  CHAT: { Icon: MessageSquare, color: "bg-[var(--accent-green)]", label: "Chat" },
  EMAIL: { Icon: Mail, color: "bg-[var(--accent-violet)]", label: "Email" },
  TASK: { Icon: CheckSquare, color: "bg-[var(--accent-amber)]", label: "Task" },
};

function formatMinutesAgo(minutes: number): string {
  if (minutes === 0) return "ahora";
  return `${minutes}m`;
}

export function TimelineStrip({
  ticks,
  events,
  windowMs = 15 * 60 * 1000,
  heightPx = 180,
}: Props) {
  const now = Date.now();
  const since = now - windowMs;
  const leftGutterPx = 86;

  const visibleEvents = useMemo(
    () =>
      events.filter((e) => {
        const t = new Date(e.at).getTime();
        return t >= since;
      }),
    [events, since]
  );

  const visibleTicks = useMemo(
    () => ticks.filter((t) => t.t >= since),
    [ticks, since]
  );

  // Totals right now (last tick).
  const lastTick = visibleTicks[visibleTicks.length - 1];
  const totalNow = lastTick
    ? lastTick.arrived + lastTick.inIvr + lastTick.inQueue + lastTick.withAgent
    : 0;

  const retryCount = visibleEvents.filter((e) => e.stage === "RETRY").length;

  // Channels present in the window — drives the compact legend.
  const channelsPresent = useMemo(() => {
    const s = new Set<string>();
    for (const e of visibleEvents) s.add(e.channel);
    return Array.from(s);
  }, [visibleEvents]);

  // Per-lane sparkline data — for each tick, the count in that stage.
  const laneMaxs = useMemo(() => {
    let a = 0,
      i = 0,
      q = 0,
      w = 0,
      f = 0;
    for (const t of visibleTicks) {
      if (t.arrived > a) a = t.arrived;
      if (t.inIvr > i) i = t.inIvr;
      if (t.inQueue > q) q = t.inQueue;
      if (t.withAgent > w) w = t.withAgent;
      if (t.finished > f) f = t.finished;
    }
    return { ARRIVED: a, IN_IVR: i, IN_QUEUE: q, WITH_AGENT: w, FINISHED: f };
  }, [visibleTicks]);

  // Build one sparkline path per lane. Path is drawn inside the lane's row
  // in percent units for easy overlay inside the CSS grid.
  function sparklinePath(laneId: SwimlaneId): string {
    if (visibleTicks.length < 2) return "";
    const max = laneMaxs[laneId] || 1;
    const pts: string[] = [];
    for (const t of visibleTicks) {
      const xPct = ((t.t - since) / windowMs) * 100;
      const count =
        laneId === "ARRIVED"
          ? t.arrived
          : laneId === "IN_IVR"
            ? t.inIvr
            : laneId === "IN_QUEUE"
              ? t.inQueue
              : laneId === "WITH_AGENT"
                ? t.withAgent
                : t.finished;
      // Invert because in SVG y grows downward. Lane height occupies 100 of
      // the viewBox so a value of max is at y=5, zero is at y=95.
      const yPct = 95 - (count / max) * 90;
      pts.push(`${pts.length === 0 ? "M" : "L"} ${xPct} ${yPct}`);
    }
    return pts.join(" ");
  }

  // Time tick marks every 3 min (5 marks across the 15-min window).
  const timeMarks = [12, 9, 6, 3, 0];

  // Hover card state for rich tooltip on a dot.
  const [hovered, setHovered] = useState<TimelineContactEvent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null
  );

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card/60 p-3 backdrop-blur-sm">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span>Línea de tiempo · últimos 15 min</span>
          <span className="rounded-full bg-[var(--accent-cyan-soft)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent-cyan)]">
            {totalNow} activos
          </span>
          {retryCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--accent-red-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-red)]">
              <RotateCw className="h-3 w-3" />
              {retryCount} retry
            </span>
          )}
          {visibleEvents.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">
              · {visibleEvents.length} eventos
            </span>
          )}
        </div>
        {/* Channel legend — only shows channels actually present */}
        {channelsPresent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {channelsPresent.map((ch) => {
              const meta = CHANNEL_META[ch] || CHANNEL_META.VOICE;
              const MetaIcon = meta.Icon;
              return (
                <span key={ch} className="flex items-center gap-1">
                  <span
                    className={`flex h-3 w-3 items-center justify-center rounded-full ${meta.color} text-white`}
                  >
                    <MetaIcon className="h-2 w-2" />
                  </span>
                  {meta.label}
                </span>
              );
            })}
            <span className="mx-1 h-3 w-px bg-border" />
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent-red)] ring-1 ring-[var(--accent-red-soft)]" />
              retry
            </span>
          </div>
        )}
      </div>

      {/* Time axis — above the swimlanes */}
      <div
        className="relative mb-1 h-4"
        style={{ marginLeft: leftGutterPx }}
      >
        {timeMarks.map((mAgo) => {
          const leftPct = ((windowMs - mAgo * 60_000) / windowMs) * 100;
          return (
            <div
              key={mAgo}
              className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ left: `${leftPct}%` }}
            >
              {formatMinutesAgo(mAgo)}
            </div>
          );
        })}
      </div>

      {/* Swimlanes */}
      <div
        className="relative flex flex-col gap-0.5"
        style={{ height: heightPx }}
      >
        {/* Row labels (left gutter) */}
        <div
          className="absolute inset-y-0 left-0 z-10 flex flex-col"
          style={{ width: leftGutterPx }}
        >
          {SWIMLANES.map(({ id, label, Icon, accent }) => (
            <div
              key={id}
              className="flex flex-1 items-center gap-1.5 pr-2"
              style={{ minHeight: 0 }}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted ${accent}`}
              >
                <Icon className="h-3 w-3" />
              </span>
              <span className="truncate text-[11px] font-medium">{label}</span>
            </div>
          ))}
        </div>

        {/* Lane backgrounds — subtle gradients make each row visually distinct
            without being busy. */}
        <div
          className="absolute inset-0 flex flex-col gap-0.5"
          style={{ marginLeft: leftGutterPx }}
        >
          {SWIMLANES.map(({ id, lane }) => (
            <div
              key={id}
              className={`flex-1 rounded-md bg-gradient-to-r ${lane}`}
            />
          ))}
        </div>

        {/* Vertical time gridlines */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ left: leftGutterPx }}
        >
          {timeMarks.map((mAgo) => {
            const leftPct = ((windowMs - mAgo * 60_000) / windowMs) * 100;
            const isNow = mAgo === 0;
            return (
              <div
                key={mAgo}
                className={`absolute inset-y-0 border-l ${
                  isNow
                    ? "border-[var(--accent-green)]"
                    : "border-dashed border-muted-foreground/15"
                }`}
                style={{ left: `${leftPct}%` }}
              />
            );
          })}
        </div>

        {/* Per-lane sparkline overlay — one SVG per lane, absolutely
            positioned over its row so paths stay self-contained. */}
        <div
          className="pointer-events-none absolute inset-0 flex flex-col gap-0.5"
          style={{ marginLeft: leftGutterPx }}
        >
          {SWIMLANES.map(({ id, dot }) => {
            const path = sparklinePath(id);
            if (!path) return <div key={id} className="flex-1" />;
            return (
              <div key={id} className="relative flex-1">
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  {/* Area fill */}
                  <path
                    d={`${path} L 100 100 L 0 100 Z`}
                    className={dot}
                    fill="currentColor"
                    opacity={0.12}
                  />
                  {/* Line */}
                  <path
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    className={dot.replace("bg-", "text-")}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.6}
                  />
                </svg>
              </div>
            );
          })}
        </div>

        {/* Pulsing "ahora" marker on the right edge — spans all lanes */}
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{ left: `calc(${leftGutterPx}px + 100% - ${leftGutterPx}px)` }}
        >
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="absolute -right-1 top-0 bottom-0 w-0.5 rounded-full bg-[var(--accent-green)] shadow-[0_0_8px_rgba(16,185,129,0.6)]"
          />
          <span className="absolute -right-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-[var(--accent-green)] ring-4 ring-[var(--accent-green-soft)]" />
        </div>

        {/* Event dots — overlaid on top of lanes */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ marginLeft: leftGutterPx }}
        >
          {visibleEvents.map((e, i) => {
            const t = new Date(e.at).getTime();
            const xRaw = ((t - since) / windowMs) * 100;
            const x = Math.max(0, Math.min(100, xRaw));
            const row = STAGE_ROW[e.stage];
            // Each row fills 1/5 of the height; center the dot vertically.
            const rowTopPct = (row / 5) * 100;
            const centerYPct = rowTopPct + 100 / 5 / 2;
            const isRetry = e.stage === "RETRY";
            const channel = CHANNEL_META[e.channel] || CHANNEL_META.VOICE;
            const dotSize = isRetry ? 12 : 10;
            return (
              <motion.button
                type="button"
                key={`${e.contactId}-${t}-${i}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                whileHover={{ scale: 1.4 }}
                onMouseEnter={(ev) => {
                  setHovered(e);
                  const rect = (
                    ev.currentTarget as HTMLButtonElement
                  ).getBoundingClientRect();
                  setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  setHoverPos(null);
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${
                  isRetry
                    ? "bg-[var(--accent-red)] animate-pulse shadow-[0_0_6px_rgba(244,63,94,0.55)]"
                    : `${channel.color} shadow-sm`
                }`}
                style={{
                  left: `${x}%`,
                  top: `${centerYPct}%`,
                  width: dotSize,
                  height: dotSize,
                }}
                aria-label={`Evento ${e.stage} ${e.phone || e.contactId}`}
              />
            );
          })}
          {visibleEvents.length === 0 && (
            <div className="flex h-full w-full items-center justify-center text-[11px] italic text-muted-foreground/60">
              Sin eventos en los últimos 15 minutos
            </div>
          )}
        </div>
      </div>

      {/* Hover tooltip — rendered in a fixed layer so it escapes overflow clipping */}
      {hovered && hoverPos && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: hoverPos.x, top: hoverPos.y - 8 }}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hovered.stage === "RETRY"
                  ? "bg-[var(--accent-red)]"
                  : (CHANNEL_META[hovered.channel] || CHANNEL_META.VOICE).color
              }`}
            />
            {hovered.phone || hovered.contactId.slice(0, 10)}
            {hovered.customerName ? ` · ${hovered.customerName}` : ""}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-[10px] text-muted-foreground">
            <span>{hovered.stage}</span>
            {hovered.queueName && <span>· {hovered.queueName}</span>}
            {hovered.agentUsername && <span>· {hovered.agentUsername}</span>}
            {hovered.retryCount && hovered.retryCount > 1 && (
              <span>· intento {hovered.retryCount}</span>
            )}
            {hovered.disconnectReason && (
              <span>· {hovered.disconnectReason}</span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/80">
            {new Date(hovered.at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
