import { useEffect } from "react";
import { X, Download, ExternalLink, Music, File as FileIcon } from "lucide-react";

/**
 * AttachmentLightbox — visor premium de adjuntos (#grabaciones). Previsualiza
 * imágenes, PDFs (iframe), video y audio sin salir de la página; para otros
 * tipos ofrece descarga. Se monta a nivel de cada vista (hilo / grilla) y se
 * abre pasándole un PreviewItem; Esc o clic en el fondo lo cierran.
 */

export interface PreviewItem {
  url: string;
  name: string;
  contentType?: string;
  sizeBytes?: number;
  /** Etiqueta opcional (canal · quién · cuándo) que se muestra bajo el nombre. */
  meta?: string;
}

function kindOf(ct?: string, name?: string): "image" | "pdf" | "video" | "audio" | "other" {
  const c = (ct || "").toLowerCase();
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (c.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg"].includes(ext)) return "image";
  if (c === "application/pdf" || ext === "pdf") return "pdf";
  if (c.startsWith("video/") || ["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (c.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "oga", "opus", "aac"].includes(ext)) return "audio";
  return "other";
}
function humanSize(b?: number): string {
  if (!b || b <= 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentLightbox({ item, onClose }: { item: PreviewItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [item, onClose]);

  if (!item) return null;
  const kind = kindOf(item.contentType, item.name);

  return (
    <div className="alb" onClick={onClose} role="dialog" aria-modal="true">
      <div className="alb__card" onClick={(e) => e.stopPropagation()}>
        <div className="alb__head">
          <div className="alb__title" style={{ minWidth: 0 }}>
            <div className="alb__name" title={item.name}>{item.name}</div>
            <div className="alb__sub">
              {item.meta ? <span>{item.meta}</span> : null}
              {item.sizeBytes ? <span>{humanSize(item.sizeBytes)}</span> : null}
            </div>
          </div>
          <div className="alb__actions">
            <a className="alb__btn" href={item.url} target="_blank" rel="noopener noreferrer" title="Abrir en pestaña nueva" aria-label="Abrir en pestaña nueva"><ExternalLink size={15} /></a>
            <a className="alb__btn" href={item.url} download={item.name} title="Descargar" aria-label="Descargar"><Download size={15} /></a>
            <button className="alb__btn alb__btn--close" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar"><X size={17} /></button>
          </div>
        </div>
        <div className="alb__body">
          {kind === "image" ? (
            <img src={item.url} alt={item.name} className="alb__img" />
          ) : kind === "pdf" ? (
            <iframe src={item.url} title={item.name} className="alb__frame" />
          ) : kind === "video" ? (
            <video src={item.url} controls autoPlay className="alb__media" />
          ) : kind === "audio" ? (
            <div className="alb__audio">
              <Music size={44} style={{ color: "var(--accent-violet)" }} />
              <audio src={item.url} controls autoPlay style={{ width: "min(420px, 80vw)" }} />
            </div>
          ) : (
            <div className="alb__other">
              <FileIcon size={56} style={{ color: "var(--text-3)" }} />
              <div className="alb__other-name">{item.name}</div>
              <div className="alb__other-hint">No se puede previsualizar este tipo de archivo.</div>
              <a className="btn btn--primary btn--sm" href={item.url} download={item.name}><Download size={14} /> Descargar</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
