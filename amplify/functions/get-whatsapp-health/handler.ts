import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  ListLinkedWhatsAppBusinessAccountsCommand,
  GetLinkedWhatsAppBusinessAccountCommand,
} from "@aws-sdk/client-socialmessaging";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveWhatsApp } from "../_shared/tenantConnect";

/**
 * get-whatsapp-health — salud del número de WhatsApp (Pilar 4 · #13).
 *
 * Lee el quality rating + estado de registro de los números de la WABA del
 * tenant vía AWS End User Messaging (`GetLinkedWhatsAppBusinessAccount`).
 * NO depende del event destination → funciona aunque el número esté anclado a
 * Connect (modo "aws"). Devuelve `anchoredToConnect` por WABA para que la UI
 * explique las capacidades dual-mode (ver design/pilar-4-deliverability.md):
 *   - anclado a Connect  → inbound integrado, SIN estado por-mensaje
 *   - Meta standalone    → deliverability completa
 *
 * Para meta-mode (número de Meta no anclado a AWS), el quality rating vive en
 * Meta y se trae en la Fase C (Graph API) — aquí se devuelve UNKNOWN.
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_PHONE_NUMBER_ID =
  process.env.ORIGINATION_IDENTITY || process.env.WHATSAPP_PHONE_NUMBER_ID || "";

const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

interface NumberHealth {
  phoneNumber: string;
  displayName: string;
  qualityRating: string; // GREEN | YELLOW | RED | UNKNOWN
  metaPhoneNumberId: string;
  registrationStatus?: string;
}
interface WabaHealth {
  wabaId: string;
  wabaName: string;
  anchoredToConnect: boolean;
  numbers: NumberHealth[];
}

const RANK: Record<string, number> = { GREEN: 0, UNKNOWN: 1, YELLOW: 2, RED: 3 };

const smClient = new SecretsManagerClient({});

/** Token Meta Cloud API del tenant (secret connectview/tenant/{id}/whatsapp = {token} o string). */
async function getTenantWaToken(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const r = await smClient.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const raw = r.SecretString || "";
    try {
      const j = JSON.parse(raw);
      if (j && typeof j.token === "string") return j.token;
    } catch {
      /* string plano */
    }
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** Alerta a partir del peor quality rating. */
function alertFor(worst: string): { level: "warning" | "critical"; message: string } | undefined {
  if (worst === "RED")
    return {
      level: "critical",
      message:
        "Un número está en calidad RED — riesgo de bloqueo. Revisa el contenido y la tasa de bloqueos.",
    };
  if (worst === "YELLOW")
    return {
      level: "warning",
      message:
        "Un número bajó a calidad YELLOW — cuida la frecuencia y el contenido para no caer a RED.",
    };
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  try {
    // Cliente SocialMessaging del tenant (legacy para Novasys) + modo configurado.
    const { client, mode, metaPhoneNumberId, tenantId } = await resolveWhatsApp(
      event?.headers,
      legacyClient,
      LEGACY_PHONE_NUMBER_ID,
    );
    const sm = (client as SocialMessagingClient) || legacyClient;

    // Modo Meta standalone (Cloud API): pulleamos el quality rating del número
    // directo de Meta Graph con el token del tenant (no anclado a Connect).
    if (mode === "meta") {
      let number: NumberHealth = {
        phoneNumber: "",
        displayName: "Número de Meta",
        qualityRating: "UNKNOWN",
        metaPhoneNumberId,
      };
      const token = await getTenantWaToken(tenantId);
      if (token && metaPhoneNumberId) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v20.0/${metaPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status&access_token=${encodeURIComponent(token)}`,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const j: any = await r.json();
          if (!j?.error) {
            number = {
              phoneNumber: j.display_phone_number || "",
              displayName: j.verified_name || "",
              qualityRating: j.quality_rating || "UNKNOWN",
              metaPhoneNumberId,
              registrationStatus: j.code_verification_status,
            };
          }
        } catch (e) {
          console.warn("meta quality pull falló:", e instanceof Error ? e.message : e);
        }
      }
      return ok({
        mode: "meta",
        configured: !!metaPhoneNumberId,
        wabas: metaPhoneNumberId
          ? [
              {
                wabaId: "",
                wabaName: "WhatsApp (Meta Cloud API)",
                anchoredToConnect: false,
                numbers: [number],
              },
            ]
          : [],
        alert: alertFor(number.qualityRating),
      });
    }

    // Modo AWS End User Messaging: leemos las WABAs vinculadas.
    const list = await sm.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
    const accounts = list.linkedAccounts || [];
    const wabas: WabaHealth[] = [];
    for (const acc of accounts) {
      if (!acc.id) continue;
      let detail = acc;
      try {
        const got = await sm.send(new GetLinkedWhatsAppBusinessAccountCommand({ id: acc.id }));
        if (got.account) detail = got.account;
      } catch {
        /* usamos lo que vino del list */
      }
      const anchoredToConnect = (detail.eventDestinations || []).some((ed) =>
        String(ed.eventDestinationArn || "").includes(":connect:"),
      );
      const numbers: NumberHealth[] = (detail.phoneNumbers || []).map((p) => ({
        phoneNumber: p.displayPhoneNumber || p.phoneNumber || "",
        displayName: p.displayPhoneNumberName || "",
        qualityRating: p.qualityRating || "UNKNOWN",
        metaPhoneNumberId: p.metaPhoneNumberId || "",
        registrationStatus: detail.registrationStatus,
      }));
      wabas.push({
        wabaId: detail.wabaId || "",
        wabaName: detail.wabaName || "WhatsApp",
        anchoredToConnect,
        numbers,
      });
    }

    // Alerta: el peor quality rating de todos los números.
    let worst = "GREEN";
    for (const w of wabas)
      for (const n of w.numbers) {
        if ((RANK[n.qualityRating] ?? 1) > (RANK[worst] ?? 0)) worst = n.qualityRating;
      }
    return ok({ mode: "aws", configured: wabas.length > 0, wabas, alert: alertFor(worst) });
  } catch (err) {
    console.error("get-whatsapp-health error", err);
    return ok({
      mode: "unknown",
      configured: false,
      wabas: [],
      error: err instanceof Error ? err.message : "health failed",
    });
  }
};
