import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  PhoneCall,
  CheckCircle2,
  XCircle,
  PhoneOff,
  Target,
  Gauge,
  TimerReset,
  Hourglass,
  Phone,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CampaignActivityKpis } from "@/hooks/useCampaignActivity";
import type { Campaign } from "@/hooks/useCampaigns";
import type { CampaignStatsData } from "@/hooks/useCampaignStats";

interface Props {
  /** Kept in the signature for callers, even though the panel no longer
   *  renders the config metadata (dial mode/window/retries) — that info
   *  lives on the Campaign Detail page now, not in the live monitor. */
  campaign: Campaign;
  stats: CampaignStatsData | null;
  kpis: CampaignActivityKpis;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Wide horizontal panel sitting at the top of each CampaignFlowCard, giving
 * the administrator a one-glance read of how the campaign is doing — the
 * progress bar with absolute and percent values, plus six KPI tiles for
 * success rate, calls/min, average call duration, ETA, live count, and the
 * remaining-pending count (which is the headline number the user's boss
 * specifically asked about).
 */
export function CampaignProgressPanel({ campaign: _campaign, stats, kpis }: Props) {
  const counts = stats?.counts || {
    pending: 0,
    dialing: 0,
    connected: 0,
    done: 0,
    no_answer: 0,
    failed: 0,
  };

  const total = kpis.total;
  const completed = kpis.completed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Status mix bars — each segment proportional to its share of `total`.
  const segments = useMemo(() => {
    if (total === 0) return [];
    const pctOf = (n: number) => (n / total) * 100;
    return [
      {
        key: "done",
        label: "Done",
        pct: pctOf(counts.done),
        color: "bg-emerald-500",
        value: counts.done,
      },
      {
        key: "connected",
        label: "Connected",
        pct: pctOf(counts.connected),
        color: "bg-emerald-400",
        value: counts.connected,
      },
      {
        key: "dialing",
        label: "Dialing",
        pct: pctOf(counts.dialing),
        color: "bg-blue-500",
        value: counts.dialing,
      },
      {
        key: "no_answer",
        label: "No answer",
        pct: pctOf(counts.no_answer),
        color: "bg-amber-500",
        value: counts.no_answer,
      },
      {
        key: "failed",
        label: "Failed",
        pct: pctOf(counts.failed),
        color: "bg-rose-500",
        value: counts.failed,
      },
      {
        key: "pending",
        label: "Pending",
        pct: pctOf(counts.pending),
        color: "bg-slate-300 dark:bg-slate-700",
        value: counts.pending,
      },
    ];
  }, [counts, total]);

  return (
    <motion.div layout className="space-y-8">
      {/* ── HERO progress: massive completion number takes the focus ─ */}
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Procesados
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-6xl font-semibold tabular-nums tracking-tight">
              {completed}
            </span>
            <span className="text-2xl text-muted-foreground/60 tabular-nums">
              / {total}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold tabular-nums text-foreground">
                {pct}%
              </span>{" "}
              completado
            </span>
            {kpis.pending > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Hourglass className="h-3.5 w-3.5" />
                  <span className="font-semibold tabular-nums text-foreground">
                    {kpis.pending}
                  </span>{" "}
                  faltan
                </span>
              </>
            )}
            {kpis.live > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {kpis.live}
                  </span>{" "}
                  en vivo
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right-side hero metric: ETA — the most action-oriented number */}
        {(kpis.etaSeconds || kpis.pending === 0) && total > 0 && (
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Estimado para terminar
            </div>
            <div className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">
              {kpis.etaLabel}
            </div>
            {kpis.callsPerMinute > 0 && (
              <div className="mt-1 text-sm text-muted-foreground">
                a{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {kpis.callsPerMinute}
                </span>{" "}
                llamadas/min
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Progress bar full-width, taller for visual presence ──── */}
      <div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-0 flex">
            {segments.map((s) =>
              s.pct > 0 ? (
                <div
                  key={s.key}
                  className={`h-full ${s.color} transition-all`}
                  style={{ width: `${s.pct}%` }}
                  title={`${s.label}: ${s.value}`}
                />
              ) : null
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
                <span className="font-medium tabular-nums text-foreground">
                  {s.value}
                </span>{" "}
                {s.label}
              </span>
            ))}
          {segments.every((s) => s.value === 0) && (
            <span className="italic">sin contactos cargados aún</span>
          )}
        </div>
      </div>

      {/* ── KPI strip: 4 big metrics in a row ────────────────────── */}
      <div className="grid grid-cols-2 gap-x-12 gap-y-6 border-t pt-8 md:grid-cols-4">
        <HeroKpi
          label="Pendientes"
          value={kpis.pending}
          tone="warning"
          hint="Sin marcar todavía"
        />
        <HeroKpi
          label="En vivo"
          value={kpis.live}
          tone={kpis.live > 0 ? "success" : "default"}
          hint="Dialing + connected"
          pulse={kpis.live > 0}
        />
        <HeroKpi
          label="Tasa de éxito"
          value={`${kpis.successRate}%`}
          tone={
            kpis.successRate >= 50
              ? "success"
              : kpis.successRate >= 25
                ? "warning"
                : "critical"
          }
          hint="done / cerrados"
        />
        <HeroKpi
          label="Duración promedio"
          value={formatDuration(kpis.avgCallSeconds)}
          hint="Mediana observada"
        />
      </div>

      {/* SmallStat is unused in the live layout but kept exported for the
          Campaign Detail page which still imports it. */}
      {false && (
        <SmallStat
          Icon={Clock}
          label="placeholder"
          value={0}
          color="text-muted-foreground"
        />
      )}
    </motion.div>
  );
}

/**
 * Big-number metric. Replaces the tiny KpiTile — labels stay small but the
 * value is the visual hero. The tone is a single dot to the left of the
 * value, only when tone !== default.
 */
function HeroKpi({
  label,
  value,
  tone = "default",
  hint,
  pulse,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "critical" | "success";
  hint?: string;
  pulse?: boolean;
}) {
  const dotCls =
    tone === "critical"
      ? "bg-rose-500"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "success"
          ? "bg-emerald-500"
          : null;
  return (
    <div title={hint} className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {dotCls && (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotCls} ${
              pulse ? "animate-pulse" : ""
            }`}
          />
        )}
        <span className="truncate text-3xl font-semibold tabular-nums tracking-tight">
          {value}
        </span>
      </div>
      {hint && (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone = "default",
  hint,
  pulse,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "critical" | "success";
  hint?: string;
  pulse?: boolean;
}) {
  // Linear/Vercel-style metric: just label + value stacked. No card, no
  // border, no icon. Tone is whispered via a tiny dot to the left of the
  // value — only when tone !== default.
  const dotCls =
    tone === "critical"
      ? "bg-rose-500"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "success"
          ? "bg-emerald-500"
          : null;

  return (
    <div title={hint} className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {dotCls && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls} ${
              pulse ? "animate-pulse" : ""
            }`}
          />
        )}
        <span className="truncate text-lg font-semibold tabular-nums">
          {value}
        </span>
      </div>
    </div>
  );
}

function SmallStat({
  Icon,
  label,
  value,
  color,
  highlight,
}: {
  Icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-1.5 rounded-md px-2 py-1 text-[11px] ${
        highlight ? "bg-blue-50 dark:bg-blue-950/30" : "bg-muted/30"
      }`}
    >
      <span className="flex items-center gap-1">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
