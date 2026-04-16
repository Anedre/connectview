import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Phone, Clock, FileText, MessageSquare } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface ContactPanelProps {
  isActive: boolean;
}

// Mock customer data - in production this would come from a CRM API or Connect attributes
const mockCustomer = {
  name: "Carlos Rodriguez",
  email: "carlos.rodriguez@example.com",
  phone: "+1 (555) 123-4567",
  accountId: "AC-12345",
  tier: "Premium",
  totalContacts: 8,
  lastContact: "2026-04-10",
  notes: "Preferred language: Spanish. VIP customer since 2024.",
  recentInteractions: [
    { date: "Apr 10", type: "VOICE", summary: "Billing inquiry - resolved", sentiment: "POSITIVE" },
    { date: "Apr 3", type: "CHAT", summary: "Password reset request", sentiment: "NEUTRAL" },
    { date: "Mar 28", type: "VOICE", summary: "Service complaint - escalated", sentiment: "NEGATIVE" },
  ],
};

const SENTIMENT_DOTS: Record<string, string> = {
  POSITIVE: "bg-green-500",
  NEGATIVE: "bg-red-500",
  NEUTRAL: "bg-gray-400",
};

export function ContactPanel({ isActive }: ContactPanelProps) {
  if (!isActive) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Contact Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Customer information will appear here when a contact is active.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Customer Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Customer Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">{mockCustomer.name}</span>
            <Badge className="bg-purple-100 text-purple-800">
              {mockCustomer.tier}
            </Badge>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3 w-3" />
              {mockCustomer.phone}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {mockCustomer.email}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-3 w-3" />
              Account: {mockCustomer.accountId}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {mockCustomer.totalContacts} previous contacts
            </div>
          </div>
          {mockCustomer.notes && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground italic">
                {mockCustomer.notes}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {mockCustomer.recentInteractions.map((interaction, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className={`mt-1.5 h-2 w-2 rounded-full ${
                    SENTIMENT_DOTS[interaction.sentiment]
                  }`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {interaction.date}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {interaction.type}
                    </Badge>
                  </div>
                  <p className="text-sm">{interaction.summary}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
