import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";

/**
 * KnowledgeEditor — Base de conocimiento / FAQ del agente IA (Pilar 8 · R15).
 * Una KB es { kbId, name, entries:[{ id, q, a, tags? }] }. El `bot-runtime` la
 * lee (por `ragKbId`, elegido en el inspector del nodo Agente IA) y la inyecta
 * al system prompt → el agente responde anclado a estas FAQs en vez de inventar.
 *
 * CRUD contra el endpoint `manageKnowledge` (Authorization Bearer idToken: la
 * tabla es tenant-scoped; sin token el GET vuelve vacío y el POST se no-opea).
 * Misma gramática premium que CatalogEditor (KPI + tiles + editor).
 */
interface KbEntry {
  id: string;
  q: string;
  a: string;
  tags?: string[];
}
interface KbDoc {
  kbId: string;
  name: string;
  entries: KbEntry[];
  updatedBy?: string;
  updatedAt?: string;
}

/** Borrador editable — `tagsText` es el texto crudo separado por comas. */
interface EntryDraft {
  id: string;
  q: string;
  a: string;
  tagsText: string;
}

const NEW = "__new__";
let draftSeq = 0;
const mkId = () => `e${Date.now().toString(36)}_${(draftSeq++).toString(36)}`;

const toDraft = (e: KbEntry): EntryDraft => ({
  id: e.id || mkId(),
  q: e.q,
  a: e.a,
  tagsText: Array.isArray(e.tags) ? e.tags.join(", ") : "",
});
const fromDraft = (d: EntryDraft): KbEntry => ({
  id: d.id,
  q: d.q.trim(),
  a: d.a.trim(),
  tags: d.tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
});

/** Plantillas de arranque — FAQs típicas de una unidad de admisión. */
const TEMPLATES: { name: string; entries: { q: string; a: string; tags?: string[] }[] }[] = [
  {
    name: "FAQ Admisión",
    entries: [
      {
        q: "¿Cuándo cierran las inscripciones?",
        a: "Las inscripciones cierran el último día hábil de cada mes. Te confirmamos la fecha exacta según el programa.",
        tags: ["fechas"],
      },
      {
        q: "¿Qué documentos necesito para postular?",
        a: "DNI, certificado de estudios y una foto tamaño carné. Para algunos programas se pide constancia de trabajo.",
        tags: ["requisitos"],
      },
      {
        q: "¿Hay becas o financiamiento?",
        a: "Sí, contamos con becas por mérito y convenios de financiamiento. Un asesor puede revisar tu caso.",
        tags: ["precio", "becas"],
      },
    ],
  },
  {
    name: "FAQ Soporte",
    entries: [
      {
        q: "¿Cómo recupero mi contraseña?",
        a: "Desde la pantalla de ingreso, toca «Olvidé mi contraseña» y sigue el correo que te enviamos.",
        tags: ["cuenta"],
      },
      {
        q: "¿Cuál es el horario de atención?",
        a: "Atendemos de lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 13:00.",
        tags: ["horario"],
      },
    ],
  },
];

export function KnowledgeEditor() {
  const { user } = useAuth();
  const [kbs, setKbs] = useState<KbDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");

  const load = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageKnowledge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(ep.manageKnowledge);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const list: KbDoc[] = Array.isArray(d.kbs) ? d.kbs : [];
      setKbs(list);
      if (list.length && !activeId) hydrate(list[0]);
    } catch {
      // Antes se tragaba el error → un fallo de red se veía como «sin bases».
      toast.error("No se pudieron cargar las bases de conocimiento. Reintenta.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = (k: KbDoc) => {
    setActiveId(k.kbId);
    setName(k.name);
    setEntries((k.entries || []).map(toDraft));
    setQuery("");
    setDirty(false);
  };

  const newKb = () => {
    setActiveId(NEW);
    setName("Nueva base");
    setEntries([{ id: mkId(), q: "", a: "", tagsText: "" }]);
    setQuery("");
    setDirty(true);
  };

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setActiveId(NEW);
    setName(t.name);
    setEntries(t.entries.map((e) => toDraft({ id: mkId(), ...e })));
    setQuery("");
    setDirty(true);
  };

  const addEntry = () => {
    setEntries((es) => [...es, { id: mkId(), q: "", a: "", tagsText: "" }]);
    setDirty(true);
  };
  const removeEntry = (id: string) => {
    setEntries((es) => es.filter((e) => e.id !== id));
    setDirty(true);
  };
  const patchEntry = (id: string, patch: Partial<EntryDraft>) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  const save = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageKnowledge) {
      toast.error("Endpoint de base de conocimiento no configurado");
      return;
    }
    if (!name.trim()) {
      toast.error("La base necesita un nombre");
      return;
    }
    const clean = entries.map(fromDraft).filter((e) => e.q && e.a);
    if (clean.length === 0) {
      toast.error("Agrega al menos una pregunta con su respuesta");
      return;
    }
    setSaving(true);
    try {
      const r = await authedFetch(ep.manageKnowledge, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kbId: activeId === NEW ? undefined : activeId,
          name: name.trim(),
          entries: clean,
          actor: user?.username || "admin",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast.success("Base de conocimiento guardada");
      setDirty(false);
      await load();
      if (j.kb) hydrate(j.kb);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageKnowledge || !activeId || activeId === NEW) {
      setActiveId(null);
      return;
    }
    if (!confirm(`¿Eliminar la base "${name}"? Los agentes que la usen quedarán sin esa FAQ.`))
      return;
    setDeleting(true);
    try {
      const r = await authedFetch(`${ep.manageKnowledge}?kbId=${encodeURIComponent(activeId)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast.success("Base eliminada");
      setActiveId(null);
      setName("");
      setEntries([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setDeleting(false);
    }
  };

  const ql = query.trim().toLowerCase();
  const visible = entries.filter(
    (e) =>
      !ql ||
      e.q.toLowerCase().includes(ql) ||
      e.a.toLowerCase().includes(ql) ||
      e.tagsText.toLowerCase().includes(ql),
  );
  const totalFaqs = kbs.reduce((n, k) => n + (k.entries?.length || 0), 0);

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Base de conocimiento
          </div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 640, lineHeight: 1.5 }}
          >
            Preguntas y respuestas que <strong>el Agente IA usa para responder</strong>. Anclas una
            base a un nodo «Agente IA» y deja de inventar: contesta citando estas FAQs.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {dirty && (
            <span className="chip chip--amber" style={{ height: 28 }}>
              <span className="dot" /> Sin guardar
            </span>
          )}
          <button className="btn btn--sm" onClick={newKb}>
            <Icon.Plus size={12} /> Nueva
          </button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty}>
            <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
        <Kpi label="Bases" value={kbs.length} color="var(--accent-violet)" />
        <Kpi label="FAQs totales" value={totalFaqs} color="var(--accent-cyan)" />
        <Kpi
          label="FAQs en esta base"
          value={activeId ? entries.length : 0}
          color="var(--accent-green)"
        />
      </div>

      {/* Tiles de bases */}
      {(kbs.length > 0 || activeId === NEW) && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          {kbs.map((k) => {
            const on = k.kbId === activeId;
            return (
              <button
                key={k.kbId}
                onClick={() => hydrate(k)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderRadius: 11,
                  border: `1.5px solid ${on ? "var(--accent-violet)" : "var(--border-1)"}`,
                  background: on ? "var(--accent-violet-soft)" : "var(--bg-1)",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: on ? "var(--accent-violet)" : "var(--bg-3)",
                    color: on ? "#fff" : "var(--text-2)",
                    flex: "0 0 auto",
                  }}
                >
                  <Icon.Knowledge size={15} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      fontSize: 13.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {k.name}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>
                    {k.entries?.length || 0} FAQs
                  </span>
                </span>
              </button>
            );
          })}
          {activeId === NEW && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 11,
                border: "1.5px solid var(--accent-amber)",
                background: "var(--accent-amber-soft)",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "var(--accent-amber)",
                  color: "#fff",
                }}
              >
                <Icon.Plus size={15} />
              </span>
              <span>
                <span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>
                  {name || "Nueva"}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>
                  sin guardar
                </span>
              </span>
            </span>
          )}
          <button
            onClick={newKb}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              padding: "0 16px",
              borderRadius: 11,
              border: "1.5px dashed var(--border-1)",
              background: "transparent",
              color: "var(--text-2)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon.Plus size={14} /> Nueva
          </button>
        </div>
      )}

      {/* Cuerpo */}
      {loading ? (
        <Card>
          <CardBody>
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              Cargando bases…
            </div>
          </CardBody>
        </Card>
      ) : !activeId ? (
        <Card>
          <CardBody>
            <div style={{ textAlign: "center", padding: "34px 24px" }}>
              <div
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 50,
                  height: 50,
                  borderRadius: 15,
                  background: "var(--accent-violet-soft)",
                  color: "var(--accent-violet)",
                  marginBottom: 12,
                }}
              >
                <Icon.Knowledge size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                Todavía no tienes bases de conocimiento
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
                Crea una en blanco o arranca con una plantilla de FAQs.
              </div>
              <div className="row" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn--primary" onClick={newKb}>
                  <Icon.Plus size={13} /> Base en blanco
                </button>
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  margin: "22px 0 10px",
                }}
              >
                O empieza con una plantilla
              </div>
              <div className="row" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => applyTemplate(t)}
                    className="hg-lift"
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      padding: "12px 16px",
                      borderRadius: 11,
                      border: "1px solid var(--border-1)",
                      background: "var(--bg-1)",
                      maxWidth: 260,
                    }}
                  >
                    <div
                      className="row"
                      style={{ gap: 7, alignItems: "center", fontWeight: 700, fontSize: 13 }}
                    >
                      <Icon.Sparkles size={13} style={{ color: "var(--accent-violet)" }} /> {t.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {t.entries.length} preguntas listas
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {/* Nombre + toolbar */}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Nombre de la base (p. ej. FAQ Admisión 2026)"
              style={{
                flex: 1,
                minWidth: 220,
                fontWeight: 700,
                fontSize: 15,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-1)",
                background: "var(--bg-1)",
                color: "var(--text-1)",
                outline: "none",
              }}
            />
            <div
              className="row"
              style={{
                gap: 7,
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-1)",
                background: "var(--bg-1)",
                flex: "0 0 auto",
              }}
            >
              <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar FAQs…"
                style={{
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  fontSize: 13,
                  color: "var(--text-1)",
                  width: 150,
                }}
              />
            </div>
            {activeId !== NEW && (
              <button
                className="btn btn--sm"
                onClick={del}
                disabled={deleting}
                title="Eliminar base"
              >
                <Icon.Trash size={13} /> {deleting ? "…" : "Eliminar"}
              </button>
            )}
          </div>

          {/* Lista de FAQs */}
          {visible.length === 0 ? (
            <Card>
              <CardBody>
                <div className="muted" style={{ padding: 22, textAlign: "center", fontSize: 12.5 }}>
                  {query
                    ? "Ninguna FAQ coincide con la búsqueda."
                    : "Sin FAQs. Agrega la primera abajo."}
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {visible.map((e, idx) => (
                <div
                  key={e.id}
                  style={{
                    borderRadius: 12,
                    border: "1px solid var(--border-1)",
                    background: "var(--bg-1)",
                    padding: "12px 14px",
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        minWidth: 22,
                        height: 22,
                        borderRadius: 6,
                        background: "var(--accent-violet-soft)",
                        color: "var(--accent-violet)",
                        fontSize: 11,
                        fontWeight: 800,
                        marginTop: 5,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div className="col" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                      <input
                        value={e.q}
                        onChange={(ev) => patchEntry(e.id, { q: ev.target.value })}
                        placeholder="Pregunta del cliente (¿…?)"
                        style={{
                          width: "100%",
                          fontWeight: 700,
                          fontSize: 13.5,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border-1)",
                          background: "var(--bg-2)",
                          color: "var(--text-1)",
                          outline: "none",
                        }}
                      />
                      <textarea
                        value={e.a}
                        onChange={(ev) => patchEntry(e.id, { a: ev.target.value })}
                        placeholder="Respuesta que dará el agente…"
                        rows={2}
                        style={{
                          width: "100%",
                          fontSize: 13,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border-1)",
                          background: "var(--bg-2)",
                          color: "var(--text-1)",
                          outline: "none",
                          resize: "vertical",
                          lineHeight: 1.5,
                        }}
                      />
                      <div className="row" style={{ gap: 7, alignItems: "center" }}>
                        <Icon.Tag size={12} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
                        <input
                          value={e.tagsText}
                          onChange={(ev) => patchEntry(e.id, { tagsText: ev.target.value })}
                          placeholder="Etiquetas (separadas por coma): precio, fechas…"
                          style={{
                            flex: 1,
                            fontSize: 12,
                            padding: "6px 8px",
                            borderRadius: 7,
                            border: "1px solid var(--border-1)",
                            background: "transparent",
                            color: "var(--text-2)",
                            outline: "none",
                          }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => removeEntry(e.id)}
                      title="Eliminar FAQ"
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "var(--text-3)",
                        display: "grid",
                        placeItems: "center",
                        padding: 4,
                        flex: "0 0 auto",
                        marginTop: 4,
                      }}
                    >
                      <Icon.Trash size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <button className="btn btn--sm" onClick={addEntry}>
              <Icon.Plus size={12} /> Agregar FAQ
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {query
                ? `${visible.length} de ${entries.length} FAQs`
                : `${entries.length} FAQ${entries.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
