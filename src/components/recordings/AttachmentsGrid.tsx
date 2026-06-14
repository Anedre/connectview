import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Image, Film, Music, FileText, ClipboardList, Paperclip } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { AttachmentLightbox, type PreviewItem } from "@/components/recordings/AttachmentLightbox";

/**
 * Cross-channel attachment grid — every file the customer has ever shared
 * (or that we sent them) across all voice / chat / email / task contacts,
 * displayed as a visual grid (image thumbnails, file-type icons for
 * everything else). Filterable by media kind so the agent can quickly
 * locate "that PDF the client sent two months ago".
 */

interface Props {
  phone: string | null;
}

interface CustomerAttachment {
  id: string;
  name: string;
  contentType?: string;
  sizeBytes?: number;
  url: string | null;
  sourceContactId: string;
  sourceChannel: string;
  sourceSubChannel?: string;
  from: "AGENT" | "CUSTOMER" | "UNKNOWN";
  timestamp: string;
  kind: "image" | "video" | "audio" | "pdf" | "document" | "other";
}

interface AttachmentsResponse {
  totalAttachments: number;
  attachments: CustomerAttachment[];
}

type KindFilter = "all" | CustomerAttachment["kind"];

const KIND_LABELS: Record<KindFilter, string> = {
  all: "Todos",
  image: "Imágenes",
  video: "Videos",
  audio: "Audios",
  pdf: "PDFs",
  document: "Documentos",
  other: "Otros",
};

/** Icon for a media kind, used in the filter pills. `all` has no icon. */
function kindIcon(kind: KindFilter): React.ReactNode {
  switch (kind) {
    case "image":
      return <Image size={12} />;
    case "video":
      return <Film size={12} />;
    case "audio":
      return <Music size={12} />;
    case "pdf":
      return <FileText size={12} />;
    case "document":
      return <ClipboardList size={12} />;
    case "other":
      return <Paperclip size={12} />;
    default:
      return null;
  }
}

const KIND_ORDER: KindFilter[] = [
  "all",
  "image",
  "pdf",
  "document",
  "audio",
  "video",
  "other",
];

function humanSize(b: number | undefined): string {
  if (!b || b <= 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Large file-type icon shown in the tile preview area when there's no
 *  image thumbnail to render. */
function fileIcon(kind: CustomerAttachment["kind"]): React.ReactNode {
  const size = 34;
  switch (kind) {
    case "image":
      return <Image size={size} />;
    case "video":
      return <Film size={size} />;
    case "audio":
      return <Music size={size} />;
    case "pdf":
      return <FileText size={size} />;
    case "document":
      return <ClipboardList size={size} />;
    default:
      return <Paperclip size={size} />;
  }
}

export function AttachmentsGrid({ phone }: Props) {
  const [data, setData] = useState<AttachmentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [preview, setPreview] = useState<PreviewItem | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!phone) return;
    const ep = getApiEndpoints();
    const url = (ep as unknown as Record<string, string | undefined>)
      ?.getCustomerAttachments;
    if (!url) {
      setError("Endpoint no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${url}?phone=${encodeURIComponent(phone)}`, { signal: ctrl.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!ok) throw new Error(j.message || `HTTP ${status}`);
        setData(j as AttachmentsResponse);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [phone]);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = {
      all: 0,
      image: 0,
      video: 0,
      audio: 0,
      pdf: 0,
      document: 0,
      other: 0,
    };
    for (const a of data?.attachments || []) {
      c.all += 1;
      c[a.kind] += 1;
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.attachments;
    return data.attachments.filter((a) => a.kind === filter);
  }, [data, filter]);

  if (!phone) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
        Selecciona un cliente para ver sus archivos compartidos.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
        Cargando archivos…
      </div>
    );
  }
  if (error) {
    return (
      <div
        style={{
          margin: 16,
          padding: 12,
          background: "var(--accent-red-soft)",
          color: "var(--accent-red)",
          borderRadius: 8,
          fontSize: 12.5,
        }}
      >
        {error}
      </div>
    );
  }
  if (!data || data.totalAttachments === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
        Este cliente no tiene archivos compartidos.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header + kind filter pills */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-1)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Icon.User size={14} style={{ color: "var(--text-3)" }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{phone}</div>
          <span className="muted" style={{ fontSize: 11 }}>
            · {data.totalAttachments} archivo{data.totalAttachments === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {KIND_ORDER.filter((k) => counts[k] > 0 || k === "all").map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="btn btn--sm"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background:
                  filter === k ? "var(--text-1)" : "var(--bg-2)",
                color:
                  filter === k ? "var(--bg-1)" : "var(--text-1)",
                border: "1px solid var(--border-1)",
                fontSize: 11,
                padding: "3px 8px",
              }}
            >
              {kindIcon(k)}
              {KIND_LABELS[k]} · {counts[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div
        style={{
          maxHeight: "64vh",
          overflowY: "auto",
          padding: 14,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          {filtered.map((a) => (
            <AttachmentTile key={`${a.sourceContactId}:${a.id}`} att={a} onPreview={setPreview} />
          ))}
        </div>
      </div>
      <AttachmentLightbox item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function AttachmentTile({ att, onPreview }: { att: CustomerAttachment; onPreview: (p: PreviewItem) => void }) {
  const dt = att.timestamp ? new Date(att.timestamp) : null;
  const rel = dt ? formatDistanceToNow(dt, { addSuffix: true, locale: es }) : "";
  const fromLabel = att.from === "AGENT" ? "Agente" : att.from === "CUSTOMER" ? "Cliente" : "—";
  const channelLabel =
    att.sourceChannel === "CHAT"
      ? att.sourceSubChannel || "Chat"
      : att.sourceChannel === "EMAIL"
      ? "Email"
      : att.sourceChannel === "VOICE"
      ? "Llamada"
      : att.sourceChannel;

  const open = () => {
    if (!att.url) return;
    onPreview({ url: att.url, name: att.name, contentType: att.contentType, sizeBytes: att.sizeBytes, meta: `${channelLabel} · ${fromLabel}` });
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={!att.url}
      style={{
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        padding: 0,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 12,
        overflow: "hidden",
        color: "inherit",
        cursor: att.url ? "pointer" : "default",
        transition: "transform 0.14s, box-shadow 0.14s, border-color 0.14s",
      }}
      onMouseEnter={(e) => {
        if (!att.url) return;
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,.12)";
        e.currentTarget.style.borderColor = "var(--border-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
        e.currentTarget.style.borderColor = "var(--border-1)";
      }}
    >
      {/* Preview area */}
      <div
        style={{
          aspectRatio: "1 / 1",
          background: "var(--bg-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          overflow: "hidden",
        }}
      >
        {att.kind === "image" && att.url ? (
          <img
            src={att.url}
            alt={att.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
          />
        ) : (
          fileIcon(att.kind)
        )}
      </div>
      {/* Meta */}
      <div style={{ padding: 8, fontSize: 11, minHeight: 60 }}>
        <div
          style={{
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 2,
          }}
          title={att.name}
        >
          {att.name}
        </div>
        <div className="muted" style={{ fontSize: 10 }}>
          {channelLabel} · {fromLabel}
        </div>
        <div className="muted" style={{ fontSize: 10 }}>
          {rel}
          {att.sizeBytes ? ` · ${humanSize(att.sizeBytes)}` : ""}
        </div>
      </div>
    </button>
  );
}
