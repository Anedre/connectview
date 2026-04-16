import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useActiveContact } from "@/hooks/useActiveContact";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import { CasesPanel } from "@/components/workspace/CasesPanel";
import { WisdomPanel } from "@/components/workspace/WisdomPanel";

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
  const activeContact = useActiveContact();

  // Move the global CCP container into the visible slot on mount
  useEffect(() => {
    const panel = document.getElementById("ccp-visible-slot");
    const globalHost = document.getElementById("global-ccp-host");
    const ccp = document.getElementById("ccp-container");

    if (ccp && panel) {
      panel.appendChild(ccp);
      ccp.setAttribute(
        "style",
        "width: 320px; height: 465px; border: 1px solid #e5e7eb; border-radius: 8px;"
      );
    }

    return () => {
      if (ccp && globalHost) {
        globalHost.appendChild(ccp);
        ccp.setAttribute("style", "");
      }
    };
  }, []);

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
          {activeContact && (
            <Badge variant="outline" className="gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              {activeContact.channel} · {activeContact.state}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {user?.securityProfiles.map((p) => (
            <Badge key={p} variant="outline" className="text-xs">
              {p}
            </Badge>
          ))}
        </div>
      </div>

      {/* Main workspace: CCP on left, tabs on right */}
      <div className="flex gap-4">
        {/* Left: CCP */}
        <div className="shrink-0">
          <div id="ccp-visible-slot" />
        </div>

        {/* Right: Tabbed workspace */}
        <div className="flex-1">
          <Tabs defaultValue="customer" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="customer">Customer Profile</TabsTrigger>
              <TabsTrigger value="cases">Cases</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            </TabsList>

            <TabsContent value="customer" className="mt-4">
              <CustomerProfilePanel
                phone={activeContact?.customerPhone || null}
                isActive={!!activeContact}
              />
            </TabsContent>

            <TabsContent value="cases" className="mt-4">
              <CasesPanel
                contactId={activeContact?.contactId || null}
                customerPhone={activeContact?.customerPhone || null}
              />
            </TabsContent>

            <TabsContent value="knowledge" className="mt-4">
              <WisdomPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
