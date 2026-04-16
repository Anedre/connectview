import { Users, Phone, Clock, UserCheck, Activity } from "lucide-react";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { QueueTable } from "@/components/monitoring/QueueTable";
import { AgentTable } from "@/components/monitoring/AgentTable";
import { RefreshIndicator } from "@/components/monitoring/RefreshIndicator";

interface KPIProps {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ElementType;
  gradient: string;
  delay: number;
}

function PremiumKPI({ label, value, sub, icon: Icon, gradient, delay }: KPIProps) {
  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-card p-5 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`absolute right-0 top-0 h-24 w-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 blur-2xl transition-opacity group-hover:opacity-20`}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-4xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg shadow-black/5`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function MonitoringPage() {
  const { metrics, loading, error, lastRefresh, usingLiveData, refresh } =
    useRealtimeMetrics();

  if (loading && !metrics) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Activity className="mx-auto h-8 w-8 animate-pulse text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">
            Loading metrics...
          </p>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">
              Real-time Monitoring
            </h2>
            {usingLiveData && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Contact center activity overview
          </p>
        </div>
        <RefreshIndicator
          lastRefresh={lastRefresh}
          onRefresh={refresh}
          loading={loading}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <PremiumKPI
          label="Contacts in Queue"
          value={metrics.summary.totalContactsInQueue}
          sub="Across all queues"
          icon={Phone}
          gradient="from-blue-500 to-indigo-600"
          delay={0}
        />
        <PremiumKPI
          label="Agents Available"
          value={metrics.summary.totalAgentsAvailable}
          sub={`of ${metrics.summary.totalAgentsOnline} online`}
          icon={UserCheck}
          gradient="from-emerald-500 to-teal-600"
          delay={80}
        />
        <PremiumKPI
          label="Agents Online"
          value={metrics.summary.totalAgentsOnline}
          sub="Total connected"
          icon={Users}
          gradient="from-amber-500 to-orange-600"
          delay={160}
        />
        <PremiumKPI
          label="Longest Wait"
          value={formatWait(metrics.summary.longestWaitSeconds)}
          sub="Current oldest contact"
          icon={Clock}
          gradient="from-rose-500 to-pink-600"
          delay={240}
        />
      </div>

      {/* Queue Metrics */}
      <div
        className="animate-fade-in-up"
        style={{ animationDelay: "320ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">Queue Metrics</h3>
          <span className="text-xs text-muted-foreground">
            {metrics.queues.length} queues
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <QueueTable queues={metrics.queues} />
        </div>
      </div>

      {/* Agent Status */}
      <div
        className="animate-fade-in-up"
        style={{ animationDelay: "400ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">Agent Status</h3>
          <span className="text-xs text-muted-foreground">
            {metrics.agents.length} agents
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <AgentTable agents={metrics.agents} />
        </div>
      </div>
    </div>
  );
}
