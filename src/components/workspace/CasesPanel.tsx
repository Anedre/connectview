import { useConnectAuth } from "@/context/ConnectAuthContext";
import * as Icon from "@/components/vox/primitives";

interface CasesPanelProps {
  contactId: string | null;
  customerPhone: string | null;
}

export function CasesPanel({ contactId, customerPhone }: CasesPanelProps) {
  const { instanceUrl } = useConnectAuth();
  const openCasesInConnect = () => {
    window.open(`${instanceUrl}/connect/cases/case`, "_blank");
  };

  if (!customerPhone) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <Icon.Ticket size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Los casos estarán disponibles cuando haya un contacto activo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="spread">
        <span className="section-title" style={{ margin: 0 }}>
          Casos del cliente
        </span>
        {contactId && (
          <span className="chip chip--green">
            <span className="dot" /> Contacto activo
          </span>
        )}
      </div>

      <div
        className="row"
        style={{
          padding: "10px 12px",
          background: "var(--bg-2)",
          borderRadius: 8,
          border: "1px solid var(--border-1)",
        }}
      >
        <Icon.Phone size={13} style={{ color: "var(--text-3)" }} />
        <span className="mono" style={{ fontSize: 12 }}>
          {customerPhone}
        </span>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn--primary btn--sm" onClick={openCasesInConnect}>
          <Icon.Plus size={12} /> Nuevo caso
        </button>
        <button className="btn btn--ghost btn--sm" onClick={openCasesInConnect}>
          <Icon.Send size={12} /> Abrir en Connect
        </button>
      </div>

      <div
        className="muted"
        style={{
          fontSize: 11.5,
          padding: 12,
          background: "var(--accent-violet-soft)",
          borderRadius: 8,
          color: "var(--accent-violet)",
          lineHeight: 1.5,
        }}
      >
        <strong>Amazon Connect Cases</strong> — La creación y gestión del
        historial de casos se sincroniza desde Connect.
      </div>
    </div>
  );
}
