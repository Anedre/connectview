import { PageHeader } from "@/components/vox/PageHeader";
import { RecordingsWorkspace } from "@/components/recordings/RecordingsWorkspace";

/**
 * Historial y Grabaciones — rediseñado como workspace de inteligencia
 * conversacional (#fase1): lista de contactos + detalle con pestañas por canal
 * embebidas (sin modales) + panel de contexto del lead, todo en una sola vista
 * persistente. La estructura tabla → grid → modales quedó atrás.
 */
export function RecordingsPage() {
  return (
    <div className="view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        crumb="Crecimiento"
        title="Historial y Grabaciones"
        sub="Elegí un contacto y revisá toda su actividad: llamadas con audio y transcripción, WhatsApp, emails y archivos — conectado por su nombre, en un solo lugar."
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          marginTop: 4,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <RecordingsWorkspace />
      </div>
    </div>
  );
}
