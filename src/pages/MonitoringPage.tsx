import { Users, Phone, Clock, UserCheck } from "lucide-react";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { KPICard } from "@/components/monitoring/KPICard";
import { QueueTable } from "@/components/monitoring/QueueTable";
import { AgentTable } from "@/components/monitoring/AgentTable";
import { RefreshIndicator } from "@/components/monitoring/RefreshIndicator";

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
        <p className="text-muted-foreground">Loading metrics...</p>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Real-time Monitoring
          </h2>
          <p className="text-muted-foreground">
            Contact center activity overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {usingLiveData && (
            <span className="text-xs font-medium text-green-600">LIVE</span>
          )}
          <RefreshIndicator
            lastRefresh={lastRefresh}
            onRefresh={refresh}
            loading={loading}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Contacts in Queue"
          value={metrics.summary.totalContactsInQueue}
          subtitle="Across all queues"
          icon={<Phone className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Agents Available"
          value={metrics.summary.totalAgentsAvailable}
          subtitle={`of ${metrics.summary.totalAgentsOnline} online`}
          icon={<UserCheck className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Agents Online"
          value={metrics.summary.totalAgentsOnline}
          subtitle="Total connected"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Longest Wait"
          value={formatWait(metrics.summary.longestWaitSeconds)}
          subtitle="Current oldest contact"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Queue Metrics */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">Queue Metrics</h3>
        <QueueTable queues={metrics.queues} />
      </div>

      {/* Agent Status */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">Agent Status</h3>
        <AgentTable agents={metrics.agents} />
      </div>
    </div>
  );
}
