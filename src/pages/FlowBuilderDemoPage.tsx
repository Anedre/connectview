import { useState } from "react";
import { Toaster, toast } from "sonner";
import { FlowBuilder } from "@/components/bots/FlowBuilder";
import { defaultBot, type Bot } from "@/lib/botFlow";

/**
 * Standalone, auth-free preview of the visual flow builder (roadmap #16),
 * mounted at /bot-demo OUTSIDE the Connect-login gate so the design can be
 * QA'd / screenshotted without a live CCP session. Local state only — the
 * Save button just toasts. Not linked from nav.
 */
export function FlowBuilderDemoPage() {
  const [bot] = useState<Bot>(() => defaultBot());

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-1)" }}>
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--border-1)",
          fontSize: 11.5,
          color: "var(--text-3)",
          flex: "0 0 auto",
        }}
      >
        ARIA · Constructor de bots <strong style={{ color: "var(--text-2)" }}>(demo)</strong> — estado local, sin red
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <FlowBuilder
          initial={bot}
          onSave={(b) => {
             
            console.log("[bot-demo] save", b);
            toast.success(`Guardado (demo): ${b.nodes.length} pasos, ${b.edges.length} conexiones`);
          }}
        />
      </div>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
