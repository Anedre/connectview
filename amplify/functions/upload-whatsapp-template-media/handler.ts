import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  CreateWhatsAppMessageTemplateMediaCommand,
  ListLinkedWhatsAppBusinessAccountsCommand,
} from "@aws-sdk/client-socialmessaging";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { resolveWhatsAppWaba } from "../_shared/tenantConnect";

/**
 * upload-whatsapp-template-media — sube un archivo (imagen/video/PDF) para usarlo
 * como ENCABEZADO MULTIMEDIA de una plantilla y devuelve el `metaHeaderHandle`
 * que Meta exige en el sample del HEADER (example.header_handle).
 *
 * Flujo: base64 → S3 (bucket de staging en nuestra cuenta) →
 * CreateWhatsAppMessageTemplateMedia (AWS hace la subida resumible a Meta) →
 * { metaHeaderHandle }. Luego el frontend manda ese handle a create/update.
 *
 * NOTA BYO: el objeto S3 lo lee la cuenta del client resuelto (resolveWhatsAppWaba).
 * El bucket está en la cuenta de Novasys (731736972577) y su policy permite lectura
 * a la cuenta + al servicio social-messaging. Para un tenant con cuenta AWS PROPIA
 * (BYO real) haría falta un bucket en SU cuenta (pendiente).
 *
 * Body (JSON): { fileBase64, contentType, fileName? }
 */
const legacyClient = new SocialMessagingClient({});
const LEGACY_WABA_ID = process.env.WABA_ID || "waba-5a7f5911ddc34005bc32620e8bd9e2f2";
const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "connectview-wa-media-731736972577";
const s3 = new S3Client({});

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event?.body || "{}");
  } catch {
    /* body inválido → cae en validación */
  }

  const fileBase64 = String(body.fileBase64 || "");
  const contentType = String(body.contentType || "application/octet-stream");
  const fileName = String(body.fileName || "media");

  if (!fileBase64) {
    return resp(400, { error: "Falta el archivo." });
  }
  // ~5 MB en base64 (≈ 6.7M chars). Imágenes de header de WhatsApp ≤ 5 MB.
  if (fileBase64.length > 7_000_000) {
    return resp(400, { error: "El archivo es muy grande (máx ~5 MB)." });
  }

  const { client, wabaId: WABA_ID } = await resolveWhatsAppWaba(
    event?.headers,
    legacyClient,
    LEGACY_WABA_ID
  );
  if (!WABA_ID) {
    return resp(400, {
      error: "WhatsApp no está configurado para esta organización. Cargá tu WABA en Configuración → Integraciones.",
    });
  }
  let wabaForApi = WABA_ID;
  if (!/^waba-/.test(WABA_ID) && !/^arn:/.test(WABA_ID)) {
    try {
      const linked = await client.send(new ListLinkedWhatsAppBusinessAccountsCommand({}));
      const match = (linked.linkedAccounts || []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => a.wabaId === WABA_ID || a.id === WABA_ID
      );
      if (match?.id) wabaForApi = match.id;
      else if (match?.arn) wabaForApi = match.arn;
    } catch {
      /* seguimos con el original */
    }
  }

  const buffer = Buffer.from(fileBase64, "base64");
  const ext = (
    fileName.includes(".") ? fileName.split(".").pop() : contentType.split("/").pop() || "bin"
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const key = `wa-template-media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "bin"}`;

  try {
    await s3.send(
      new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Body: buffer, ContentType: contentType })
    );
    const res = await client.send(
      new CreateWhatsAppMessageTemplateMediaCommand({
        id: wabaForApi,
        sourceS3File: { bucketName: MEDIA_BUCKET, key },
      })
    );
    // Limpieza: el handle ya está en Meta, no necesitamos el objeto de staging.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    } catch {
      /* best-effort */
    }
    return resp(200, { ok: true, metaHeaderHandle: res.metaHeaderHandle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("upload-whatsapp-template-media error", err);
    return resp(500, { error: msg });
  }
};

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
