import { HeroBand } from "@/components/aria";
import { RecordingsWorkspace } from "@/components/recordings/RecordingsWorkspace";

/**
 * Historial y Grabaciones — rediseñado como workspace de inteligencia
 * conversacional (#fase1): lista de contactos + detalle con pestañas por canal
 * embebidas (sin modales) + panel de contexto del lead, todo en una sola vista
 * persistente. La estructura tabla → grid → modales quedó atrás.
 *
 * Reskin ARIA: el encabezado ahora es un `HeroBand` premium; el workspace real
 * (hooks de audio/transcripción/contacto) vive intacto debajo.
 */
export function RecordingsPage() {
  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <HeroBand
        title="Grabaciones e historial"
        chip="Expediente 360° · llamadas, WhatsApp, emails y archivos por contacto"
        chipIcon="mic"
        chipTone="var(--cyan)"
      />
      <RecordingsWorkspace />
    </div>
  );
}
