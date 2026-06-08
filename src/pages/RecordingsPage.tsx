import { useState } from "react";
import { PageHeader } from "@/components/vox/PageHeader";
import { RecentContactsTable, type RecentLead } from "@/components/recordings/RecentContactsTable";
import { Lead360View } from "@/components/recordings/Lead360View";

/**
 * Historial y Grabaciones — master-detail de UNA sola fuente (los leads, por su
 * NOMBRE). Landing = tabla de contacto reciente; clic en un lead → vista Lead
 * 360 con tarjetas por canal (Historial, Llamadas, WhatsApp, Emails, Archivos)
 * y su detalle expandible. Sin sidebar inconsistente ni barra de tabs: toda la
 * info del lead en un solo lugar.
 */
export function RecordingsPage() {
  const [lead, setLead] = useState<RecentLead | null>(null);

  return (
    <div className="view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        crumb="Crecimiento"
        title="Historial y Grabaciones"
        sub="Historial del lead conectado por su nombre: clic en un lead para ver su actividad, llamadas con audio, WhatsApp, emails y archivos — todo en un solo lugar."
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
          display: "flex",
          flexDirection: "column",
        }}
      >
        {lead ? (
          <Lead360View lead={lead} onBack={() => setLead(null)} />
        ) : (
          <RecentContactsTable onSelect={setLead} selectedPhone={null} />
        )}
      </div>
    </div>
  );
}
