import { useMemo } from "react";
import { motion } from "framer-motion";
import { Phone, FileStack, Clock, Headphones, CheckCircle2, RotateCw } from "lucide-react";
import type { TimelineContactEvent, TimelineTick } from "@/hooks/usePipelineHistory";

interface Props {
  ticks: TimelineTick[];
  events: TimelineContactEvent[];
  windowMs?: number; // default 15 min
  heightPx?: number;
}

const STAGE_ROW: Record<TimelineContactEvent["stage"], number> = {
  ARRIVED: 0,
  IN_IVR: 1,
  IN_QUEUE: 2,
  WITH_AGENT: 3,
  FINISHED: 4,
  RETRY: 0, // Retries reappear on the ARRIVED row with a special marker
};

const STAGE_COLOR: Record<TimelineContactEvent["stage"], string> = {
  ARRIVED: "bg-amber-500",
  IN_IVR: "bg-violet-500",
  IN_QUEUE: "bg-sky-500",
  WITH_AGENT: "bg-emerald-500",
  FINISHED: "bg-slate-400",
  RETRY: "bg-rose-500",
};

const CHANNEL_COLOR: Record<string, string> = {
  VOICE: "bg-sky-500",
  CHAT: "bg-emerald-500",
  EMAIL: "bg-violet-500",
  TASK: "bg-amber-500",
};

const STAGE_LABELS = [
  { label: "Llegada", Icon: Phone },
  { label: "IVR", Icon: FileStack },
  { label: "Cola", Icon: Clock },
  { label: "Agente", Icon: Headphones },
  { label: "Fin", Icon: CheckCircle2 },
];

export function TimelineStrip({
  ticks,
  events,
  windowMs = 15 * 60 * 1000,
  heightPx = 110,
}: Props) {
  const now = Date.now();
  const since = now - windowMs;

  const visibleEvents = useMemo(
    () =>
      events.filter((e) => {
        const t = new Date(e.at).getTime();
        return t >= since;
      }),
    [events, since]
  );

  const visibleTicks = ticks.filter((t) => t.t >= since);

  // (sparkline removed — was causing visual artifacts when total=0 ticks
  //  stacked on the same y coord. Event dots alone tell the story now.)

  const totalNow = visibleTicks.length
    ? visibleTicks[visibleTicks.length - 1].arrived +
      visibleTicks[visibleTicks.length - 1].inIvr +
      visibleTicks[visibleTicks.length - 1].inQueue +
      visibleTicks[visibleTicks.length - 1].withAgent
    : 0;

  const retryCount = visibleEvents.filter((e) => e.stage === "RETRY").length;

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold flex items-center gap-2">
          <span>Línea de tiempo · últimos 15 min</span>
          <span className="rounded bg-sky-100 px-1.5 py-0 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">
            {totalNow} ahora
          </span>
          {retryCount > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0 text-[10px] text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              <RotateCw className="h-2.5 w-2.5" />
              {retryCount} retry
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>15m</span>
          <span>→</span>
          <span>ahora</span>
        </div>
      </div>

      <div
        className="relative flex flex-col gap-1"
        style={{ height: heightPx }}
      >
        {/* Row labels */}
        <div className="absolute inset-y-0 left-0 z-10 flex w-[60px] flex-col justify-between py-1 pr-2">
          {STAGE_LABELS.map(({ label, Icon }) => (
            <div
              key={label}
              className="flex items-center gap-1 text-[9px] text-muted-foreground"
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
            </div>
          ))}
        </div>

        {/* Lightweight row separators — CSS only, no SVG needed. */}
        <div className="pointer-events-none absolute inset-0 ml-[60px]">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/15"
              style={{ top: `${(row / 4) * 100}%` }}
            />
          ))}
        </div>

        {/* Event dots */}
        <div className="absolute inset-0 ml-[60px] overflow-hidden">
          {visibleEvents.map((e, i) => {
            const t = new Date(e.at).getTime();
            const xRaw = ((t - since) / windowMs) * 100;
            const x = Math.max(0, Math.min(100, xRaw));
            const row = STAGE_ROW[e.stage];
            const yPct = (row / 4) * 100;
            const isRetry = e.stage === "RETRY";
            return (
              <motion.div
                key={`${e.contactId}-${t}-${i}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                title={`${e.phone || e.contactId.slice(0, 8)}${
                  e.customerName ? " · " + e.customerName : ""
                } · ${e.stage}${
                  e.agentUsername ? " · " + e.agentUsername : ""
                }${e.retryCount ? " · intento " + e.retryCount : ""}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  isRetry
                    ? "bg-rose-500 ring-2 ring-rose-300 animate-pulse"
                    : CHANNEL_COLOR[e.channel] || STAGE_COLOR[e.stage]
                } shadow-sm`}
                style={{
                  left: `${x}%`,
                  top: `${yPct}%`,
                  width: isRetry ? 10 : 6,
                  height: isRetry ? 10 : 6,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
