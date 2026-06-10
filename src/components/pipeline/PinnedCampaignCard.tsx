import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Pin,
  PinOff,
  ExternalLink,
  CheckCircle2,
  XCircle,
  PhoneOff,
  PhoneCall,
  Clock,
  Users,
  Calendar,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampaignStatsData } from "@/hooks/useCampaignStats";

interface Props {
  stats: CampaignStatsData;
  onUnpin: () => void;
}

const STATUS_STYLES: Record<string, { pill: string; border: string }> = {
  COMPLETED: {
    pill: "bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
    border: "border-[var(--accent-green-soft)]",
  },
  CANCELLED: {
    pill: "bg-[var(--bg-2)] text-[var(--text-2)]",
    border: "border-[var(--border-2)]",
  },
  RUNNING: {
    pill: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
    border: "border-[var(--accent-cyan-soft)]",
  },
  PAUSED: {
    pill: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
    border: "border-[var(--accent-amber-soft)]",
  },
};

function formatDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact historical summary rendered for pinned campaigns that are no
 * longer RUNNING/PAUSED. Purposely NOT the Flow/Board view — historical
 * campaigns don't have per-stage breakdowns in the stats endpoint, and
 * faking one with stale counts would be misleading. The admin gets totals,
 * outcome mix, duration, and a link to the detail page.
 */
export function PinnedCampaignCard({ stats, onUnpin }: Props) {
  const { campaign, counts } = stats;
  const statusStyle = STATUS_STYLES[campaign.status] || STATUS_STYLES.CANCELLED;

  // Outcome mix as percentages — used for the horizontal bar.
  const { total, outcomes } = useMemo(() => {
    const done = counts.done || 0;
    const noAns = counts.no_answer || 0;
    const failed = counts.failed || 0;
    const sum = done + noAns + failed;
    return {
      total: sum,
      outcomes: [
        {
          key: "done",
          label: "Completadas",
          value: done,
          color: "bg-[var(--accent-green)]",
          pct: sum > 0 ? (done / sum) * 100 : 0,
          Icon: CheckCircle2,
        },
        {
          key: "no_answer",
          label: "Sin respuesta",
          value: noAns,
          color: "bg-[var(--accent-amber)]",
          pct: sum > 0 ? (noAns / sum) * 100 : 0,
          Icon: PhoneOff,
        },
        {
          key: "failed",
          label: "Errores",
          value: failed,
          color: "bg-[var(--accent-red)]",
          pct: sum > 0 ? (failed / sum) * 100 : 0,
          Icon: XCircle,
        },
      ],
    };
  }, [counts]);

  // Agents who participated, derived from liveContacts if present.
  const agentsSeen = useMemo(() => {
    const set = new Set<string>();
    for (const lc of stats.liveContacts || []) {
      if (lc.agentUsername) set.add(lc.agentUsername);
    }
    return Array.from(set);
  }, [stats.liveContacts]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={`relative rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm ${statusStyle.border}`}
    >
      {/* Header: pin badge + name + status + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          title="Esta campaña está fijada — histórico, no refresca en vivo"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] ring-1 ring-[var(--accent-amber-soft)]"
        >
          <Pin className="h-3.5 w-3.5 fill-current" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold">
              {campaign.name}
            </span>
            <Badge className={statusStyle.pill}>{campaign.status}</Badge>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              histórico
            </span>
          </div>
          {campaign.description && (
            <div className="truncate text-xs text-muted-foreground">
              {campaign.description}
            </div>
          )}
        </div>
        <Link to={`/campaigns/${campaign.campaignId}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Ver detalle
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={onUnpin}
          title="Despinnear — sacar del Queue Manager"
        >
          <PinOff className="mr-1 h-3.5 w-3.5" />
          Despinnear
        </Button>
      </div>

      {/* Stat strip: totales + duración + fechas */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          Icon={PhoneCall}
          label="Procesadas"
          value={`${total}`}
          hint={`de ${campaign.totalContacts || "—"} totales`}
        />
        <Stat
          Icon={Clock}
          label="Duración"
          value={formatDuration(campaign.startedAt, campaign.completedAt)}
        />
        <Stat
          Icon={Calendar}
          label="Inicio"
          value={formatDateTime(campaign.startedAt)}
        />
        <Stat
          Icon={Calendar}
          label="Fin"
          value={formatDateTime(campaign.completedAt)}
        />
      </div>

      {/* Outcome bar */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Resultado</span>
          <span>{total > 0 ? `${total} llamadas` : "sin datos"}</span>
        </div>
        {total > 0 ? (
          <>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {outcomes.map((o) =>
                o.value > 0 ? (
                  <div
                    key={o.key}
                    className={o.color}
                    style={{ width: `${o.pct}%` }}
                    title={`${o.label}: ${o.value} (${o.pct.toFixed(0)}%)`}
                  />
                ) : null
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              {outcomes.map((o) => (
                <span key={o.key} className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${o.color}`} />
                  <o.Icon className="h-3 w-3" />
                  <span className="font-medium">{o.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {o.value} ({o.pct.toFixed(0)}%)
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-[11px] italic text-muted-foreground">
            Sin datos de resultado — la campaña no completó llamadas
          </div>
        )}
      </div>

      {/* Agents who participated */}
      {agentsSeen.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Agentes:</span>
          <div className="flex flex-wrap gap-1">
            {agentsSeen.slice(0, 8).map((a) => (
              <span
                key={a}
                className="rounded-full bg-muted px-2 py-0.5 font-medium"
              >
                {a}
              </span>
            ))}
            {agentsSeen.length > 8 && (
              <span className="text-muted-foreground">
                +{agentsSeen.length - 8}
              </span>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Stat({
  Icon,
  label,
  value,
  hint,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-semibold tabular-nums">
          {value}
        </div>
        {hint && (
          <div className="truncate text-[10px] text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
