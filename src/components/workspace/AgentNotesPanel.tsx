import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StickyNote, Sparkles, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAgentNotes } from "@/hooks/useAgentNotes";
import { getApiEndpoints } from "@/lib/api";

interface AgentNotesPanelProps {
  contactId: string | null;
  agentUsername: string;
}

export function AgentNotesPanel({
  contactId,
  agentUsername,
}: AgentNotesPanelProps) {
  const {
    notes,
    wrapUpCode,
    summary,
    saving,
    lastSaved,
    updateNotes,
    updateWrapUpCode,
    updateSummary,
  } = useAgentNotes(contactId, agentUsername);

  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);

  const generateSummary = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;
    setGeneratingSummary(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "summary" }),
      });
      const data = await r.json();
      if (data.result) updateSummary(data.result);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const suggestWrapUp = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;
    setGeneratingCode(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "wrap-up" }),
      });
      const data = await r.json();
      if (data.result) updateWrapUpCode(data.result);
    } finally {
      setGeneratingCode(false);
    }
  };

  if (!contactId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <StickyNote className="h-5 w-5" />
            Agent Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Notes, AI summary, and wrap-up code will appear when a contact is
            active.
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
            <StickyNote className="h-5 w-5" />
            Agent Notes
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {saving && <span>Saving...</span>}
            {!saving && lastSaved && (
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Notes textarea */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Notes (auto-saves)
          </label>
          <textarea
            value={notes}
            onChange={(e) => updateNotes(e.target.value)}
            placeholder="Type notes during the call..."
            rows={6}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* AI Summary */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground">
              Call Summary
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={generateSummary}
              disabled={generatingSummary}
              className="h-7 text-xs"
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {generatingSummary ? "Generating..." : "Generate with AI"}
            </Button>
          </div>
          <textarea
            value={summary}
            onChange={(e) => updateSummary(e.target.value)}
            placeholder="AI-generated summary will appear here after clicking Generate..."
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Wrap-up code */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground">
              Wrap-up Code / Disposition
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={suggestWrapUp}
              disabled={generatingCode}
              className="h-7 text-xs"
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {generatingCode ? "Thinking..." : "Suggest"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={wrapUpCode}
              onChange={(e) => updateWrapUpCode(e.target.value)}
              placeholder="e.g. Billing resolved, Transferred..."
              className="text-sm"
            />
            {wrapUpCode && (
              <Badge variant="secondary" className="self-center whitespace-nowrap">
                {wrapUpCode}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
