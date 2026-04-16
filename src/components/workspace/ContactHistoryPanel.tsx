import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, Phone, MessageSquare, Mail, CheckSquare } from "lucide-react";
import { useContactHistory } from "@/hooks/useContactHistory";
import { formatDistanceToNow, format } from "date-fns";

interface ContactHistoryPanelProps {
  phone: string | null;
}

const CHANNEL_ICON: Record<string, React.ElementType> = {
  VOICE: Phone,
  CHAT: MessageSquare,
  EMAIL: Mail,
  TASK: CheckSquare,
};

const CHANNEL_COLOR: Record<string, string> = {
  VOICE: "text-blue-600",
  CHAT: "text-green-600",
  EMAIL: "text-purple-600",
  TASK: "text-orange-600",
};

function formatDuration(seconds: number): string {
  if (!seconds) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function ContactHistoryPanel({ phone }: ContactHistoryPanelProps) {
  const { contacts, loading, error } = useContactHistory(phone);

  if (!phone) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Contact History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Customer history will appear when a contact is active.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Contact History
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {contacts.length} contacts · last 90 days
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading history...
          </p>
        )}
        {error && !loading && (
          <p className="text-sm text-red-600">Error: {error}</p>
        )}
        {!loading && !error && contacts.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No previous contacts for {phone}. First-time caller.
          </p>
        )}
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {contacts.map((contact) => {
            const Icon = CHANNEL_ICON[contact.channel] || Phone;
            const colorClass = CHANNEL_COLOR[contact.channel] || "text-gray-600";
            return (
              <div
                key={contact.contactId}
                className="flex gap-3 rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
              >
                <Icon className={`h-5 w-5 shrink-0 mt-1 ${colorClass}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {contact.channel}
                      </Badge>
                      <span className="text-sm font-medium">
                        {formatDistanceToNow(
                          new Date(contact.initiationTimestamp),
                          { addSuffix: true }
                        )}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(contact.duration)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    <div>
                      {format(
                        new Date(contact.initiationTimestamp),
                        "MMM dd, yyyy HH:mm"
                      )}
                    </div>
                    {contact.agentUsername && (
                      <div>Agent: {contact.agentUsername}</div>
                    )}
                    {contact.disconnectReason && (
                      <div>Disconnect: {contact.disconnectReason}</div>
                    )}
                  </div>
                  <div className="mt-1 flex gap-1">
                    {contact.hasRecording && (
                      <Badge variant="secondary" className="text-xs">
                        Recording
                      </Badge>
                    )}
                    {contact.initiationMethod && (
                      <Badge variant="outline" className="text-xs">
                        {contact.initiationMethod}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
