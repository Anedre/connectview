import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { fetchAuthSession, signInWithRedirect, signOut as amplifySignOut } from "aws-amplify/auth";
import { I18n } from "aws-amplify/utils";
import { getApiEndpoints } from "@/lib/api";
import { SplineScene } from "@/components/fx";
import outputs from "../../amplify_outputs.json";

/* Escena 3D de Spline para el hero del login (opcional). Se activa poniendo
 * la URL .splinecode (Export → Code → React en el editor de Spline) en
 * VITE_SPLINE_LOGIN_SCENE; sin ella, queda la aurora de siempre. El runtime
 * se carga lazy y solo en desktop (el hero se oculta en mobile). */
const SPLINE_LOGIN_SCENE = (import.meta.env.VITE_SPLINE_LOGIN_SCENE as string | undefined) || "";

/**
 * F4.3 — SSO federado. El bloque `auth.oauth` en amplify_outputs SOLO existe tras
 * `ampx pipeline-deploy` con `externalProviders` (ver amplify/auth/resource.ts).
 * Mientras no exista → `hasSso` es false → el botón "Entrar con tu empresa" NO se
 * muestra (el gate Cognito clásico queda intacto). Cuando exista, tomamos el nombre
 * del IdP custom (SAML/OIDC) — excluyendo los sociales — para `signInWithRedirect`.
 */
const SOCIAL_PROVIDERS = ["GOOGLE", "FACEBOOK", "AMAZON", "APPLE", "SIGN_IN_WITH_APPLE"];
const oauthCfg = (outputs.auth as { oauth?: { identity_providers?: string[] } }).oauth;
const ssoProviderName = (oauthCfg?.identity_providers ?? []).find(
  (p) => !SOCIAL_PROVIDERS.includes(p),
);
const hasSso = !!ssoProviderName;

async function startSso() {
  if (!ssoProviderName) return;
  try {
    await signInWithRedirect({ provider: { custom: ssoProviderName } });
  } catch {
    /* el usuario canceló o el IdP falló — el Authenticator sigue disponible */
  }
}

/* Spanish translations for the Amplify Authenticator. Matches the
 * Login.html design copy (Iniciar sesión / Crear cuenta / Bienvenido…). */
I18n.putVocabularies({
  es: {
    "Sign In": "Iniciar sesión",
    "Sign in": "Iniciar sesión",
    "Sign in to your account": "Bienvenido de nuevo",
    "Create Account": "Crear cuenta",
    "Create a new account": "Crea tu cuenta",
    "Creating Account": "Creando cuenta…",
    "Signing in": "Verificando…",
    Email: "Correo electrónico",
    "Enter your Email": "tu@empresa.com",
    "Please confirm your Email": "Confirma tu correo",
    Password: "Contraseña",
    "Enter your Password": "••••••••",
    "Please confirm your Password": "••••••••",
    "Confirm Password": "Confirmar contraseña",
    "Forgot your password?": "¿Olvidaste tu contraseña?",
    "Reset your password": "Restablece tu contraseña",
    "Reset Password": "Restablecer contraseña",
    "Send code": "Enviar código",
    "Send Code": "Enviar código",
    "Resend Code": "Reenviar código",
    "Back to Sign In": "Volver al inicio",
    Submit: "Enviar",
    Code: "Código",
    "Confirmation Code": "Código de verificación",
    "Enter your code": "Ingresa el código",
    "Enter your Confirmation Code": "Ingresa el código",
    "New Password": "Nueva contraseña",
    "Enter your new password": "Ingresa tu nueva contraseña",
    "Confirm a Code": "Confirma el código",
    "Confirm Sign Up": "Confirmar registro",
    "Account recovery requires verified contact information":
      "La recuperación de cuenta requiere información de contacto verificada",
    "User does not exist": "Esta cuenta no existe",
    "Incorrect username or password": "Correo o contraseña incorrectos",
    "Invalid password format": "Formato de contraseña inválido",
    "Username cannot be empty": "El correo es obligatorio",
    "Password cannot be empty": "La contraseña es obligatoria",
    "Your code is on the way. To log in, enter the code we emailed to":
      "Te enviamos un código por correo a",
    "It may take a minute to arrive.": "Puede tardar un minuto en llegar.",
  },
});
I18n.setLanguage("es");

/**
 * VoxAuthContext — capa de identidad de Vox (Cognito), el PORTÓN del SaaS.
 *
 * Es ADITIVA: envuelve la app por fuera. El SSO de Connect y todo lo de adentro
 * siguen igual (el Agent Desktop usa su CCP). Aquí resolvemos:
 *   · login propio de Vox (Authenticator de Amplify)
 *   · la identidad + tenantId (de los claims del ID token)
 *   · provisión de organización en el primer login (si no hay tenantId)
 */
interface VoxIdentity {
  email?: string;
  username?: string;
  tenantId?: string;
  groups: string[];
  sub?: string;
}
interface VoxAuthValue extends VoxIdentity {
  idToken: string | null;
  loading: boolean;
  signOut: () => void;
}

const Ctx = createContext<VoxAuthValue | null>(null);

function VoxAuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<VoxIdentity>(() => ({ groups: [] }));
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (forceRefresh = false) => {
    try {
      const session = await fetchAuthSession({ forceRefresh });
      const idt = session.tokens?.idToken;
      if (!idt) return;
      const p = idt.payload as Record<string, unknown>;
      setIdToken(idt.toString());
      setIdentity({
        email: typeof p.email === "string" ? p.email : undefined,
        username:
          typeof p["cognito:username"] === "string" ? (p["cognito:username"] as string) : undefined,
        tenantId:
          typeof p["custom:tenantId"] === "string" ? (p["custom:tenantId"] as string) : undefined,
        groups: (p["cognito:groups"] as string[] | undefined) || [],
        sub: typeof p.sub === "string" ? p.sub : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Provisión de org en el primer login: si está autenticado pero sin tenantId,
  // creamos su organización y refrescamos el token (que ahora trae el tenantId).
  useEffect(() => {
    if (loading || !idToken || identity.tenantId) return;
    const ep = getApiEndpoints();
    if (!ep?.provisionTenant) return; // sin backend de provisión aún → queda en "default"
    const provisionUrl = ep.provisionTenant;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(provisionUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (r.ok && !cancelled) await load(true);
      } catch {
        /* reintenta en el próximo login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, idToken, identity.tenantId, load]);

  const signOut = useCallback(() => {
    void amplifySignOut();
  }, []);

  return <Ctx.Provider value={{ ...identity, idToken, loading, signOut }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- contexto + hook conviven (igual que ConnectAuthContext)
export function useVoxAuth(): VoxAuthValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useVoxAuth debe usarse dentro de VoxAuthGate");
  return c;
}

/* ---- hero icons (inline SVG so they render in any environment) ---- */
function FeatPhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}
function FeatAiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.5 4L17 8.5 13.5 10 12 14l-1.5-4L7 8.5 10.5 7z" />
      <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z" />
    </svg>
  );
}
function FeatOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11v2l11 5V6L3 11z" />
      <path d="M14 8a3 3 0 0 1 0 8" />
    </svg>
  );
}
function FeatChartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5M4 19h16" />
      <rect x="7" y="12" width="3" height="7" />
      <rect x="12" y="8" width="3" height="11" />
      <rect x="17" y="5" width="3" height="14" />
    </svg>
  );
}

/**
 * Hero panel a la izquierda del formulario en desktop. Implementa el
 * diseño "Login.html" de Claude Design: aurora animada (3 blobs en
 * gradiente), brand lockup, pitch con título degradado, features con
 * íconos de color, trust badges y copyright.
 *
 * En mobile (<860px) se oculta vía CSS — la card del Authenticator pasa
 * a ocupar toda la pantalla.
 */
function VoxAuthHeader() {
  return (
    <div className="vox-auth__hero">
      {/* animated aurora background */}
      <div aria-hidden className="vox-auth__aurora">
        <span className="a1" />
        <span className="a2" />
        <span className="a3" />
      </div>
      <SplineScene scene={SPLINE_LOGIN_SCENE} className="vox-auth__spline" />
      <div aria-hidden className="vox-auth__grain" />

      {/* brand row */}
      <div className="vox-auth__brand">
        <div className="vox-auth__brand-tile fx-float">
          <img src="/brand/aria-mark-white.png" alt="" />
        </div>
        <div className="vox-auth__brand-lockup">
          <span className="vox-auth__brand-name">ARIA</span>
          <span className="vox-auth__brand-tag">BY NOVASYS</span>
        </div>
      </div>

      {/* pitch */}
      <div className="vox-auth__pitch">
        <span className="vox-auth__pill">
          <span aria-hidden className="vox-auth__pill-dot" />
          Plataforma de contact center
        </span>
        <h1 className="vox-auth__title">
          El espacio de trabajo del{" "}
          <span className="vox-auth__title-grad fx-gradient-x">agente moderno</span>.
        </h1>
        <p className="vox-auth__sub">
          Llamadas, WhatsApp, leads y campañas — todo en una sola pantalla, potenciado por Amazon
          Connect.
        </p>
        <ul className="vox-auth__features">
          <li className="vox-auth__feature">
            <span className="vox-auth__feature-icon vox-auth__feature-icon--phone">
              <FeatPhoneIcon />
            </span>
            <span className="vox-auth__feature-label">Softphone integrado con Amazon Connect</span>
          </li>
          <li className="vox-auth__feature">
            <span className="vox-auth__feature-icon vox-auth__feature-icon--ai">
              <FeatAiIcon />
            </span>
            <span className="vox-auth__feature-label">Coach en vivo y resumen automático</span>
          </li>
          <li className="vox-auth__feature">
            <span className="vox-auth__feature-icon vox-auth__feature-icon--out">
              <FeatOutIcon />
            </span>
            <span className="vox-auth__feature-label">Campañas outbound multicanal</span>
          </li>
          <li className="vox-auth__feature">
            <span className="vox-auth__feature-icon vox-auth__feature-icon--chart">
              <FeatChartIcon />
            </span>
            <span className="vox-auth__feature-label">Reportes y monitoreo en tiempo real</span>
          </li>
        </ul>

        <div className="vox-auth__trust">
          <div className="vox-auth__avs">
            <div aria-hidden className="vox-auth__avs-stack">
              <i />
              <i />
              <i />
              <i />
            </div>
            <span>+2,400 agentes activos hoy</span>
          </div>
          <span aria-hidden className="vox-auth__trust-sep" />
          <span>99.98% uptime</span>
        </div>
      </div>

      {/* copyright */}
      <div className="vox-auth__copyright">
        © {new Date().getFullYear()} Novasys · Construido sobre Amazon Connect
      </div>
    </div>
  );
}

/**
 * Botón de SSO federado bajo el formulario de "Iniciar sesión". Solo se renderiza
 * si hay un IdP configurado (`hasSso`) — antes del `ampx pipeline-deploy` real no
 * aparece. Separador "o" + botón que dispara `signInWithRedirect` al IdP del tenant.
 */
function SsoSignInSlot() {
  if (!hasSso) return null;
  return (
    <div style={{ padding: "0 0 4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "6px 0 14px",
          color: "var(--text-3, #8a93a6)",
          fontSize: 11.5,
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--border-1, #2a2f3a)" }} />o
        <span style={{ flex: 1, height: 1, background: "var(--border-1, #2a2f3a)" }} />
      </div>
      <button
        type="button"
        onClick={() => void startSso()}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          padding: "11px 14px",
          borderRadius: 10,
          border: "1px solid var(--border-1, #2a2f3a)",
          background: "var(--bg-2, #12151c)",
          color: "var(--text-1, #e8ecf3)",
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: "var(--font-ui)",
          cursor: "pointer",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M3 9h18M8 18v3M16 18v3M7 21h10" />
        </svg>
        Entrar con tu empresa
      </button>
    </div>
  );
}

/** Footer line shown at the bottom of the form column (small caption). */
function VoxAuthFooter() {
  return (
    <div className="vox-auth__protect">Protegido con cifrado AES-256 · SSO SAML 2.0 · MFA</div>
  );
}

/**
 * VoxAuthGate — portón Cognito. Muestra el login de Vox si no hay sesión;
 * cuando hay sesión, renderiza la app (children) envuelta en el provider.
 *
 * El Authenticator se monta con el split-screen layout vía CSS sobre
 * `data-amplify-*` selectors (ver index.css §"Vox auth gate"). Pasamos
 * un Header (brand hero) y un Footer (línea de seguridad).
 */
export function VoxAuthGate({ children }: { children: ReactNode }) {
  return (
    <Authenticator
      // El registro crea el workspace de UNA empresa (el que se registra queda
      // como Admin/fundador). Pedimos su nombre + el nombre de la empresa →
      // provision-tenant usa la empresa como nombre de la organización. Los
      // demás empleados NO se registran: los invita el admin.
      signUpAttributes={["name"]}
      formFields={{
        signUp: {
          name: {
            label: "Tu nombre completo",
            placeholder: "Ej. Andrea Pérez",
            order: 1,
            isRequired: true,
          },
          "custom:companyName": {
            label: "Nombre de tu empresa",
            placeholder: "Ej. Acme S.A.",
            order: 2,
            isRequired: true,
          },
          email: { order: 3 },
          password: { order: 4 },
          confirm_password: { order: 5 },
        },
      }}
      components={{
        Header: VoxAuthHeader,
        Footer: VoxAuthFooter,
        SignIn: { Footer: SsoSignInSlot },
      }}
    >
      {() => <VoxAuthProvider>{children}</VoxAuthProvider>}
    </Authenticator>
  );
}
