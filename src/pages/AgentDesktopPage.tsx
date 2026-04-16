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
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import { LiveTranscriptPanel } from "@/components/workspace/LiveTranscriptPanel";
import { ContactHistoryPanel } from "@/components/workspace/ContactHistoryPanel";
import { AgentNotesPanel } from "@/components/workspace/AgentNotesPanel";
import { AIAssistPanel } from "@/components/workspace/AIAssistPanel";
import { CasesPanel } from "@/components/workspace/CasesPanel";

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

  // Also subscribe to live transcript to feed AI assist with latest customer utterances
  const { data: liveData } = useLiveTranscript(
    activeContact ? activeContact.contactId : null
  );
  const latestCustomerUtterance = liveData?.segments
    .filter((s) => s.participant === "CUSTOMER")
    .slice(-1)[0]?.content;

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
          {activeContact?.customerPhone && (
            <Badge variant="outline" className="font-mono">
              {activeContact.customerPhone}
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
        {/* Left column: CCP + Agent Notes */}
        <div className="shrink-0 space-y-3" style={{ width: 340 }}>
          <div id="ccp-visible-slot" />
          <AgentNotesPanel
            contactId={activeContact?.contactId || null}
            agentUsername={user?.username || ""}
          />
        </div>

        {/* Right column: Tabbed workspace */}
        <div className="flex-1">
          <Tabs defaultValue="transcript" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="transcript">
                Live Transcript
                {activeContact && liveData && liveData.totalSegments > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                    {liveData.totalSegments}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="customer">Customer</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="ai">AI Assist</TabsTrigger>
              <TabsTrigger value="cases">Cases</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="mt-4">
              <LiveTranscriptPanel
                contactId={activeContact?.contactId || null}
                isActive={!!activeContact}
              />
            </TabsContent>

            <TabsContent value="customer" className="mt-4">
              <CustomerProfilePanel
                phone={activeContact?.customerPhone || null}
                isActive={!!activeContact}
              />
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <ContactHistoryPanel
                phone={activeContact?.customerPhone || null}
              />
            </TabsContent>

            <TabsContent value="ai" className="mt-4">
              <AIAssistPanel
                contactId={activeContact?.contactId || null}
                customerPhone={activeContact?.customerPhone || null}
                latestCustomerUtterance={latestCustomerUtterance}
              />
            </TabsContent>

            <TabsContent value="cases" className="mt-4">
              <CasesPanel
                contactId={activeContact?.contactId || null}
                customerPhone={activeContact?.customerPhone || null}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
