import { useNavigate } from "react-router-dom";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useConnections } from "@/hooks/useConnections";
import * as Icon from "./primitives";

/**
 * OnboardingBanner — barra superior visible solo cuando el tenant todavía no
 * activó BYO Data Plane. Comunica dos cosas críticas:
 *
 *   1. "Estás viendo la app vacía porque tus datos viven en TU cuenta AWS,
 *      no en la nuestra" — alinea expectativa con la decisión de no
 *      almacenar datos del cliente en la instancia de Vox.
 *   2. CTA directo al wizard de Integraciones para empezar.
 *
 * Se oculta cuando: no hay tenant (default = Novasys legacy), o ya activó
 * `dataPlaneEnabled` en su connect config.
 */
export function OnboardingBanner() {
  const { isOnboarding } = useConnectAuth();
  const { config, loading } = useConnections();
  const navigate = useNavigate();

  // Mientras carga, no mostramos nada (evita el flash).
  if (loading) return null;

  const dataPlaneEnabled = !!config?.connect?.dataPlaneEnabled;
  const hasConnect = !!config?.connect?.instanceUrl;

  // No banner para Novasys legacy (isOnboarding=false) ni para tenants que
  // ya activaron el data plane (sus reads/writes van a su cuenta — todo OK).
  if (!isOnboarding && dataPlaneEnabled) return null;
  if (!isOnboarding && !hasConnect) return null;

  // Tres estados del onboarding, mensaje distinto en cada uno:
  const stage = !hasConnect
    ? "connect" // ni siquiera conectó su Amazon Connect
    : !dataPlaneEnabled
      ? "dataplane" // ya conectó Connect, falta activar el data plane
      : "ok";

  if (stage === "ok") return null;

  const copy =
    stage === "connect"
      ? {
          title: "Falta conectar tu Amazon Connect",
          body: "Tus datos viven en TU cuenta AWS, no en la nuestra. Completá el wizard de Integraciones para empezar.",
          cta: "Ir a Integraciones",
        }
      : {
          title: "Activá BYO Data Plane para guardar tus datos",
          body: "ARIA no guarda datos de empresas en su instancia. Aplicá el CFN del paso 4 en tu cuenta y activá el toggle — recién ahí empieza a poblar la app.",
          cta: "Configurar Data Plane",
        };

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 18px",
        margin: "14px 22px 0",
        borderRadius: 10,
        background: "var(--accent-amber-soft)",
        border: "1px solid color-mix(in srgb, var(--accent-amber) 35%, transparent)",
        color: "var(--text-1)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "grid",
          placeItems: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "color-mix(in srgb, var(--accent-amber) 15%, transparent)",
          color: "var(--accent-amber)",
          flex: "0 0 auto",
        }}
      >
        <Icon.Settings size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{copy.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>
          {copy.body}
        </div>
      </div>
      <button
        className="btn btn--sm"
        onClick={() => navigate("/admin")}
        style={{ flex: "0 0 auto", background: "var(--accent-amber)", color: "white", borderColor: "var(--accent-amber)" }}
      >
        <Icon.ChevRight size={12} /> {copy.cta}
      </button>
    </div>
  );
}
