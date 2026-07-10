import { AICoachPanel } from "@/components/workspace/AICoachPanel";

const MOCK_BLOCKS = {
  blocks: [
    {
      type: "callout",
      tone: "warn",
      text: "Cliente mencionó cancelación — priorizar retención antes de procesar.",
    },
    {
      type: "script",
      title: "Apertura de retención",
      text: "Entiendo tu preocupación, María. Antes de procesar la cancelación, quiero ofrecerte una opción que muchos clientes en tu situación eligieron y quedaron contentos.",
    },
    {
      type: "checklist",
      title: "Antes de cerrar",
      items: [
        "Confirmar datos de contacto actualizados",
        "Ofrecer descuento de retención 20%",
        "Resumir próximos pasos al cliente",
      ],
    },
    {
      type: "table",
      title: "Planes alternativos para María",
      columns: ["Plan", "Precio/mes", "Descuento aplicable"],
      rows: [
        ["Básico", "S/ 49", "20%"],
        ["Plus", "S/ 79", "15%"],
        ["Premium", "S/ 129", "Sin descuento"],
      ],
    },
    {
      type: "action",
      title: "Programar callback con supervisor",
      reason: "Caso requiere autorización superior para descuento >20%",
      cta: {
        label: "Programar +60min",
        kind: "schedule_callback",
        payload: {
          whenMinutes: 60,
          channel: "voice",
          reason: "Escalamiento retención",
        },
      },
    },
    {
      type: "form",
      title: "Capturar motivo de cancelación",
      fields: [
        {
          name: "motivo",
          label: "Motivo principal",
          type: "select",
          options: [
            "Precio muy alto",
            "Mal servicio",
            "Cambio de empresa",
            "No usa el producto",
            "Otro",
          ],
        },
        {
          name: "detalle",
          label: "Detalle (palabras del cliente)",
          type: "textarea",
        },
        {
          name: "email",
          label: "Email de seguimiento",
          type: "email",
        },
      ],
      submitLabel: "Guardar en notas",
    },
  ],
};

/**
 * Smoke-test page for the interactive Coach panel. Renders every block
 * type with mock data so the renderers can be visually QA'd without a
 * live Contact Lens call. Accessed at /coach-demo. Not linked from nav.
 */
export function CoachDemoPage() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "1fr 440px",
        gap: 24,
        height: "100%",
        overflow: "auto",
      }}
    >
      <div>
        <h1 style={{ marginTop: 0 }}>Coach interactivo · demo</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
          Esta página monta el AICoachPanel con bloques mock para verificar cada tipo de renderer.
          Los CTAs llaman a endpoints reales — el de programar callback va a hacer una llamada de
          verdad si lo tocas. El de form persiste en notas del contacto vía save-agent-notes.
        </p>
        <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 16 }}>
          Tipos cubiertos: callout · script · checklist · table · action · form
        </p>
      </div>
      <div className="call__panel" style={{ minHeight: "70vh" }}>
        <div className="call__panel-head" style={{ padding: "12px 14px", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coach · Claude</span>
          <span
            style={{
              marginLeft: "auto",
              background: "var(--accent-violet)",
              color: "white",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 7px",
            }}
          >
            6
          </span>
        </div>
        <div className="call__panel-body" style={{ padding: 14 }}>
          <AICoachPanel
            contactId="demo-coach-contact-id"
            customerPhone="+51953730189"
            transcriptSegmentCount={0}
            isActive={true}
            sentiment="NEGATIVE"
            initialBlocks={MOCK_BLOCKS}
            inline
          />
        </div>
      </div>
    </div>
  );
}
