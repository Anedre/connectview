import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ContactPanel } from "@/components/crm/ContactPanel";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";

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
  const isOnCall = agentState === "Busy" || agentState === "CallingCustomer";

  // Move the global CCP container into the visible panel on mount,
  // and return it to its hidden host on unmount (so it persists across routes).
  useEffect(() => {
    const panel = document.getElementById("ccp-visible-slot");
    const globalHost = document.getElementById("global-ccp-host");
    const ccp = document.getElementById("ccp-container");

    if (ccp && panel) {
      panel.appendChild(ccp);
      // Remove hidden styles so it's visible
      ccp.setAttribute(
        "style",
        "width: 320px; height: 465px; border: 1px solid #e5e7eb; border-radius: 8px;"
      );
    }

    return () => {
      if (ccp && globalHost) {
        globalHost.appendChild(ccp);
        // Restore hidden state
        ccp.setAttribute("style", "");
      }
    };
  }, []);

  return (
    <div className="flex gap-6">
      <div className="shrink-0 space-y-3">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <span className="text-sm font-medium">{agentName || user?.username || "Agent"}</span>
          <Badge className={STATE_STYLES[agentState] || ""}>{agentState}</Badge>
        </div>

        {/* Visible slot where the global CCP iframe is moved to */}
        <div id="ccp-visible-slot" />
      </div>

      <div className="flex-1 space-y-4">
        <ContactPanel isActive={isOnCall} />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Session Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-1">
              <span className="text-muted-foreground">Username</span>
              <span className="font-medium">{user?.username}</span>
              <span className="text-muted-foreground">Display Name</span>
              <span>{agentName || "—"}</span>
              <span className="text-muted-foreground">Role</span>
              <span>
                <Badge variant="secondary">{user?.highestRole}</Badge>
              </span>
              <span className="text-muted-foreground">Agent State</span>
              <span>
                <Badge className={STATE_STYLES[agentState] || ""}>
                  {agentState}
                </Badge>
              </span>
            </div>
            <div className="pt-2 border-t">
              <div className="text-xs text-muted-foreground mb-1">
                Security Profiles
              </div>
              <div className="flex flex-wrap gap-1">
                {user?.securityProfiles.length ? (
                  user.securityProfiles.map((p) => (
                    <Badge key={p} variant="outline" className="text-xs">
                      {p}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Loading...
                  </span>
                )}
              </div>
            </div>
            <div className="pt-2 border-t">
              <div className="text-xs text-muted-foreground mb-1">
                App Roles
              </div>
              <div className="flex flex-wrap gap-1">
                {user?.groups.map((g) => (
                  <Badge key={g} variant="secondary" className="text-xs">
                    {g}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
