import { useState, useEffect, useRef, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

const AUTO_SAVE_MS = 2000;

interface AgentNotesData {
  notes: string;
  wrapUpCode: string;
  summary: string;
}

export function useAgentNotes(contactId: string | null, agentUsername: string) {
  const [notes, setNotes] = useState("");
  const [wrapUpCode, setWrapUpCode] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load existing notes when contact changes
  useEffect(() => {
    if (!contactId) {
      setNotes("");
      setWrapUpCode("");
      setSummary("");
      return;
    }

    const endpoints = getApiEndpoints();
    if (!endpoints?.saveAgentNotes) return;

    fetch(
      `${endpoints.saveAgentNotes}?contactId=${encodeURIComponent(contactId)}`
    )
      .then((r) => r.json())
      .then((data: AgentNotesData) => {
        setNotes(data.notes || "");
        setWrapUpCode(data.wrapUpCode || "");
        setSummary(data.summary || "");
      })
      .catch(() => {
        // ignore
      });
  }, [contactId]);

  const saveNow = useCallback(
    async (
      updates: Partial<{ notes: string; wrapUpCode: string; summary: string }>
    ) => {
      if (!contactId) return;
      const endpoints = getApiEndpoints();
      if (!endpoints?.saveAgentNotes) return;

      setSaving(true);
      try {
        await fetch(endpoints.saveAgentNotes, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId,
            agentUsername,
            ...updates,
          }),
        });
        setLastSaved(new Date());
      } finally {
        setSaving(false);
      }
    },
    [contactId, agentUsername]
  );

  // Debounced auto-save when notes change
  const updateNotes = useCallback(
    (newNotes: string) => {
      setNotes(newNotes);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveNow({ notes: newNotes });
      }, AUTO_SAVE_MS);
    },
    [saveNow]
  );

  const updateWrapUpCode = useCallback(
    (code: string) => {
      setWrapUpCode(code);
      saveNow({ wrapUpCode: code });
    },
    [saveNow]
  );

  const updateSummary = useCallback(
    (s: string) => {
      setSummary(s);
      saveNow({ summary: s });
    },
    [saveNow]
  );

  return {
    notes,
    wrapUpCode,
    summary,
    saving,
    lastSaved,
    updateNotes,
    updateWrapUpCode,
    updateSummary,
  };
}
