import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as Icon from "./primitives";

/**
 * NotIntegrated — estado vacío para páginas que dependen de una fuente de datos
 * (base de datos BYO / Salesforce) que el tenant TODAVÍA no conectó.
 *
 * Distinto de "no hay registros aún": esto comunica que falta INTEGRAR la
 * fuente, no que esté integrada y vacía. CTA directo al wizard de Integraciones.
 */
export function NotIntegrated({
  title,
  message,
  ctaLabel = "Conectar en Integraciones",
  icon,
  secondary,
}: {
  title: string;
  message: string;
  ctaLabel?: string;
  icon?: ReactNode;
  /** Acción opcional extra (p.ej. "Crear manual") a la derecha del CTA. */
  secondary?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="card"
      style={{ padding: "56px 24px", textAlign: "center", color: "var(--text-3)" }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          margin: "0 auto 16px",
          borderRadius: 15,
          display: "grid",
          placeItems: "center",
          background: "var(--accent-amber-soft)",
          color: "var(--accent-amber)",
        }}
      >
        {icon || <Icon.Cloud size={26} />}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>{title}</div>
      <div
        style={{
          fontSize: 13,
          marginTop: 6,
          marginBottom: 18,
          maxWidth: 440,
          marginInline: "auto",
          lineHeight: 1.55,
        }}
      >
        {message}
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "center" }}>
        <button className="btn btn--primary" onClick={() => navigate("/admin")}>
          <Icon.Lightning size={14} /> {ctaLabel}
        </button>
        {secondary}
      </div>
    </div>
  );
}
