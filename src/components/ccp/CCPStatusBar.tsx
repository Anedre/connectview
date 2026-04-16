import { Badge } from "@/components/ui/badge";
import type { AgentState } from "@/types/connect";

interface CCPStatusBarProps {
  agentState: AgentState;
  agentName: string;
}

const STATE_STYLES: Record<AgentState, string> = {
  Init: "bg-gray-100 text-gray-800",
  Available: "bg-green-100 text-green-800",
  Busy: "bg-yellow-100 text-yellow-800",
  AfterCallWork: "bg-orange-100 text-orange-800",
  CallingCustomer: "bg-blue-100 text-blue-800",
  Offline: "bg-gray-200 text-gray-600",
  Error: "bg-red-100 text-red-800",
};

export function CCPStatusBar({ agentState, agentName }: CCPStatusBarProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span className="text-sm font-medium text-muted-foreground">
        {agentName || "Agent"}
      </span>
      <Badge className={STATE_STYLES[agentState]}>{agentState}</Badge>
    </div>
  );
}
