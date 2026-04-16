import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import { getAgentAppUrl } from "@/lib/connect";

const STATE_STYLES: Record<string, string> = {
  Init: "bg-gray-100 text-gray-800",
  Available: "bg-green-100 text-green-800",
  Busy: "bg-yellow-100 text-yellow-800",
  AfterCallWork: "bg-orange-100 text-orange-800",
  CallingCustomer: "bg-blue-100 text-blue-800",
  Offline: "bg-gray-200 text-gray-600",
  Error: "bg-red-100 text-red-800",
};

export function AgentDesktopPage() {
  const { agentState, agentName } = useCCP();
  const { user } = useConnectAuth();

  const agentAppUrl = CONNECT_INSTANCE_URL
    ? getAgentAppUrl(CONNECT_INSTANCE_URL)
    : "";

  return (
    <div className="space-y-4">
      {/* Header with session info */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-medium">
              {agentName || user?.username || "Agent"}
            </div>
            <div className="text-xs text-muted-foreground">
              {user?.username}
            </div>
          </div>
          <Badge className={STATE_STYLES[agentState] || ""}>
            {agentState}
          </Badge>
          <Badge variant="secondary">{user?.highestRole}</Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {user?.securityProfiles.map((p) => (
            <Badge key={p} variant="outline" className="text-xs">
              {p}
            </Badge>
          ))}
        </div>
      </div>

      {/* Full Agent Workspace embedded (CCP + Customer Profiles + Cases + Wisdom) */}
      {agentAppUrl ? (
        <div className="overflow-hidden rounded-lg border bg-white">
          <iframe
            src={agentAppUrl}
            title="Amazon Connect Agent Workspace"
            allow="camera; microphone; autoplay; clipboard-read; clipboard-write"
            style={{
              width: "100%",
              height: "calc(100vh - 180px)",
              border: "none",
              display: "block",
            }}
          />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Agent Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connect instance URL not configured.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
