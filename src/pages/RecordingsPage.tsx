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
    <div className="view" style={{ height: "100%", overflowY: "auto", overflowX: "hidden", paddingBottom: 28 }}>
      <PageHeader
        crumb="Crecimiento"
        title="Historial y Grabaciones"
        sub="Elegí un contacto y revisá toda su actividad: llamadas con audio y transcripción, WhatsApp, emails y archivos — conectado por su nombre, en un solo lugar."
      />
      <div style={{ marginTop: 4 }}>
        <RecordingsWorkspace />
      </div>
    </div>
  );
}
