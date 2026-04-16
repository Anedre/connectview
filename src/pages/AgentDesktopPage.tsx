import { CCPContainer } from "@/components/ccp/CCPContainer";
import { ContactPanel } from "@/components/crm/ContactPanel";
import { useCCP } from "@/hooks/useCCP";

export function AgentDesktopPage() {
  const { agentState } = useCCP();
  const isOnCall = agentState === "Busy" || agentState === "CallingCustomer";

  return (
    <div className="flex gap-6">
      <div className="shrink-0">
        <CCPContainer />
      </div>

      <div className="flex-1">
        <ContactPanel isActive={isOnCall} />
      </div>
    </div>
  );
}
