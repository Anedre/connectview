import { useEffect, useRef, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import type { ChatMessage } from "@/hooks/useChatSession";

/**
 * SuggestedReplies — proactive reply chips above the chat composer. When the
 * last message is from the customer and the agent hasn't started typing,
 * Claude proposes 2-3 ready-to-send replies (generate-call-summary
 * mode=suggest-replies). Clicking a chip drops it into the draft. Roadmap #20.
 */
interface Props {
  messages: ChatMessage[];
  customerName?: string;
  disabled?: boolean;
  /** Only suggest when the agent hasn't started a draft (don't interrupt). */
  draftEmpty: boolean;
  onPick: (text: string) => void;
}

export function SuggestedReplies({
  messages,
  customerName,
  disabled,
  draftEmpty,
  onPick,
}: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchKey = useRef<string>("");

  // The most recent real (non-system) message.
  const lastMsg = [...messages]
    .reverse()
    .find((m) => m.participantRole === "AGENT" || m.participantRole === "CUSTOMER");
  const lastIsCustomer = lastMsg?.participantRole === "CUSTOMER";
  // A key that changes when a new customer message arrives.
  const fetchKey = lastIsCustomer ? `${lastMsg?.id}:${lastMsg?.content?.slice(0, 40)}` : "";

  useEffect(() => {
    // Clear when the agent took over (last msg is theirs) or started typing.
    if (!lastIsCustomer || !draftEmpty || disabled) {
      setSuggestions([]);
      return;
    }
    if (!fetchKey || fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;

    // Build a compact recent-context window (last 6 real messages).
    const recent = messages
      .filter((m) => m.participantRole === "AGENT" || m.participantRole === "CUSTOMER")
      .slice(-6)
      .map((m) => `${m.participantRole === "CUSTOMER" ? "CLIENTE" : "AGENTE"}: ${m.content}`)
      .join("\n");

    setLoading(true);
    fetch(endpoints.generateCallSummary, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "suggest-replies",
        context: recent,
        customerName: customerName || "el cliente",
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d?.result) ? d.result : [];
        setSuggestions(arr.filter((x: unknown) => typeof x === "string"));
      })
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, draftEmpty, disabled, lastIsCustomer]);

  if (disabled || !lastIsCustomer || !draftEmpty) return null;
  if (!loading && suggestions.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
        marginBottom: 8,
        paddingLeft: 2,
      }}
    >
      <span
        className="muted"
        style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}
      >
        <Icon.Sparkles size={11} style={{ color: "var(--accent-violet)" }} />
        {loading ? "Sugiriendo…" : "Sugerencias:"}
      </span>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onPick(s)}
          title="Usar esta respuesta"
          style={{
            border: "1px solid var(--accent-violet)",
            background: "var(--accent-violet-soft, rgba(99,102,241,0.08))",
            color: "var(--text-1)",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: 12,
            cursor: "pointer",
            maxWidth: 360,
            textAlign: "left",
            lineHeight: 1.35,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
