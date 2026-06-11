import { Link2, PhoneCall, List as ListIcon, Eye, StickyNote, GitBranch, Clock } from "lucide-react";
import { OP_LABEL, UNIT_LABEL, type ButtonDef, type ListRow, type NodeKind } from "@/lib/botFlow";

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

/** Condición en lenguaje natural: "Si X contiene 'Y' → Sí / No". */
export function ConditionPreview({ data }: { data: Record<string, unknown> }) {
  const variable = String(data.variable || "").trim();
  const op = String(data.op || "equals");
  const value = String(data.value || "").trim();
  const needsValue = op !== "exists";
  return (
    <div className="fb-prev">
      <div className="fb-prev__top"><GitBranch size={12} /> Vista previa</div>
      <div className="fb-cond">
        <div className="fb-cond__rule">
          Si{" "}
          {variable ? <span className="fb-var">{variable}</span> : <span className="fb-prev__ph">(elegí una variable)</span>}{" "}
          <b>{OP_LABEL[op] || op}</b>
          {needsValue && (
            <> {value ? <span className="fb-cond__val">“{value}”</span> : <span className="fb-prev__ph">(valor)</span>}</>
          )}
        </div>
        <div className="fb-cond__branches">
          <span className="fb-cond__branch fb-cond__branch--yes">→ sale por «Sí»</span>
          <span className="fb-cond__branch fb-cond__branch--no">si no, por «No»</span>
        </div>
      </div>
    </div>
  );
}

const DELAY_PRESETS: { label: string; amount: number; unit: string }[] = [
  { label: "30 min", amount: 30, unit: "minutes" },
  { label: "1 hora", amount: 1, unit: "hours" },
  { label: "1 día", amount: 1, unit: "days" },
  { label: "3 días", amount: 3, unit: "days" },
  { label: "1 semana", amount: 7, unit: "days" },
];

/** Presets rápidos + frase en lenguaje natural para el paso "Esperar". */
export function DelayPresets({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const amount = Number(data.amount) || 0;
  const unit = String(data.unit || "minutes");
  return (
    <div className="fb-prev">
      <div className="fb-prev__top"><Clock size={12} /> Vista previa</div>
      <div className="fb-delay">
        <div className="fb-delay__line">
          El bot <b>espera {amount} {UNIT_LABEL[unit] || unit}</b> y sigue al próximo paso.
        </div>
        <div className="fb-delay__presets">
          {DELAY_PRESETS.map((p) => {
            const on = amount === p.amount && unit === p.unit;
            return (
              <button
                key={p.label}
                type="button"
                className={`fb-delay__chip ${on ? "is-on" : ""}`}
                onClick={() => onChange({ amount: p.amount, unit: p.unit })}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
