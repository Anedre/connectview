import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";

/**
 * WhatsAppTemplateSummary — muestra EXACTAMENTE el mensaje que la campaña envía:
 * la plantilla aprobada renderizada como burbuja de WhatsApp, con cada variable
 * {{n}} resuelta a su origen (columna del CSV / nombre del cliente / valor fijo),
 * más header, footer y botones. Así el manager ve el contenido real sin abrir Meta.
 */
interface WaTemplateButton { type: string; text: string; url?: string; phoneNumber?: string }
interface WaTemplate {
  name: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  footerText?: string;
  buttons?: WaTemplateButton[];
}

interface Props {
  templateName?: string;
  templateLanguage?: string;
  /** JSON array: índice de variable → columna / "__customerName__" / "lit:valor". */
  templateVarColumns?: string;
}

/** Cómo se resuelve una variable, para el chip inline + la leyenda. */
function varMeta(col: string | undefined): { text: string; bg: string; fg: string; icon?: "user" } {
  if (!col) return { text: "(sin asignar)", bg: "var(--accent-red-soft)", fg: "var(--accent-red)" };
  if (col === "__customerName__") return { text: "Nombre del cliente", bg: "var(--accent-cyan-soft)", fg: "var(--accent-cyan)", icon: "user" };
  if (col.startsWith("lit:")) return { text: col.slice(4) || "(vacío)", bg: "var(--accent-amber-soft)", fg: "var(--accent-amber)" };
  return { text: col, bg: "var(--accent-violet-soft)", fg: "var(--accent-violet)" };
}

export function WhatsAppTemplateSummary({ templateName, templateLanguage, templateVarColumns }: Props) {
  const [tpl, setTpl] = useState<WaTemplate | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none" | "err">(
    () => (getApiEndpoints()?.listWhatsAppTemplates && templateName ? "loading" : "none")
  );

  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates || !templateName) return;
    const url = ep.listWhatsAppTemplates;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        const j = await r.json();
        const list = (j.templates || []) as WaTemplate[];
        const found = list.find((t) => t.name === templateName) || null;
        setTpl(found);
        setState(found ? "ok" : "none");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setState("err");
      }
    })();
    return () => ctrl.abort();
  }, [templateName]);

  let varCols: string[] = [];
  try { varCols = JSON.parse(templateVarColumns || "[]"); } catch { /* ignore */ }

  const head = (
    <div className="card__head">
      <div className="card__title">
        <Icon.WhatsApp size={14} style={{ marginRight: 6, verticalAlign: "middle", color: "var(--accent-green)" }} />
        Mensaje que se envía
      </div>
      {templateName && (
        <span className="card__sub mono">
          {templateName}{templateLanguage ? ` · ${templateLanguage}` : ""}
        </span>
      )}
    </div>
  );

  if (state === "loading") {
    return <Card>{head}<CardBody><div className="muted" style={{ fontSize: 12.5 }}>Cargando plantilla…</div></CardBody></Card>;
  }
  if (state === "none" || state === "err" || !tpl) {
    return (
      <Card>{head}
        <CardBody>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {templateName
              ? <>Plantilla <span className="mono">{templateName}</span>{templateLanguage ? ` (${templateLanguage})` : ""} — vista previa no disponible.</>
              : "Esta campaña no tiene una plantilla configurada."}
          </div>
        </CardBody>
      </Card>
    );
  }

  // Cuerpo con las variables {{n}} resueltas a chips de su origen.
  const bodyParts = (tpl.bodyText || "").split(/(\{\{\d+\}\})/g);

  return (
    <Card>
      {head}
      <CardBody>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1.2fr) 1fr", gap: 16, alignItems: "start" }}>
          {/* ── Burbuja estilo WhatsApp ─────────────────────────── */}
          <div
            style={{
              position: "relative",
              padding: "12px 14px",
              borderRadius: 14,
              borderTopLeftRadius: 4,
              background: "color-mix(in srgb, var(--accent-green) 12%, var(--bg-2))",
              border: "1px solid color-mix(in srgb, var(--accent-green) 24%, transparent)",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-1)",
            }}
          >
            {tpl.headerText && (
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{tpl.headerText}</div>
            )}
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {bodyParts.map((part, i) => {
                const m = part.match(/^\{\{(\d+)\}\}$/);
                if (!m) return <span key={i}>{part}</span>;
                const meta = varMeta(varCols[Number(m[1]) - 1]);
                return (
                  <span
                    key={i}
                    className="mono"
                    title={`Variable {{${m[1]}}}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 3,
                      padding: "0 6px", height: 18, borderRadius: 5, margin: "0 1px",
                      background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 600,
                      verticalAlign: "baseline",
                    }}
                  >
                    {meta.icon === "user" && <Icon.User size={9} />}
                    {meta.text}
                  </span>
                );
              })}
            </div>
            {tpl.footerText && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{tpl.footerText}</div>
            )}
            {tpl.buttons && tpl.buttons.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10, borderTop: "1px solid color-mix(in srgb, var(--accent-green) 22%, transparent)", paddingTop: 8 }}>
                {tpl.buttons.map((b, i) => (
                  <div key={i} className="row" style={{ gap: 6, justifyContent: "center", color: "var(--accent-cyan)", fontSize: 12.5, fontWeight: 600 }}>
                    {b.type?.toUpperCase().includes("URL") ? <Icon.Globe size={12} /> : b.type?.toUpperCase().includes("PHONE") ? <Icon.Phone size={12} /> : <Icon.Chat size={12} />}
                    {b.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Leyenda: cómo se llena cada variable ─────────────── */}
          <div>
            <div className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              {varCols.length > 0 ? "Variables" : "Sin variables"}
            </div>
            {varCols.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Esta plantilla es de texto fijo: todos reciben el mismo mensaje.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {varCols.map((col, i) => {
                  const meta = varMeta(col);
                  const isLit = !!col && col.startsWith("lit:");
                  const isName = col === "__customerName__";
                  return (
                    <div key={i} className="row" style={{ gap: 8, alignItems: "center", fontSize: 12 }}>
                      <span className="mono" style={{ flex: "0 0 auto", color: "var(--text-3)", fontWeight: 700 }}>{`{{${i + 1}}}`}</span>
                      <Icon.ChevRight size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: meta.bg, color: meta.fg, fontWeight: 600 }}>
                        {meta.icon === "user" && <Icon.User size={10} />}
                        {meta.text}
                      </span>
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        {isName ? "personalizado por contacto" : isLit ? "valor fijo" : "del CSV / lead"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {tpl.category && (
              <div className="muted" style={{ fontSize: 10.5, marginTop: 12 }}>
                Categoría: <span className="mono">{tpl.category}</span>
                {tpl.status ? <> · {tpl.status}</> : null}
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
