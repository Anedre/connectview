import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Ticket, Plus, ExternalLink } from "lucide-react";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";

interface CasesPanelProps {
  contactId: string | null;
  customerPhone: string | null;
}

export function CasesPanel({ contactId, customerPhone }: CasesPanelProps) {
  const openCasesInConnect = () => {
    window.open(`${CONNECT_INSTANCE_URL}/connect/cases/case`, "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ticket className="h-5 w-5" />
          Cases
          {contactId && (
            <Badge variant="secondary" className="ml-auto text-xs">
              Active contact
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {customerPhone ? (
          <>
            <p className="text-sm text-muted-foreground">
              Customer: <span className="font-mono">{customerPhone}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={openCasesInConnect}>
                <Plus className="mr-2 h-4 w-4" />
                New Case
              </Button>
              <Button variant="ghost" size="sm" onClick={openCasesInConnect}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in Connect
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Case creation and history management via Amazon Connect Cases.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cases will be available when a contact is active.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
