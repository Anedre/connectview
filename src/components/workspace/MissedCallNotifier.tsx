import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useMissedContacts } from "@/hooks/useActiveContact";

/**
 * Headless component that fires a toast whenever a brand-new
 * missed-contact entry appears. Sits high in the tree so the agent
 * sees the alert no matter what page they're on (dashboard, reports,
 * etc.) — important because Connect blocks new routed contacts after
 * a miss until the agent returns to Available.
 *
 * Tracks "seen" contact IDs in a ref so a single miss doesn't toast
 * twice on a re-render. The list naturally garbage-collects as the
 * missed contacts expire (30 s TTL).
 */
export function MissedCallNotifier() {
  const { missedContacts } = useMissedContacts();
  const toastedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const missed of missedContacts) {
      if (toastedIdsRef.current.has(missed.contactId)) continue;
      toastedIdsRef.current.add(missed.contactId);

      // Pretty-print the channel + customer for the toast body.
      const ch = (missed.channel || "VOICE").toUpperCase();
      const channelLabel =
        ch === "VOICE"
          ? "Llamada"
          : ch === "CHAT"
          ? "Chat"
          : ch === "EMAIL"
          ? "Email"
          : ch === "TASK"
          ? "Tarea"
          : ch;
      const who =
        missed.customerPhone ||
        missed.queueName ||
        missed.attributes?.udep_intent ||
        "cliente desconocido";

      toast.error(`${channelLabel} perdida`, {
        description: `De ${who} · Connect te puso en estado bloqueado`,
        duration: 8000,
      });
    }

    // Prune toasted ids that are no longer in the missed list (their
    // TTL expired). Keeps the set bounded so we don't leak memory
    // over a long shift.
    if (toastedIdsRef.current.size > 0) {
      const stillPresent = new Set(missedContacts.map((m) => m.contactId));
      for (const id of toastedIdsRef.current) {
        if (!stillPresent.has(id)) toastedIdsRef.current.delete(id);
      }
    }
  }, [missedContacts]);

  return null;
}
