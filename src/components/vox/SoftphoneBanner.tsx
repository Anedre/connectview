import { useEffect, useState, type ReactNode } from "react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCCP } from "@/context/CCPContext";
import * as Icon from "./primitives";

/**
 * SoftphoneBanner — prompt NO bloqueante relacionado al softphone de Amazon Connect.
 * Dos modos:
 *
 *  1. Login (dueña del softphone, aún sin autenticar): ofrece iniciar sesión en
 *     Connect. Reemplaza, sin bloquear la app, a la vieja LoginScreen. Es además el
 *     PUNTO DE ENTRADA de la confirmación del vínculo Vox↔Connect (capa 2).
 *
 *  2. Multi-pestaña (esta pestaña es "secundaria"): otra pestaña de ARIA ya maneja
 *     el softphone. El CCP de Connect solo puede vivir en UNA pestaña (pelean el
 *     "master" del SharedWorker y se cuelgan). En vez de un "Conectando…" infinito,
 *     avisamos claro y ofrecemos "Usar acá" para el traspaso limpio.
 */
export function SoftphoneBanner() {
  const { isOnboarding, instanceUrl, softphoneTabRole, takeOverSoftphone } = useConnectAuth();
  const { isInitialized } = useCCP();
  const [grace, setGrace] = useState(false);

  useEffect(() => {
    // Gracia: el CCP tarda unos segundos en autenticar si YA hay sesión de
    // Connect. No mostramos el banner de login hasta pasada la ventana, para no
    // parpadear en el arranque normal.
    const t = setTimeout(() => setGrace(true), 9000);
    return () => clearTimeout(t);
  }, []);

  if (isOnboarding) return null; // sin Connect configurado → lo cubre OnboardingBanner
  if (!instanceUrl) return null;

  // ── Modo multi-pestaña ────────────────────────────────────────────────────
  // Esta pestaña es secundaria a propósito (otra ya tiene el softphone). Lo
  // mostramos de una (sin esperar la gracia): sabemos que NO va a inicializar acá.
  if (softphoneTabRole === "secondary") {
    return (
      <BannerShell tone="info" icon={<Icon.Copy size={16} />}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>
            El softphone está activo en otra pestaña
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-2)",
              marginTop: 2,
              lineHeight: 1.45,
            }}
          >
            Amazon Connect maneja el teléfono en <b>una sola pestaña</b>. Podés seguir usando ARIA
            acá; para traer el softphone a esta pestaña, tocá «Usar acá».
          </div>
        </div>
        <button
          className="btn btn--sm btn--primary"
          onClick={takeOverSoftphone}
          style={{ flex: "0 0 auto" }}
          title="Mueve el softphone a esta pestaña. Recarga para reconectar el teléfono acá."
        >
          <Icon.Headset size={12} /> Usar acá
        </button>
      </BannerShell>
    );
  }

  // ── Modo login ────────────────────────────────────────────────────────────
  if (isInitialized) return null; // softphone conectado → nada que mostrar
  if (!grace) return null;

  const openLogin = () => window.open(`${instanceUrl}/connect/ccp-v2`, "_blank", "noopener");

  return (
    <BannerShell tone="warm" icon={<Icon.Headset size={16} />}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Conectá tu Amazon Connect</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-2)",
            marginTop: 2,
            lineHeight: 1.45,
          }}
        >
          Iniciá sesión para activar tu teléfono y <b>confirmar tu agente asignado</b>. Tus
          credenciales las ponés en la página de Connect — ARIA nunca las ve.
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
      <button className="btn btn--sm btn--primary" onClick={openLogin} style={{ flex: "0 0 auto" }}>
        <Icon.Headset size={12} /> Iniciar sesión en Connect
      </button>
    </BannerShell>
  );
}

/** Contenedor común del banner. `tone` define el color: "warm" (naranja, acción
 *  de login) o "info" (cian neutro, aviso multi-pestaña). */
function BannerShell({
  tone,
  icon,
  children,
}: {
  tone: "warm" | "info";
  icon: ReactNode;
  children: ReactNode;
}) {
  const cyan = "var(--accent-cyan)";
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
        border: `1px solid color-mix(in srgb, ${cyan} 35%, transparent)`,
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
          background: `color-mix(in srgb, ${cyan} 15%, transparent)`,
          color: tone === "warm" ? "#FF9900" : cyan,
          flex: "0 0 auto",
        }}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}
