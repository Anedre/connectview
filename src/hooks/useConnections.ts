import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

/**
 * useConnections — config de integraciones por organización (Amazon Connect /
 * Salesforce / WhatsApp). Hoy persiste en localStorage como fallback; cuando el
 * endpoint `manageConnections` esté desplegado, lee/escribe del backend.
 *
 * IMPORTANTE: acá NUNCA se guardan secretos crudos (token de WhatsApp, refresh
 * token de Salesforce). Esos van a Secrets Manager vía el backend. El cliente
 * sólo guarda config NO sensible + flags ("tokenSet", "connected").
 */
export interface ConnectConn {
  instanceUrl?: string; // https://empresa.my.connect.aws
  region?: string; // us-east-1, …
  instanceArn?: string;
  roleArn?: string; // rol cross-account que asumimos (no es secreto)
  externalId?: string; // anti-confused-deputy
  verifiedAt?: string;
  /** BYO Data Plane (#46) — el cliente activa esto DESPUÉS de aplicar el
   *  CFN del paso 4. Cuando está en true, los Lambdas escriben en SU
   *  DynamoDB (assumed creds → su account); cuando es false/undefined,
   *  todo va a la tabla pooled de Vox. La separación es crítica: sin
   *  este flag, conectar Connect sin aplicar las tablas tira
   *  ResourceNotFoundException en cada llamada. */
  dataPlaneEnabled?: boolean;
  /** Confirmación más reciente de que las tablas del data plane existen
   *  en la cuenta del cliente (DescribeTable connectview-leads). */
  dataPlaneVerifiedAt?: string;
  /** Override del domain name de Customer Profiles. Default: derivado del
   *  instanceUrl como `amazon-connect-<alias>`. */
  customerProfilesDomain?: string;
  /** Cola "principal" elegida por el admin (Configuración → Colas). Los flows
   *  ARIA-Outbound/Inbound rutean a esta. La escribe provision-contact-flows. */
  defaultQueueId?: string;
  defaultQueueName?: string;
}
export interface SalesforceConn {
  connected?: boolean;
  instanceUrl?: string;
  environment?: "production" | "sandbox";
  connectedAt?: string;
  /** Flag — el token de ENTRADA per-tenant (SF→Vox) ya fue generado. El token
   *  vive en Secrets Manager (`connectview/tenant/<id>/sf-inbound`), nunca acá.
   *  El plaintext se muestra UNA vez al generarlo (para pegarlo en el Flow). */
  inboundTokenSet?: boolean;
  inboundTokenRotatedAt?: string;
  /** Pilar 10 — mapeo schema-aware: campo de ARIA → campo del Lead de la org del
   *  cliente. Default = estándar; "" = no escribir ese campo (R24). */
  fieldMapping?: Record<string, string>;
}
/** Un WhatsApp Flow (formulario nativo de Meta, #10) registrado por el tenant.
 *  El Flow se diseña/publica en Meta Business Manager; acá vive solo su
 *  referencia para que el composer del agente pueda enviarlo. */
export interface WaFlowDef {
  /** flow_id del Flow publicado en Meta. */
  id: string;
  name: string;
  /** Texto del botón (≤30 chars). Default "Completar". */
  cta?: string;
  /** Pantalla inicial (id del screen en el Flow JSON). */
  screen?: string;
}

export interface WhatsAppConn {
  phoneNumberId?: string;
  wabaId?: string;
  tokenSet?: boolean; // flag — el token vive en Secrets Manager
  connectedAt?: string;
  /** "aws" = número nativo de Connect (AWS End User Messaging) · "meta" =
   *  número de Meta aparte (Cloud API, solo plantillas/bots). */
  mode?: "aws" | "meta";
  metaPhoneNumberId?: string;
  /** Formularios (WhatsApp Flows, #10) disponibles para enviar desde el chat. */
  flows?: WaFlowDef[];
}

/** Número de WhatsApp ya vinculado a la instancia de Connect (AWS End User
 *  Messaging), detectado por el backend para ofrecerlo en el formulario. */
export interface WhatsAppNumber {
  displayPhoneNumber?: string;
  displayName?: string;
  metaPhoneNumberId?: string;
  phoneNumberId?: string;
  phoneNumberArn?: string;
  wabaId?: string;
  wabaName?: string;
  qualityRating?: string;
}
/** Mensajería configurable por tenant (de-Novasys-ificación): textos que antes
 *  estaban hardcodeados con contenido de UDEP en el código. undefined / "" =
 *  default genérico del producto. El cliente los edita en Integraciones. */
export interface MessagingConn {
  /** Despedida que el agente envía al cerrar un chat / WhatsApp, justo antes de
   *  desconectar. Antes era una constante con texto de la Universidad de Piura. */
  chatFarewell?: string;
  /** Saludo de bienvenida al abrir un chat / WhatsApp (Canales). */
  welcome?: string;
  /** Mensaje de fuera de horario o sin agentes disponibles (Canales). */
  away?: string;
  /** Snippet del widget de chat web (Amazon Connect) que el cliente pega en su
   *  sitio. Solo se almacena/edita acá; el widget se genera en la consola de Connect. */
  webChatSnippet?: string;
}
/** Contact flows canónicos de ARIA provisionados en la instancia del tenant
 *  (#1 onboarding). Los IDs los escribe el Lambda `provision-contact-flows`. */
export interface ContactFlowsConfig {
  inboundId?: string;
  outboundId?: string;
  disconnectId?: string;
  provisionedAt?: string;
}
/** Reglas de ruteo por atributo (Configuración → Ruteo): cada valor del atributo
 *  del lead se mapea a una cola. Generan el flow ARIA-Outbound-Smart que las
 *  campañas usan para distribuir a los agentes por atributo. */
export interface RoutingRulesConfig {
  attribute?: string;
  rules?: { value: string; queueId: string }[];
  defaultQueueId?: string;
  flowId?: string;
  flowName?: string;
  updatedAt?: string;
}
/** White-label por tenant (#8): la marca que ve el cliente DENTRO de la app
 *  (post-login). El login/splash siguen con la marca de plataforma (ARIA)
 *  porque ahí todavía no sabemos qué tenant es (haría falta dominio por tenant). */
export interface BrandingConn {
  /** Nombre de producto en la sidebar + título de la pestaña. Default "ARIA". */
  productName?: string;
  /** (futuro) URL del logo + color de acento. Requieren storage/theming. */
  logoUrl?: string;
  accentColor?: string;
}
export interface ConnectionsConfig {
  connect?: ConnectConn;
  salesforce?: SalesforceConn;
  whatsapp?: WhatsAppConn;
  messaging?: MessagingConn;
  contactFlows?: ContactFlowsConfig;
  routingRules?: RoutingRulesConfig;
  branding?: BrandingConn;
}

const LS_KEY = "vox:connections";

function readLocal(): ConnectionsConfig {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as ConnectionsConfig;
  } catch {
    return {};
  }
}

export function useConnections() {
  const ep = getApiEndpoints();
  const hasBackend = !!ep?.manageConnections;
  // SEGURIDAD multi-tenant (demo same-browser): si hay backend, NO seedeamos desde
  // localStorage (que es GLOBAL, no por tenant). Arrancamos vacío y `refetch()` lo
  // llena con el config del tenant del JWT. Así, tras Novasys→logout→UDEP en la
  // misma laptop, UDEP NO arranca con el roleArn/externalId/branding de Novasys.
  const [config, setConfig] = useState<ConnectionsConfig>(() => (hasBackend ? {} : readLocal()));
  const [loading, setLoading] = useState<boolean>(() => hasBackend);
  const [saving, setSaving] = useState(false);
  const [whatsappNumbers, setWhatsappNumbers] = useState<WhatsAppNumber[]>([]);

  // Trae la config del tenant del backend (pisa el cache local). Es idempotente
  // y silenciosa: solo el primer fetch importa para `loading`, así
  // re-sincronizar en focus no parpadea la UI. (setState post-unmount es no-op
  // en React 19, no hace falta guard.)
  const refetch = useCallback(async () => {
    const endpoint = ep?.manageConnections;
    if (!endpoint) {
      setLoading(false);
      return;
    }
    try {
      const r = await authedFetch(endpoint);
      const j = await r.json();
      if (j?.config) setConfig(j.config as ConnectionsConfig);
      if (Array.isArray(j?.whatsappNumbers))
        setWhatsappNumbers(j.whatsappNumbers as WhatsAppNumber[]);
    } catch {
      /* mantenemos el cache local */
    } finally {
      setLoading(false);
    }
  }, [ep?.manageConnections]);

  // Carga inicial.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Re-sincroniza al volver el foco a la pestaña: si la conexión se editó por
  // fuera (CLI, wizard en otra ventana), el badge "Configurá Connect" se
  // corrige solo, sin necesidad de un reload manual.
  useRefetchOnFocus(refetch);

  const save = useCallback(
    async (next: ConnectionsConfig) => {
      setConfig(next);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      const endpoint = ep?.manageConnections;
      if (!endpoint) return;
      setSaving(true);
      try {
        await authedFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: next }),
        });
      } catch {
        /* el cache local ya guardó; reintenta en el próximo save */
      } finally {
        setSaving(false);
      }
    },
    [ep?.manageConnections],
  );

  return { config, save, loading, saving, hasBackend, refetch, whatsappNumbers };
}
