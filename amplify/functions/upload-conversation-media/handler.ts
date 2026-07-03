import type { Handler } from "aws-lambda";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolveTenantId } from "../_shared/cognitoAuth";

/**
 * upload-conversation-media — subida de adjuntos para el inbox omnicanal (Pilar 6).
 *
 * El agente elige un archivo en el hilo → el frontend pide acá un presigned PUT,
 * sube el binario DIRECTO a S3 (sin pasar por Lambda → sin límite de 6 MB de
 * payload), y luego llama a manage-conversations { action:"sendMedia", mediaUrl:
 * publicUrl, ... }. La Graph API de Meta descarga el media desde `publicUrl`.
 *
 *   POST { filename, contentType }  → { uploadUrl, publicUrl, key }
 *     · uploadUrl → presigned S3 PUT (el navegador sube el archivo ahí, con el
 *                   mismo Content-Type). Expira en 5 min.
 *     · publicUrl → presigned S3 GET de larga duración (7 días, el máximo de
 *                   SigV4). Meta lo fetchea al enviar el mensaje. NO requiere
 *                   bucket público: la URL firmada lleva credencial temporal.
 *
 * Reutiliza el bucket de media de WhatsApp (connectview-wa-media-<acct>), bajo el
 * prefijo `conversation-media/<tenantId>/`. El rol necesita s3:PutObject +
 * s3:GetObject sobre ese bucket (el GET presignado exige que el firmante tenga
 * permiso para que la URL funcione).
 *
 * Env: MEDIA_BUCKET (default connectview-wa-media-731736972577).
 */
const s3 = new S3Client({});
const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "connectview-wa-media-731736972577";

// Presigned PUT: ventana corta para subir (5 min basta para una subida directa).
const PUT_EXPIRES = 300;
// Presigned GET: 7 días = tope de SigV4. Meta lo fetchea al momento del envío,
// pero le damos margen amplio por reintentos/colas del lado de Meta.
const GET_EXPIRES = 7 * 24 * 3600;

const CORS: Record<string, string> = { "Content-Type": "application/json" };
const resp = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

/** Extensión segura desde el filename o el contentType (solo [a-z0-9]). */
function safeExt(filename: string, contentType: string): string {
  const fromName = filename.includes(".") ? filename.split(".").pop() || "" : "";
  const fromType = contentType.includes("/") ? contentType.split("/").pop() || "" : "";
  const ext = (fromName || fromType || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "bin";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // Identidad: los Function URLs son auth NONE → validamos el JWT acá. Anónimo → 401.
  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) return resp(401, { error: "no autorizado" });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event?.body || "{}");
  } catch {
    return resp(400, { error: "body inválido" });
  }

  const filename = String(body.filename || "").trim();
  const contentType = String(body.contentType || "application/octet-stream").trim();
  if (!filename) return resp(400, { error: "filename requerido" });

  const ext = safeExt(filename, contentType);
  const key = `conversation-media/${tenantId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: PUT_EXPIRES },
    );
    // GET presignado inline: Meta lo descarga; "inline" evita Content-Disposition
    // attachment (que en algunos visores/fetchers da problemas). Larga duración.
    const publicUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: key,
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: GET_EXPIRES },
    );
    return resp(200, { uploadUrl, publicUrl, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("upload-conversation-media error", err);
    return resp(500, { error: msg });
  }
};
