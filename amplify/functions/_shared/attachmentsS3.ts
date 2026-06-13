import {
  ConnectClient,
  ListInstanceStorageConfigsCommand,
} from "@aws-sdk/client-connect";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Adjuntos de MENSAJE de chat/WhatsApp + email en Amazon Connect.
 *
 * NO se bajan con connect:GetAttachedFile (esa API es del subsistema de
 * "attached files"/Cases; para un adjunto de chat tira InvalidRequestException).
 * Los archivos reales viven en el bucket del storage config ATTACHMENTS del
 * instance, con esta clave:
 *   {prefix}/{chat|email}/{YYYY}/{MM}/{DD}/{contactId}_{attachmentId}_{ts}_UTC.{ext}
 * Así que listamos por {contactId}_{attachmentId} (robusto al ts/ext generados)
 * y presignamos el objeto S3 directo. (#grabaciones)
 */

export interface AttachmentsStore {
  bucket: string;
  /** Prefix sin barra final. */
  prefix: string;
}

const storeCache = new Map<string, AttachmentsStore | null>();

/** Lee (y cachea) el bucket+prefix del storage config ATTACHMENTS del instance. */
export async function getAttachmentsStore(
  connect: ConnectClient,
  instanceId: string
): Promise<AttachmentsStore | null> {
  if (storeCache.has(instanceId)) return storeCache.get(instanceId)!;
  let store: AttachmentsStore | null = null;
  try {
    const r = await connect.send(
      new ListInstanceStorageConfigsCommand({
        InstanceId: instanceId,
        ResourceType: "ATTACHMENTS",
      })
    );
    const cfg = r.StorageConfigs?.[0]?.S3Config;
    if (cfg?.BucketName) {
      store = {
        bucket: cfg.BucketName,
        prefix: (cfg.BucketPrefix || "").replace(/\/+$/, ""),
      };
    }
  } catch {
    store = null;
  }
  storeCache.set(instanceId, store);
  return store;
}

function datePath(iso: string): string | null {
  const t = Date.parse(iso);
  if (!t) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/**
 * Presigna UN adjunto de mensaje conocido (contactId + attachmentId + cuándo).
 * `sub` = "chat" o "email". Devuelve { url, sizeBytes } o null si no se encuentra.
 */
export async function presignAttachment(
  s3: S3Client,
  store: AttachmentsStore,
  sub: "chat" | "email",
  contactId: string,
  attachmentId: string,
  isoTimestamp: string,
  expiresIn = 3600
): Promise<{ url: string; sizeBytes?: number } | null> {
  const dp = datePath(isoTimestamp);
  if (!dp) return null;
  const listPrefix = `${store.prefix}/${sub}/${dp}/${contactId}_${attachmentId}`;
  try {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: store.bucket,
        Prefix: listPrefix,
        MaxKeys: 3,
      })
    );
    const obj = (r.Contents || []).find((c) => c.Key);
    if (!obj?.Key) return null;
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: store.bucket, Key: obj.Key }),
      { expiresIn }
    );
    return { url, sizeBytes: obj.Size };
  } catch {
    return null;
  }
}

export interface ListedAttachment {
  attachmentId: string;
  /** Nombre derivable de la clave S3 (no el original cuando no lo tenemos). */
  name: string;
  url: string;
  sizeBytes?: number;
}

/**
 * Lista TODOS los adjuntos de un contacto en su fecha de inicio (para el grid de
 * email, donde no parseamos el cuerpo del mensaje). La clave es
 * {prefix}/{sub}/{Y}/{M}/{D}/{contactId}_{attachmentId}_{ts}_UTC.{ext}.
 */
export async function listContactAttachments(
  s3: S3Client,
  store: AttachmentsStore,
  sub: "chat" | "email",
  contactId: string,
  isoTimestamp: string,
  expiresIn = 3600
): Promise<ListedAttachment[]> {
  const dp = datePath(isoTimestamp);
  if (!dp) return [];
  const listPrefix = `${store.prefix}/${sub}/${dp}/${contactId}_`;
  try {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: store.bucket,
        Prefix: listPrefix,
        MaxKeys: 50,
      })
    );
    const out: ListedAttachment[] = [];
    for (const c of r.Contents || []) {
      if (!c.Key) continue;
      const fname = c.Key.split("/").pop() || "";
      // {contactId}_{attachmentId}_{ts}_UTC.{ext}
      const rest = fname.startsWith(contactId + "_")
        ? fname.slice(contactId.length + 1)
        : fname;
      const attachmentId = rest.split("_")[0] || rest;
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: store.bucket, Key: c.Key }),
        { expiresIn }
      );
      out.push({ attachmentId, name: fname, url, sizeBytes: c.Size });
    }
    return out;
  } catch {
    return [];
  }
}
