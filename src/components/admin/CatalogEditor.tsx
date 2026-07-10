import { useEffect, useState } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";

/**
 * CatalogEditor — Custom Lists / Catálogos (roadmap #30). Tablas de referencia
 * reutilizables (precios, programas, motivos…) sobre connectview-catalogs.
 *
 * Rediseño premium + funcional (#config): KPI strip + tiles de catálogos + grid
 * editable premium, y —la clave para que se USE— **importar pegando desde Excel/
 * Sheets** (CSV/TSV autodetectado), exportar a CSV, buscar filas y plantillas de
 * arranque. El CRUD contra el endpoint manageCatalog es el mismo de antes.
 */
interface CatalogDoc {
  catalogId: string;
  name: string;
  columns: string[];
  rows: string[][];
  updatedBy?: string;
  updatedAt?: string;
}

/** Plantillas de arranque — columnas sensatas para los catálogos más comunes. */
const TEMPLATES: { name: string; columns: string[] }[] = [
  { name: "Lista de precios", columns: ["Producto / Servicio", "Precio", "Notas"] },
  { name: "Programas / Carreras", columns: ["Programa", "Modalidad", "Duración", "Precio"] },
  { name: "Motivos / Tipologías", columns: ["Motivo", "Descripción"] },
];

export function CatalogEditor() {
  const { user } = useAuth();
  const [catalogs, setCatalogs] = useState<CatalogDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const load = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageCatalog) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(ep.manageCatalog);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const list: CatalogDoc[] = Array.isArray(d.catalogs) ? d.catalogs : [];
      setCatalogs(list);
      if (list.length && !activeId) hydrate(list[0]);
    } catch {
      // Antes se tragaba el error → un fallo de red se veía como «sin catálogos».
      toast.error("No se pudieron cargar los catálogos. Reintenta.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = (c: CatalogDoc) => {
    setActiveId(c.catalogId);
    setName(c.name);
    setColumns([...c.columns]);
    setRows(c.rows.map((r) => [...r]));
    setQuery("");
    setDirty(false);
  };

  const newCatalog = () => {
    setActiveId("__new__");
    setName("Nuevo catálogo");
    setColumns(["Columna 1", "Columna 2"]);
    setRows([["", ""]]);
    setQuery("");
    setDirty(true);
  };

  const applyTemplate = (t: { name: string; columns: string[] }) => {
    setActiveId("__new__");
    setName(t.name);
    setColumns([...t.columns]);
    setRows([t.columns.map(() => "")]);
    setQuery("");
    setDirty(true);
  };

  const addColumn = () => {
    setColumns((c) => [...c, `Columna ${c.length + 1}`]);
    setRows((rs) => rs.map((r) => [...r, ""]));
    setDirty(true);
  };
  const removeColumn = (i: number) => {
    setColumns((c) => c.filter((_, idx) => idx !== i));
    setRows((rs) => rs.map((r) => r.filter((_, idx) => idx !== i)));
    setDirty(true);
  };
  const addRow = () => {
    setRows((rs) => [...rs, columns.map(() => "")]);
    setDirty(true);
  };
  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  /** Importar pegando desde Excel/Sheets — autodetecta tabulaciones o comas.
   *  La primera fila se toma como encabezado. Crea un catálogo nuevo (sin guardar). */
  const doImport = () => {
    const text = importText.trim();
    if (!text) {
      toast.error("Pega algo primero (copia un rango de Excel o Sheets)");
      return;
    }
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const data = (res.data as string[][]).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
    if (data.length === 0) {
      toast.error("No se detectaron filas");
      return;
    }
    const header = data[0].map((h, i) => (h ?? "").trim() || `Columna ${i + 1}`);
    const body = data.slice(1).map((r) => header.map((_, i) => r[i] ?? ""));
    setActiveId("__new__");
    setName((n) => (n && n !== "Nuevo catálogo" ? n : "Catálogo importado"));
    setColumns(header);
    setRows(body.length ? body : [header.map(() => "")]);
    setQuery("");
    setDirty(true);
    setImportOpen(false);
    setImportText("");
    toast.success(
      `Importado: ${header.length} columnas · ${body.length} fila${body.length === 1 ? "" : "s"}`,
    );
  };

  const exportCsv = () => {
    const csv = Papa.unparse([columns, ...rows]);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "catalogo").replace(/[^\w-]+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageCatalog) {
      toast.error("Endpoint de catálogos no configurado");
      return;
    }
    if (!name.trim() || columns.length === 0) {
      toast.error("El catálogo necesita nombre y al menos una columna");
      return;
    }
    setSaving(true);
    try {
      // authedFetch → Bearer idToken (manage-catalog es tenant-scoped; sin token
      // el GET venía vacío y el POST se no-opeaba silenciosamente).
      const r = await authedFetch(ep.manageCatalog, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogId: activeId === "__new__" ? undefined : activeId,
          name: name.trim(),
          columns,
          rows,
          actor: user?.username || "admin",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast.success("Catálogo guardado");
      setDirty(false);
      await load();
      if (j.catalog) hydrate(j.catalog);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const visibleRows = rows
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        !query.trim() || r.some((c) => (c ?? "").toLowerCase().includes(query.toLowerCase())),
    );

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
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Catálogos</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 620, lineHeight: 1.5 }}
          >
            Listas de referencia reutilizables (precios, programas, motivos…).{" "}
            <strong>Importa tu Excel pegándolo</strong> y queda listo para que el equipo lo
            consulte.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {dirty && (
            <span className="chip chip--amber" style={{ height: 28 }}>
              <span className="dot" /> Sin guardar
            </span>
          )}
          <button className="btn btn--sm" onClick={() => setImportOpen((o) => !o)}>
            <Icon.Copy size={12} /> Importar
          </button>
          <button className="btn btn--sm" onClick={newCatalog}>
            <Icon.Plus size={12} /> Nuevo
          </button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty}>
            <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
        <Kpi label="Catálogos" value={catalogs.length} color="var(--accent-cyan)" />
        <Kpi label="Filas" value={activeId ? rows.length : 0} color="var(--accent-violet)" />
        <Kpi label="Columnas" value={activeId ? columns.length : 0} color="var(--accent-green)" />
      </div>

      {/* Importar (panel desplegable) */}
      {importOpen && (
        <div
          style={{
            borderRadius: 12,
            border: "1px solid var(--accent-cyan)",
            background: "var(--accent-cyan-soft)",
            padding: "14px 16px",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            Pega tu tabla desde Excel o Google Sheets
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
            La <b>primera fila</b> se toma como encabezado. Detecta tabulaciones o comas solo.
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={
              "Programa\tModalidad\tPrecio\nIng. de Sistemas\tVirtual\t1200\nAdministración\tPresencial\t980"
            }
            rows={5}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12.5,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border-1)",
              background: "var(--bg-1)",
              color: "var(--text-1)",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn btn--primary btn--sm" onClick={doImport}>
              <Icon.Check size={12} /> Detectar y crear
            </button>
            <button
              className="btn btn--sm"
              onClick={() => {
                setImportOpen(false);
                setImportText("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tiles de catálogos (cambiar entre catálogos) */}
      {(catalogs.length > 0 || activeId === "__new__") && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          {catalogs.map((c) => {
            const on = c.catalogId === activeId;
            return (
              <button
                key={c.catalogId}
                onClick={() => hydrate(c)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderRadius: 11,
                  border: `1.5px solid ${on ? "var(--accent-cyan)" : "var(--border-1)"}`,
                  background: on ? "var(--accent-cyan-soft)" : "var(--bg-1)",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: on ? "var(--accent-cyan)" : "var(--bg-3)",
                    color: on ? "#fff" : "var(--text-2)",
                    flex: "0 0 auto",
                  }}
                >
                  <Icon.Pad size={15} />
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
                    {c.name}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>
                    {c.rows.length} filas · {c.columns.length} col
                  </span>
                </span>
              </button>
            );
          })}
          {activeId === "__new__" && (
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
                  {name || "Nuevo"}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>
                  sin guardar
                </span>
              </span>
            </span>
          )}
          <button
            onClick={newCatalog}
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
            <Icon.Plus size={14} /> Nuevo
          </button>
        </div>
      )}

      {/* Cuerpo: editor o empty state */}
      {loading ? (
        <Card>
          <CardBody>
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              Cargando catálogos…
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
                  background: "var(--accent-cyan-soft)",
                  color: "var(--accent-cyan)",
                  marginBottom: 12,
                }}
              >
                <Icon.Pad size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Todavía no tienes catálogos</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
                Crea uno en blanco, importá tu Excel, o arranca con una plantilla.
              </div>
              <div className="row" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn--primary" onClick={newCatalog}>
                  <Icon.Plus size={13} /> Catálogo en blanco
                </button>
                <button className="btn" onClick={() => setImportOpen(true)}>
                  <Icon.Copy size={13} /> Importar de Excel
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
                      maxWidth: 230,
                    }}
                  >
                    <div
                      className="row"
                      style={{ gap: 7, alignItems: "center", fontWeight: 700, fontSize: 13 }}
                    >
                      <Icon.Sparkles size={13} style={{ color: "var(--accent-violet)" }} /> {t.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {t.columns.join(" · ")}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {/* Nombre + toolbar (buscar / exportar) */}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Nombre del catálogo"
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
                placeholder="Buscar filas…"
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
            <button className="btn btn--sm" onClick={exportCsv} title="Descargar como CSV">
              <Icon.Download size={13} /> CSV
            </button>
          </div>

          {/* Grid premium */}
          <div
            style={{
              overflowX: "auto",
              borderRadius: 12,
              border: "1px solid var(--border-1)",
              background: "var(--bg-1)",
            }}
          >
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-2)" }}>
                  <th
                    style={{
                      width: 34,
                      padding: "8px 6px",
                      borderBottom: "1px solid var(--border-1)",
                      color: "var(--text-3)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    #
                  </th>
                  {columns.map((col, ci) => (
                    <th
                      key={ci}
                      style={{
                        padding: "6px 8px",
                        borderBottom: "1px solid var(--border-1)",
                        textAlign: "left",
                        minWidth: 150,
                      }}
                    >
                      <div className="row" style={{ gap: 4, alignItems: "center" }}>
                        <input
                          value={col}
                          onChange={(e) => {
                            setColumns((c) => c.map((x, idx) => (idx === ci ? e.target.value : x)));
                            setDirty(true);
                          }}
                          style={{
                            width: "100%",
                            border: "none",
                            background: "transparent",
                            fontWeight: 700,
                            fontSize: 12.5,
                            color: "var(--text-1)",
                            outline: "none",
                            textTransform: "uppercase",
                            letterSpacing: ".02em",
                          }}
                        />
                        <button
                          onClick={() => removeColumn(ci)}
                          title="Eliminar columna"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "var(--text-3)",
                            display: "grid",
                            placeItems: "center",
                            padding: 2,
                            flex: "0 0 auto",
                          }}
                        >
                          <Icon.Close size={11} />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th
                    style={{
                      padding: "6px 8px",
                      borderBottom: "1px solid var(--border-1)",
                      width: 60,
                    }}
                  >
                    <button
                      onClick={addColumn}
                      title="Agregar columna"
                      style={{
                        border: "1px dashed var(--border-1)",
                        background: "transparent",
                        cursor: "pointer",
                        color: "var(--text-2)",
                        borderRadius: 7,
                        padding: "4px 8px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Icon.Plus size={11} /> Col
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      style={{
                        padding: 24,
                        textAlign: "center",
                        color: "var(--text-3)",
                        fontSize: 12.5,
                      }}
                    >
                      {query
                        ? "Ninguna fila coincide con la búsqueda."
                        : "Sin filas. Agrega la primera abajo."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map(({ r, i }) => (
                    <tr key={i} style={{ background: i % 2 === 1 ? "var(--bg-2)" : "transparent" }}>
                      <td
                        style={{
                          padding: "0 6px",
                          color: "var(--text-3)",
                          fontSize: 11,
                          textAlign: "center",
                          borderBottom: "1px solid var(--border-1)",
                        }}
                        className="mono"
                      >
                        {i + 1}
                      </td>
                      {columns.map((_, ci) => (
                        <td
                          key={ci}
                          style={{ padding: 0, borderBottom: "1px solid var(--border-1)" }}
                        >
                          <input
                            value={r[ci] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((rs) =>
                                rs.map((rr, idx) =>
                                  idx === i ? rr.map((c, j) => (j === ci ? val : c)) : rr,
                                ),
                              );
                              setDirty(true);
                            }}
                            style={{
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              padding: "9px 8px",
                              fontSize: 13,
                              color: "var(--text-1)",
                              outline: "none",
                            }}
                          />
                        </td>
                      ))}
                      <td
                        style={{
                          padding: "0 8px",
                          borderBottom: "1px solid var(--border-1)",
                          textAlign: "center",
                        }}
                      >
                        <button
                          onClick={() => removeRow(i)}
                          title="Eliminar fila"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "var(--text-3)",
                            display: "grid",
                            placeItems: "center",
                            padding: 4,
                            margin: "0 auto",
                          }}
                        >
                          <Icon.Trash size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <button className="btn btn--sm" onClick={addRow}>
              <Icon.Plus size={12} /> Agregar fila
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {query
                ? `${visibleRows.length} de ${rows.length} filas`
                : `${rows.length} fila${rows.length === 1 ? "" : "s"}`}{" "}
              · {columns.length} columnas
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
