import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { initCCP, terminateCCP } from "@/lib/connect";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import {
  claimSoftphone,
  takeOverSoftphone,
  onYieldRequested,
  type SoftphoneRole,
} from "@/lib/softphoneTabLock";
import { ROLE_HIERARCHY } from "@/types/auth";
import type { AuthUser, UserRole } from "@/types/auth";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useConnections } from "@/hooks/useConnections";
import { useVoxAuth } from "@/context/VoxAuthContext";

interface ConnectAuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  needsLogin: boolean;
  ccpContainerRef: React.RefObject<HTMLDivElement | null>;
  signOut: () => void;
  /** URL de la instancia de Amazon Connect efectivamente usada (la del
   *  tenant si está configurada en Integraciones, o la del .env como
   *  fallback durante la transición). Los componentes que linkean al CCP
   *  externo (LoginScreen, Wisdom, Cases) la leen de aquí en vez del env. */
  instanceUrl: string;
  /** TRUE cuando el tenant todavía no conectó su Connect (no hay softphone).
   *  En este modo CCPContext NO se suscribe a connect.* (sino tira "Cannot read
   *  properties of undefined" al intentar suscribirse a un SDK sin iframe). */
  isOnboarding: boolean;
  /** TRUE si la app está corriendo SIN el softphone disponible aunque el
   *  tenant SÍ configuró su Connect (p.ej. el origen de localhost no está en
   *  los orígenes aprobados, o no hay sesión SSO). La app funciona igual; solo
   *  las features de voz/chat en vivo quedan inertes. */
  softphoneUnavailable: boolean;
  /** Rol de ESTA pestaña respecto al softphone (guard multi-pestaña). "owner" =
   *  maneja el CCP; "secondary" = otra pestaña ya lo tiene, así que esta NO inicia
   *  el CCP (si no, pelean el "master" de Connect y AMBAS se cuelgan en
   *  "Conectando…"). "pending" = resolviendo. El banner usa esto para "Usar aquí". */
  softphoneTabRole: "pending" | SoftphoneRole;
  /** "Usar aquí": mueve la propiedad del softphone a esta pestaña (traspaso limpio,
   *  con reload para reinicializar el CCP sin contención). */
  takeOverSoftphone: () => void;
  /** Despedida de chat/WhatsApp configurable por tenant
   *  (`config.messaging.chatFarewell`). "" = el consumidor (CCPContext) usa su
   *  default genérico. De-Novasys-ificación: antes era una constante hardcodeada
   *  con el texto de la Universidad de Piura. */
  chatFarewell: string;
  /** White-label (#8): nombre de producto que se muestra DENTRO de la app
   *  (sidebar + título de pestaña). Default "ARIA". El login/splash siguen con la
   *  marca de plataforma (ahí todavía no sabemos qué tenant es). */
  productName: string;
}

const ConnectAuthContext = createContext<ConnectAuthContextValue | null>(null);

/** Roles de la app a partir de los grupos Cognito del usuario (Vox). Los
 *  nombres de grupo del pool YA son los roles (Agents/Supervisors/Admins).
 *  Fail-closed: si no hay grupos válidos, queda como Agente — NUNCA admin. */
function rolesFromVoxGroups(groups: string[] | undefined): UserRole[] {
  const valid = (groups || []).filter(
    (g): g is UserRole => g === "Agents" || g === "Supervisors" || g === "Admins",
  );
  return valid.length ? valid : ["Agents"];
}

function getHighestRole(groups: UserRole[]): UserRole {
  return groups.reduce<UserRole>((highest, group) => {
    if (ROLE_HIERARCHY[group] > ROLE_HIERARCHY[highest]) {
      return group;
    }
    return highest;
  }, "Agents");
}

// Module-level guard so React StrictMode (dev) doesn't double-init the CCP iframe.
// The CCP iframe must live for the full page lifetime — we never tear it down on cleanup.
let ccpInitialized = false;
// Guard aparte para el reclamo de propiedad multi-pestaña (corre ANTES del init).
let ccpClaimStarted = false;

export function ConnectAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ccpContainerRef = useRef<HTMLDivElement>(null);

  // Config de integraciones del tenant. Si el cliente conectó SU instancia de
  // Amazon Connect (Configuración → Integraciones), usamos esa URL para el
  // softphone; si no, caemos a la del .env (Novasys legacy). Esperamos a que la
  // config termine de cargar antes de inicializar CCP (el iframe es singleton).
  const { config: integrations, loading: integrationsLoading } = useConnections();
  const {
    tenantId: voxTenantId,
    email: voxEmail,
    username: voxUsername,
    groups: voxGroups,
    loading: voxLoading,
    signOut: voxSignOut,
  } = useVoxAuth();

  const tenantInstanceUrl = integrations?.connect?.instanceUrl?.trim().replace(/\/$/, "") || "";
  // Tenant real (no "default" ni vacío). Un tenant real SIN instancia está en
  // onboarding → no hay softphone (resolvedInstanceUrl = ""). El tenant legacy
  // "default" usa la instancia del .env (Novasys).
  const hasRealTenant = !!voxTenantId && voxTenantId !== "default";
  const resolvedInstanceUrl = tenantInstanceUrl || (hasRealTenant ? "" : CONNECT_INSTANCE_URL);

  // ¿El softphone arrancó el iframe del CCP pero todavía no autenticó? Lo
  // marcamos para que la UI muestre "softphone no disponible" sin bloquear.
  const [softphoneUnavailable, setSoftphoneUnavailable] = useState(false);
  // Guard multi-pestaña: rol de esta pestaña respecto al softphone.
  const [softphoneTabRole, setSoftphoneTabRole] = useState<"pending" | SoftphoneRole>("pending");

  useEffect(() => {
    // Esperar a que Vox (Cognito) Y la config del tenant terminen de cargar.
    if (voxLoading || integrationsLoading) return;

    // ── IDENTIDAD: SIEMPRE desde Vox (Cognito) ───────────────────────────
    // Connect quedó SOLO como softphone. Antes, en modo conectado, se pisaba la
    // identidad con la del AGENTE de Connect — herencia del modelo mono-tenant
    // Novasys. Eso (a) dejaba afuera a los usuarios INVITADOS (que no son
    // agentes de Connect → no podían entrar) y (b) te hacía perder el admin si
    // tu agente de Connect no tenía el security profile "Admin". Ahora el rol
    // sale del grupo Cognito del tenant, que es la fuente de verdad multi-tenant.
    const roles = rolesFromVoxGroups(voxGroups);
    setUser({
      email: voxEmail || `${voxUsername || "user"}@vox`,
      userId: voxUsername || voxEmail || "user",
      username: voxEmail?.split("@")[0] || voxUsername || "Usuario",
      groups: roles,
      highestRole: getHighestRole(roles),
      securityProfiles: [],
    });
    setLoading(false);
    setError(null);

    // ── SOFTPHONE (opcional, en segundo plano) ───────────────────────────
    // Si el tenant configuró su Connect, arrancamos el CCP SOLO para voz/chat.
    // Si no autentica (origen no aprobado en localhost, sin sesión SSO, etc.),
    // la app sigue andando y marcamos softphoneUnavailable → degradación
    // graceful. NUNCA bloqueamos el acceso (no setError: eso mostraría el
    // ErrorScreen y taparía todo).
    if (!resolvedInstanceUrl) {
      setSoftphoneUnavailable(false); // onboarding: no hay softphone que ofrecer
      return;
    }
    const container = ccpContainerRef.current;
    if (!container || ccpClaimStarted) return;
    ccpClaimStarted = true;

    const initWithMaybeFederation = async () => {
      let federationSignInUrl: string | undefined;
      try {
        const fedEndpoint = getApiEndpoints()?.getFederationToken;
        if (fedEndpoint) {
          const fr = await authedFetch(fedEndpoint, { method: "GET" });
          if (fr.ok) {
            const fj = (await fr.json()) as { signInUrl?: string | null; reason?: string };
            if (fj.signInUrl) federationSignInUrl = fj.signInUrl;
            else if (fj.reason) console.info("CCP federation no disponible:", fj.reason);
          }
        }
      } catch (e) {
        // Federación opcional → cualquier falla es no-fatal.
        console.warn("CCP federation falló (cae a popup login):", e);
      }
      // Arranca el iframe del CCP → crea connect.core + el event bus. El estado
      // del softphone (agente, contactos) lo maneja CCPContext con su propia
      // suscripción a connect.agent/contact; aquí ya NO nos suscribimos para la
      // identidad (esa viene de Vox).
      initCCP(container, resolvedInstanceUrl, {
        federationSignInUrl,
        // Persistencia de sesión (#login): si pese al re-auth por popup la sesión
        // se cae del todo, lo marcamos (observabilidad). Streams ya intentó
        // recuperar solo primero; un reload re-inicializa y vuelve a re-autenticar.
        onAuthFail: () => setSoftphoneUnavailable(true),
      });
    };

    const doInit = () => {
      if (ccpInitialized) return;
      ccpInitialized = true;
      void initWithMaybeFederation().catch((e) => {
        // El softphone es opcional: si initCCP falla, la app sigue funcionando.
        console.warn("CCP (softphone) init falló — la app sigue sin softphone:", e);
        setSoftphoneUnavailable(true);
      });
    };

    // Guard multi-pestaña (#softphone): SOLO la pestaña "dueña" inicia el CCP. Si
    // varias pestañas de ARIA lo inician a la vez, pelean el "master" de Connect
    // (SharedWorker por origen) y las perdedoras se cuelgan en "Conectando…". Las
    // secundarias NO inician el CCP y el SoftphoneBanner ofrece "Usar aquí".
    void claimSoftphone({
      onLost: () => {
        // Nos robaron el softphone (otra pestaña hizo "Usar aquí") → soltamos el CCP
        // y quedamos secundarias (el banner lo refleja).
        terminateCCP();
        ccpInitialized = false;
        setSoftphoneTabRole("secondary");
      },
      onPromoted: () => {
        // La pestaña dueña se cerró → tomamos el relevo automáticamente.
        setSoftphoneTabRole("owner");
        doInit();
      },
    }).then(({ role }) => {
      setSoftphoneTabRole(role);
      if (role === "owner") {
        doInit();
        // Como dueña, escuchamos si otra pestaña pide el control → recargamos para
        // soltar el lock limpio (al recargar quedamos secundarias).
        onYieldRequested(() => {
          try {
            location.reload();
          } catch {
            /* noop */
          }
        });
      }
      // role === "secondary": NO iniciamos el CCP → cero contención.
    });
    // Sin cleanup: el iframe del CCP es singleton del page lifetime, no del
    // ciclo de vida del componente.
  }, [voxLoading, integrationsLoading, resolvedInstanceUrl, voxEmail, voxUsername, voxGroups]);

  // Sign out = cerrar la sesión de Vox (Cognito), que es la identidad primaria.
  // (Antes hacía logout del SSO de Connect; con Vox-first la sesión que importa
  // es la de Cognito — la de Connect es secundaria y se comparte por cookie.)
  const signOut = useCallback(() => {
    voxSignOut();
  }, [voxSignOut]);

  // De-Novasys-ificación: la despedida sale de la config del tenant; "" deja que
  // CCPContext use su default genérico (sin marca). El fundador conserva su texto
  // UDEP porque vive en SU config (messaging.chatFarewell), no en el código.
  const chatFarewell = integrations?.messaging?.chatFarewell?.trim() || "";
  // White-label (#8): nombre de producto del tenant dentro de la app. Default ARIA.
  const productName = integrations?.branding?.productName?.trim() || "ARIA";

  const value = useMemo<ConnectAuthContextValue>(
    () => ({
      user,
      loading,
      error,
      // Vox-first: el acceso a la app ya no depende de una sesión de Connect, así
      // que nunca forzamos el LoginScreen de Connect. Lo dejamos en false.
      needsLogin: false,
      ccpContainerRef,
      signOut,
      instanceUrl: resolvedInstanceUrl,
      isOnboarding: !resolvedInstanceUrl,
      softphoneUnavailable,
      softphoneTabRole,
      takeOverSoftphone,
      chatFarewell,
      productName,
    }),
    [
      user,
      loading,
      error,
      signOut,
      resolvedInstanceUrl,
      softphoneUnavailable,
      softphoneTabRole,
      chatFarewell,
      productName,
    ],
  );

  // White-label: el título de la pestaña del navegador refleja la marca del tenant.
  useEffect(() => {
    if (productName) document.title = productName;
  }, [productName]);

  return <ConnectAuthContext.Provider value={value}>{children}</ConnectAuthContext.Provider>;
}

export function useConnectAuth() {
  const ctx = useContext(ConnectAuthContext);
  if (!ctx) {
    throw new Error("useConnectAuth must be used within ConnectAuthProvider");
  }
  return ctx;
}
