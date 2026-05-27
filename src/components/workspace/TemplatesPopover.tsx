import { useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  CHAT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  renderTemplate,
  listTemplateVars,
  type ChatTemplate,
  type TemplateCategory,
  type TemplateContext,
} from "@/lib/chatTemplates";
import * as Icon from "@/components/vox/primitives";

interface Props {
  /** Runtime context — used to render the live preview of `{{vars}}`. */
  ctx: TemplateContext;
  /** Called with the rendered body when the agent picks a template. */
  onPick: (renderedBody: string) => void;
  /** Disabled when the chat hasn't connected yet. */
  disabled?: boolean;
}

export function TemplatesPopover({ ctx, onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<TemplateCategory>("bienvenida");

  const byCat = useMemo(() => {
    const m = new Map<TemplateCategory, ChatTemplate[]>();
    for (const t of CHAT_TEMPLATES) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return m;
  }, []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={(props) => (
          <button
            {...props}
            className="btn btn--ghost btn--sm btn--icon"
            disabled={disabled}
            title="Insertar plantilla"
            aria-label="Plantillas"
            style={{ fontSize: 14 }}
          >
            📝
          </button>
        )}
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="top" align="start">
          <Popover.Popup
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              width: 420,
              maxHeight: 440,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 1000,
            }}
          >
            {/* Category tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border-1)",
                flexShrink: 0,
                overflowX: "auto",
              }}
            >
              {TEMPLATE_CATEGORIES.map((cat) => {
                const isActive = activeCat === cat.id;
                const count = byCat.get(cat.id)?.length || 0;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCat(cat.id)}
                    style={{
                      padding: "8px 10px",
                      fontSize: 11.5,
                      background: isActive ? "var(--bg-2)" : "transparent",
                      borderBottom: isActive
                        ? "2px solid var(--accent-violet)"
                        : "2px solid transparent",
                      border: "none",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      color: isActive ? "var(--text-1)" : "var(--text-3)",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {cat.emoji} {cat.label}
                    {count > 0 && (
                      <span
                        className="muted"
                        style={{ marginLeft: 4, fontSize: 10 }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Template list */}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {(byCat.get(activeCat) || []).map((t) => {
                const rendered = renderTemplate(t.body, ctx);
                const missingVars = listTemplateVars(t.body).filter((v) => {
                  // Variables that fall back to a generic placeholder when
                  // the context is empty — flag them so the agent knows.
                  if (v === "nombre" && !ctx.customerName) return true;
                  if (v === "agente" && !ctx.agentName) return true;
                  return false;
                });
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onPick(rendered);
                      setOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      marginBottom: 4,
                      background: "transparent",
                      border: "1px solid transparent",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-2)";
                      e.currentTarget.style.borderColor = "var(--border-1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "transparent";
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        marginBottom: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {t.title}
                      {missingVars.length > 0 && (
                        <span
                          className="chip"
                          style={{
                            fontSize: 9.5,
                            padding: "1px 5px",
                            background: "var(--accent-amber-soft)",
                            color: "var(--accent-amber)",
                          }}
                          title={`Variables sin contexto: ${missingVars.join(", ")}`}
                        >
                          ⚠ {missingVars.length} var
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-2)",
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {rendered}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <div
              style={{
                padding: "6px 10px",
                borderTop: "1px solid var(--border-1)",
                fontSize: 10.5,
                color: "var(--text-3)",
                flexShrink: 0,
                background: "var(--bg-2)",
              }}
            >
              Variables: <code>{`{{nombre}}`}</code> <code>{`{{agente}}`}</code>{" "}
              <code>{`{{cola}}`}</code> <code>{`{{hora}}`}</code>{" "}
              <code>{`{{fecha}}`}</code>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Re-export Icon import for the wrapping ChatThreadPanel — keeps usage clean.
export { Icon };
