/**
 * WaTemplateConfigurator — reusable WhatsApp template editor used wherever a
 * template is sent (Campañas, nodo "Plantilla" de Bots, herramienta del Agente).
 * Shows a LIVE preview (header / body with {{n}} substituted / footer / buttons)
 * plus an input per variable:
 *   · mode="campaign" → cada variable mapea a una COLUMNA del contacto
 *   · mode="flow"     → cada variable es un valor fijo o {{variable del flujo}}
 * It works off the real template structure (variableCount, buttons) returned by
 * list-whatsapp-templates, so the user always fills exactly what Meta expects.
 */
export interface WaTemplateButton { type: string; text: string; url?: string; phoneNumber?: string }
export interface WaTemplate {
  name: string;
  metaTemplateId?: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  footerText?: string;
  buttons?: WaTemplateButton[];
}

export function WaTemplateConfigurator({
  templates,
  templateName,
  language,
  variables,
  onChange,
  mode,
  columns = [],
  flowVars = [],
  showPicker = true,
}: {
  templates: WaTemplate[];
  templateName: string;
  language: string;
  variables: string[];
  onChange: (v: { templateName: string; language: string; variables: string[] }) => void;
  mode: "campaign" | "flow";
  columns?: string[];
  flowVars?: string[];
  showPicker?: boolean;
}) {
  const tpl = templates.find((t) => t.name === templateName) || null;
  const varCount = tpl?.variableCount || 0;

  const pickTemplate = (name: string) => {
    const t = templates.find((x) => x.name === name);
    onChange({ templateName: name, language: t?.language || "es", variables: new Array(t?.variableCount || 0).fill("") });
  };
  const setVar = (i: number, val: string) => {
    const next = [...variables];
    while (next.length < varCount) next.push("");
    next[i] = val;
    onChange({ templateName, language, variables: next.slice(0, varCount) });
  };

  const previewBody = (tpl?.bodyText || "").replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const v = variables[Number(n) - 1];
    if (!v) return `{{${n}}}`;
    if (mode === "campaign") {
      if (v.startsWith("lit:")) return v.slice(4) || `{{${n}}}`;       // valor fijo para todos
      return `«${v === "__customerName__" ? "Nombre del contacto" : v}»`; // columna del lead
    }
    const fv = v.match(/^\{\{([\s\S]*)\}\}$/);                         // flujo: {{variable}} → pill
    return fv ? `«${fv[1] || "variable"}»` : v;                        // literal → tal cual
  });

  const ctxFor = (i: number): string => {
    const body = tpl?.bodyText || "";
    const tok = `{{${i + 1}}}`;
    const idx = body.indexOf(tok);
    if (idx < 0) return "";
    return ("…" + body.slice(Math.max(0, idx - 16), idx + tok.length + 16).replace(/\n/g, " ") + "…");
  };

  const btnIcon = (t: string) => (t === "URL" ? "🔗" : t === "PHONE_NUMBER" ? "📞" : "↩️");

  return (
    <div className="watc">
      {showPicker && (
        <select className="watc__select" value={templateName} onChange={(e) => pickTemplate(e.target.value)}>
          <option value="">Elegir plantilla…</option>
          {templates.map((t) => (
            <option key={t.metaTemplateId || t.name} value={t.name}>
              {t.name} · {t.language || "es"}{(t.variableCount || 0) > 0 ? ` · ${t.variableCount} var` : ""}
            </option>
          ))}
        </select>
      )}

      {tpl && (
        <>
          {/* Live preview */}
          <div className="watc__preview">
            <div className="watc__bubble">
              {tpl.headerText && <div className="watc__hdr">{tpl.headerText}</div>}
              <div className="watc__body">{previewBody || <span className="muted">(sin cuerpo)</span>}</div>
              {tpl.footerText && <div className="watc__ftr">{tpl.footerText}</div>}
            </div>
            {(tpl.buttons || []).length > 0 && (
              <div className="watc__btns">
                {(tpl.buttons || []).map((b, i) => (
                  <div key={i} className="watc__btn" title={b.url || b.phoneNumber || "Respuesta rápida"}>
                    <span>{btnIcon(b.type)} {b.text}</span>
                    {(b.url || b.phoneNumber) && <span className="watc__btn-meta">{b.url || b.phoneNumber}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Variable inputs */}
          {varCount > 0 ? (
            <div className="watc__vars">
              <div className="watc__vars-h">{mode === "campaign" ? (columns.length === 0 ? "Variables → escribilas a mano, o usá el nombre del contacto" : "Variables → se escriben a mano por defecto; cambiá a “Columna” si alguna corresponde a tu lista") : "Variables → variable del flujo o valor fijo"}</div>
              {Array.from({ length: varCount }).map((_, i) => (
                <div key={i} className="watc__var">
                  <span className="watc__var-tag">{`{{${i + 1}}}`}</span>
                  {mode === "campaign" ? (() => {
                    const val = variables[i] || "";
                    const noColumns = columns.length === 0;
                    // Manual es el modo por defecto SIEMPRE: aunque la lista traiga
                    // columnas, puede que no correspondan al template, así que arrancamos
                    // escribiendo a mano. Si alguna columna sí matchea, el usuario cambia
                    // a "Columna"/"Nombre" para tomarla del contacto.
                    const isLit = val.startsWith("lit:") || val === "";
                    return (
                      <div className="watc__var-camp">
                        <div className="watc__toggle">
                          <button type="button" className={isLit ? "on" : ""} onClick={() => { if (!isLit) setVar(i, "lit:"); }} title="Escribir el valor a mano (igual para todos los contactos)">Manual</button>
                          <button type="button" className={!isLit ? "on" : ""} onClick={() => { if (isLit) setVar(i, "__customerName__"); }} title={noColumns ? "Usar el nombre del contacto (distinto por contacto)" : "Tomar el valor de una columna del lead (distinto por contacto)"}>{noColumns ? "Nombre" : "Columna"}</button>
                        </div>
                        {isLit ? (
                          <input className="watc__var-input" placeholder="Escribí el valor (igual para todos)…" value={val.startsWith("lit:") ? val.slice(4) : ""} onChange={(e) => setVar(i, "lit:" + e.target.value)} />
                        ) : (
                          <select className="watc__select watc__var-input" value={val} onChange={(e) => setVar(i, e.target.value)}>
                            <option value="__customerName__">(Nombre del contacto)</option>
                            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })() : (() => {
                    const val = variables[i] || "";
                    const m = val.match(/^\{\{([\s\S]*)\}\}$/);
                    const isVar = m !== null;
                    const varName = m ? m[1] : "";
                    const dlId = `watc-fv-${i}`;
                    return (
                      <div className="watc__var-camp">
                        <div className="watc__toggle">
                          <button type="button" className={isVar ? "on" : ""} onClick={() => { if (!isVar) setVar(i, "{{}}"); }} title="Tomar el valor de una variable capturada en el flujo (ej. la respuesta a una pregunta)">Variable</button>
                          <button type="button" className={!isVar ? "on" : ""} onClick={() => { if (isVar) setVar(i, ""); }} title="Mismo valor fijo, escrito por vos">Fijo</button>
                        </div>
                        {isVar ? (
                          <div className="watc__fv">
                            <input className="watc__var-input" list={dlId} placeholder="nombre de variable (ej. carrera)" value={varName} onChange={(e) => setVar(i, e.target.value ? `{{${e.target.value}}}` : "{{}}")} />
                            {flowVars.length > 0 && <datalist id={dlId}>{flowVars.map((v) => <option key={v} value={v} />)}</datalist>}
                            {flowVars.length > 0 && (
                              <div className="watc__fv-chips">
                                <span className="watc__fv-lbl">Del flujo:</span>
                                {flowVars.map((v) => (
                                  <button type="button" key={v} className={`watc__fv-chip${varName === v ? " on" : ""}`} onClick={() => setVar(i, `{{${v}}}`)} title={`Usar {{${v}}}`}>{v}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <input className="watc__var-input" placeholder="Valor fijo…" value={val} onChange={(e) => setVar(i, e.target.value)} />
                        )}
                      </div>
                    );
                  })()}
                  {ctxFor(i) && <span className="watc__var-ctx" title={ctxFor(i)}>{ctxFor(i)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="watc__novars">Esta plantilla no tiene variables.</div>
          )}
          {(tpl.buttons || []).length > 0 && (
            <div className="watc__note">Los botones son fijos (aprobados por Meta): respuesta rápida, enlace o llamada. No se editan acá.</div>
          )}
        </>
      )}
    </div>
  );
}
