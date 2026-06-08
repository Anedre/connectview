import { WrapUpView } from "@/components/vox/WrapUpView";

/**
 * Smoke-test page for the AI auto-classification in the wrap-up screen.
 * Seeds a suggestion directly (no live call needed) so the suggestion
 * banner + "IA" badges on the matching stage/subStage can be QA'd.
 * Accessed at /wrapup-demo. Not linked from nav.
 *
 * The real flow: when a call ends, WrapUpView fetches the suggestion from
 * generate-call-summary (mode=wrap-up-suggest) using the live transcript +
 * the active taxonomy, and auto-applies the pick. This page short-circuits
 * that fetch with a canned suggestion that matches the UDEP default tree.
 */
export function WrapUpDemoPage() {
  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <WrapUpView
        contactId="demo-wrapup-contact-id"
        customerPhone="+51953730189"
        queueName="UDEP-Pregrado"
        durationSeconds={184}
        channel="VOICE"
        onFinish={() => {}}
        initialSuggestion={{
          stageId: "no_interesado",
          subStageId: "economico_precio",
          valoracion: "negativa",
          confidence: 82,
          reason:
            "Cliente rechaza la oferta: 'el precio se me escapa', decide no continuar por costo.",
        }}
      />
    </div>
  );
}
