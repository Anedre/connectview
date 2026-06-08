import { useEffect, useState } from "react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCCP } from "@/context/CCPContext";
import * as Icon from "./primitives";

/**
 * SoftphoneBanner — prompt NO bloqueante para iniciar sesión en Amazon Connect
 * cuando el softphone del usuario todavía no está conectado.
 *
 * Reemplaza, sin bloquear la app, a la vieja LoginScreen de Connect (que se
 * quitó con la identidad Vox-first). Es además el PUNTO DE ENTRADA de la
 * confirmación del vínculo Vox↔Connect (capa 2): cuando el agente se loguea
 * acá, el CCP captura su username real y —si coincide con lo que el admin le
 * asignó— queda confirmado. Las credenciales se ponen en la página de Connect;
 * ARIA nunca las ve.
 *
 * Se muestra cuando: el tenant tiene Connect configurado (no onboarding) y el
 * softphone todavía no autenticó (isInitialized=false), tras una gracia inicial
 * para no parpadear durante el arranque normal del CCP.
 */
export function SoftphoneBanner() {
  const { isOnboarding, instanceUrl } = useConnectAuth();
  const { isInitialized } = useCCP();
  const [grace, setGrace] = useState(false);

  useEffect(() => {
    // Gracia: el CCP tarda unos segundos en autenticar si YA hay sesión de
    // Connect. No mostramos el banner hasta pasada la ventana, para no
    // parpadear en el arranque normal.
    const t = setTimeout(() => setGrace(true), 9000);
    return () => clearTimeout(t);
  }, []);

  if (isOnboarding) return null;   // sin Connect configurado → lo cubre OnboardingBanner
  if (isInitialized) return null;  // softphone conectado → nada que mostrar
  if (!grace || !instanceUrl) return null;

  const openLogin = () =>
    window.open(`${instanceUrl}/connect/ccp-v2`, "_blank", "noopener");

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
        background: "var(--accent-cyan-soft)",
        border: "1px solid color-mix(in srgb, var(--accent-cyan) 35%, transparent)",
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
          background: "color-mix(in srgb, var(--accent-cyan) 15%, transparent)",
          color: "#FF9900",
          flex: "0 0 auto",
        }}
      >
        <Icon.Headset size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
          Conectá tu Amazon Connect
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>
          Iniciá sesión para activar tu teléfono y <b>confirmar tu agente asignado</b>.
          Tus credenciales las ponés en la página de Connect — ARIA nunca las ve.
        </div>
      </div>
      <button
        className="btn btn--sm"
        onClick={() => window.location.reload()}
        style={{ flex: "0 0 auto" }}
        title="Si ya iniciaste sesión en Connect en otra pestaña, recargá para conectar el softphone."
      >
        Ya inicié sesión · recargar
      </button>
      <button
        className="btn btn--sm btn--primary"
        onClick={openLogin}
        style={{ flex: "0 0 auto" }}
      >
        <Icon.Headset size={12} /> Iniciar sesión en Connect
      </button>
    </div>
  );
}
