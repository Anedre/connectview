import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useContactFlows } from "@/hooks/useContactFlows";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import * as Icon from "@/components/vox/primitives";

// Max combined size of attachments (in bytes). We keep this under the
// Lambda's 6 MB synchronous-invocation payload limit, allowing for the
// base64 inflation (~33%) and the rest of the request body. 3.5 MB
// raw → ~4.7 MB base64, plus body envelope = comfortable.
const MAX_ATTACHMENTS_BYTES = 3_500_000;

interface EmailAddressEntry {
  id: string;
  arn: string;
  address: string;
  displayName?: string;
  description?: string;
}

interface NewEmailFormProps {
  onSent?: () => void;
}

/**
 * Inline form to send an outbound email via Amazon Connect Email +
 * SES. Posts to `startOutboundContact` with `{ type: "email", ... }`.
 *
 * The "From" dropdown is populated from `listEmailAddresses` (Connect
 * `SearchEmailAddresses`). The "Email flow" dropdown is filtered from
 * the full contact-flow list by name (anything containing "Email").
 */
export function NewEmailForm({ onSent }: NewEmailFormProps) {
  const { user } = useConnectAuth();
  const { flows, loading: flowsLoading } = useContactFlows();

  const [emailAddresses, setEmailAddresses] = useState<EmailAddressEntry[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  // We key the select by the Connect EmailAddressId for stability across
  // renders, but submit the actual `address` string (what Connect's API
  // requires in FromEmailAddress.EmailAddress).
  const [fromId, setFromId] = useState("");
  const [to, setTo] = useState("");
  // Selected attachments (kept in client memory; converted to base64
  // at submit time and uploaded inside the Lambda via Connect's
  // attached-file API).
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [flowId, setFlowId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Lazy-load email addresses (one fetch per mount)
  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listEmailAddresses) return;
    setAddressesLoading(true);
    authedFetch(endpoints.listEmailAddresses)
      .then((r) => r.json())
      .then((j) => setEmailAddresses(j.items || []))
      .catch(() => {
        /* show empty list — user gets clean error from the picker */
      })
      .finally(() => setAddressesLoading(false));
  }, []);

  // Email flows: anything with "Email" in the name. Connect doesn't tag
  // contact flow type as EMAIL via list-contact-flows, so we filter by
  // name (the same convention used by Novasys' UDEP-Main-Email flow).
  const emailFlows = useMemo(
    () => flows.filter((f) => f.name.toLowerCase().includes("email")),
    [flows]
  );

  // Pre-select first option once each list loads
  useMemo(() => {
    if (!fromId && emailAddresses.length > 0) setFromId(emailAddresses[0].id);
  }, [emailAddresses, fromId]);
  useMemo(() => {
    if (!flowId && emailFlows.length > 0) setFlowId(emailFlows[0].id);
  }, [emailFlows, flowId]);

  // ─── Attachment helpers ────────────────────────────────────────
  const totalAttachmentsBytes = attachments.reduce(
    (sum, f) => sum + f.size,
    0
  );
  const attachmentsOversize = totalAttachmentsBytes > MAX_ATTACHMENTS_BYTES;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const next = [...attachments];
    for (const f of Array.from(files)) {
      // De-dupe by name+size
      if (next.find((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) =>
    setAttachments(attachments.filter((_, i) => i !== idx));

  // Reads a single file as base64 (without the `data:...;base64,` prefix)
  // for transport over JSON.
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader"));
      reader.readAsDataURL(file);
    });

  const fmtSize = (b: number) =>
    b < 1024
      ? `${b} B`
      : b < 1024 * 1024
      ? `${(b / 1024).toFixed(1)} KB`
      : `${(b / 1024 / 1024).toFixed(1)} MB`;

  const submit = async () => {
    if (!fromId) {
      toast.error("Selecciona una dirección de origen");
      return;
    }
    if (!to.trim() || !to.includes("@")) {
      toast.error("Email destino inválido");
      return;
    }
    if (!subject.trim()) {
      toast.error("Pon un asunto");
      return;
    }
    if (!body.trim()) {
      toast.error("Escribe el mensaje");
      return;
    }
    if (!flowId) {
      toast.error("No hay email flow configurado");
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.startOutboundContact) {
      toast.error("Endpoint no configurado");
      return;
    }
    const selected = emailAddresses.find((a) => a.id === fromId);
    if (!selected) {
      toast.error("Dirección de origen no válida");
      return;
    }
    if (attachmentsOversize) {
      toast.error(
        `Los adjuntos exceden ${fmtSize(MAX_ATTACHMENTS_BYTES)} — quita alguno`
      );
      return;
    }
    setSubmitting(true);
    try {
      // Convert each attachment to base64 in parallel. Errors here mean
      // the file couldn't be read locally (unlikely but possible if the
      // browser revoked access) — we surface them and abort the send.
      const attachmentsPayload = await Promise.all(
        attachments.map(async (f) => ({
          filename: f.name,
          contentType: f.type || "application/octet-stream",
          contentBase64: await fileToBase64(f),
        }))
      );

      const r = await fetch(endpoints.startOutboundContact, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          fromEmailAddress: selected.address,
          fromDisplayName: selected.displayName,
          toAddress: to.trim(),
          subject: subject.trim(),
          body,
          contactFlowId: flowId,
          // Connect needs UserInfo on outbound EMAIL contacts — the
          // Lambda will ListUsers + match by username to get the
          // Connect user id.
          agentUsername: user?.username || "",
          actor: user?.username || "unknown",
          attachments: attachmentsPayload,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
      const attachedCount = data.attachments?.length ?? attachmentsPayload.length;
      toast.success(
        attachedCount > 0
          ? `Email enviado con ${attachedCount} adjunto${attachedCount > 1 ? "s" : ""}`
          : `Email enviado · ${data.contactId?.slice(0, 8)}…`
      );
      setTo("");
      setSubject("");
      setBody("");
      setAttachments([]);
      onSent?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo enviar el email"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          De
        </span>
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          disabled={addressesLoading}
          className="vox-field"
        >
          {emailAddresses.length === 0 && (
            <option value="">
              {addressesLoading ? "Cargando…" : "Sin direcciones registradas"}
            </option>
          )}
          {emailAddresses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ? `${a.displayName} · ${a.address}` : a.address}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Para
        </span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          type="email"
          placeholder="cliente@dominio.com"
          className="vox-field"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Asunto
        </span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Asunto del email"
          className="vox-field"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Mensaje
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escribe el contenido…"
          rows={5}
          className="vox-field"
          style={{ minHeight: 100 }}
        />
      </label>

      {/* Attachments — files are kept in memory until submit, then sent
          as base64 inside the JSON request body. Lambda uploads each one
          via Connect's StartAttachedFileUpload + presigned PUT. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <span className="muted" style={{ fontSize: 10.5 }}>
            Adjuntos
          </span>
          {attachments.length > 0 && (
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: attachmentsOversize
                  ? "var(--accent-red)"
                  : "var(--text-3)",
              }}
            >
              {fmtSize(totalAttachmentsBytes)} / {fmtSize(MAX_ATTACHMENTS_BYTES)}
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.txt,.zip"
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="btn"
          style={{
            height: 32,
            justifyContent: "center",
            fontSize: 12,
            borderStyle: "dashed",
          }}
        >
          <Icon.Download
            size={13}
            style={{ transform: "rotate(180deg)" }}
          />
          Añadir archivos
        </button>

        {attachments.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {attachments.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 8px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  fontSize: 11.5,
                }}
              >
                <Icon.Note size={12} style={{ color: "var(--text-3)" }} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-1)",
                  }}
                  title={f.name}
                >
                  {f.name}
                </span>
                <span
                  className="mono muted"
                  style={{ fontSize: 10, flexShrink: 0 }}
                >
                  {fmtSize(f.size)}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Quitar ${f.name}`}
                  title="Quitar"
                  style={{ height: 20, width: 20, padding: 0 }}
                >
                  <Icon.Close size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {attachmentsOversize && (
          <div
            style={{
              padding: "4px 8px",
              background: "var(--accent-red-soft)",
              color: "var(--accent-red)",
              borderRadius: 6,
              fontSize: 10.5,
              textAlign: "center",
            }}
          >
            Adjuntos exceden el límite. Quita alguno o usa archivos más pequeños.
          </div>
        )}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Email flow
        </span>
        <select
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          disabled={flowsLoading}
          className="vox-field"
        >
          {emailFlows.length === 0 && (
            <option value="">
              {flowsLoading ? "Cargando…" : "Sin email flows · crea uno en Connect"}
            </option>
          )}
          {emailFlows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn btn--success"
        onClick={submit}
        disabled={
          submitting ||
          !fromId ||
          !to.trim() ||
          !subject.trim() ||
          !body.trim() ||
          !flowId ||
          attachmentsOversize
        }
        style={{ marginTop: 4, height: 34, justifyContent: "center" }}
      >
        <Icon.Send size={13} />
        {submitting ? "Enviando…" : "Enviar email"}
      </button>
    </div>
  );
}
