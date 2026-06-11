import { Link2, PhoneCall, List as ListIcon, Eye, StickyNote } from "lucide-react";
import type { ButtonDef, ListRow, NodeKind } from "@/lib/botFlow";

/**
 * NodePreview — una vista previa estilo WhatsApp de lo que verá el cliente,
 * mostrada arriba del inspector para los pasos de mensaje (#16). Hace que armar
 * el flujo sea "lo que ves es lo que mandás": el usuario no tiene que imaginar
 * cómo queda una lista o los botones. Se actualiza en vivo al editar.
 */
function vars(text: string): React.ReactNode {
  return text.split(/(\{\{[^}]+\}\})/g).map((p, i) =>
    /^\{\{[^}]+\}\}$/.test(p) ? (
      <span key={i} className="fb-var">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

const PREVIEWABLE: NodeKind[] = ["message", "list", "question", "template", "internal_note"];

export function NodePreview({ kind, data }: { kind: NodeKind; data: Record<string, unknown> }) {
  if (!PREVIEWABLE.includes(kind)) return null;

  let body: React.ReactNode = null;

  if (kind === "message") {
    const text = String(data.text || "");
    const buttons = (Array.isArray(data.buttons) ? data.buttons : []) as ButtonDef[];
    body = (
      <>
        <div className="fb-prev__bubble">
          {text ? vars(text) : <span className="fb-prev__ph">Mensaje vacío…</span>}
        </div>
        {buttons.length > 0 && (
          <div className="fb-prev__btns">
            {buttons.map((b) => (
              <div key={b.id} className="fb-prev__btn">
                {b.type === "url" ? <Link2 size={13} /> : b.type === "phone" ? <PhoneCall size={13} /> : null}
                {b.label || (b.type === "url" ? "Enlace" : b.type === "phone" ? "Llamar" : "Botón")}
              </div>
            ))}
          </div>
        )}
      </>
    );
  } else if (kind === "list") {
    const header = String(data.header || "");
    const bodyText = String(data.body || "");
    const buttonLabel = String(data.buttonLabel || "Ver opciones");
    const rows = (Array.isArray(data.rows) ? data.rows : []) as ListRow[];
    body = (
      <>
        <div className="fb-prev__bubble">
          {header && <div className="fb-prev__bold">{vars(header)}</div>}
          {bodyText ? vars(bodyText) : <span className="fb-prev__ph">Mensaje…</span>}
          <div className="fb-prev__listbtn"><ListIcon size={13} /> {buttonLabel || "Ver opciones"}</div>
        </div>
        <div className="fb-prev__list">
          {rows.length > 0 ? (
            rows.map((r) => (
              <div key={r.id} className="fb-prev__row">
                <span className="fb-prev__rowt">{r.title || "Opción"}</span>
                {r.description && <span className="fb-prev__rowd">{r.description}</span>}
              </div>
            ))
          ) : (
            <div className="fb-prev__row"><span className="fb-prev__ph">Agregá opciones abajo…</span></div>
          )}
        </div>
      </>
    );
  } else if (kind === "question") {
    const prompt = String(data.prompt || "");
    body = (
      <>
        <div className="fb-prev__bubble">
          {prompt ? vars(prompt) : <span className="fb-prev__ph">Pregunta…</span>}
        </div>
        <div className="fb-prev__hintline">El bot espera la respuesta del cliente y la guarda.</div>
      </>
    );
  } else if (kind === "template") {
    const name = String(data.templateName || "");
    const count = Array.isArray(data.variables) ? (data.variables as string[]).filter(Boolean).length : 0;
    body = (
      <div className="fb-prev__bubble">
        <div className="fb-prev__bold">Plantilla de WhatsApp</div>
        {name ? <code className="fb-prev__code">{name}</code> : <span className="fb-prev__ph">Elegí una plantilla…</span>}
        {count > 0 && <div className="fb-prev__hintline" style={{ marginTop: 4 }}>{count} variable{count > 1 ? "s" : ""} a completar.</div>}
      </div>
    );
  } else if (kind === "internal_note") {
    const text = String(data.text || "");
    body = (
      <div className="fb-prev__note">
        <StickyNote size={13} />
        <span>{text ? vars(text) : <span className="fb-prev__ph">Nota interna…</span>}</span>
      </div>
    );
  }

  return (
    <div className="fb-prev">
      <div className="fb-prev__top"><Eye size={12} /> Vista previa</div>
      <div className={`fb-prev__screen ${kind === "internal_note" ? "fb-prev__screen--note" : ""}`}>{body}</div>
    </div>
  );
}
