import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * CatalogEditor — admin UI for Custom Lists / Catálogos (roadmap #30).
 * Arbitrary lookup tables (products, price lists, motivos) the team can
 * reference from leads, the bot, or scripts. CRUD over connectview-catalogs.
 */
interface CatalogDoc {
  catalogId: string;
  name: string;
  columns: string[];
  rows: string[][];
  updatedBy?: string;
  updatedAt?: string;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "6px 9px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};

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

  const load = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageCatalog) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(ep.manageCatalog);
      const d = await r.json();
      const list: CatalogDoc[] = Array.isArray(d.catalogs) ? d.catalogs : [];
      setCatalogs(list);
      if (list.length && !activeId) hydrate(list[0]);
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
    setDirty(false);
  };

  const newCatalog = () => {
    setActiveId("__new__");
    setName("Nuevo catálogo");
    setColumns(["Columna 1", "Columna 2"]);
    setRows([["", ""]]);
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

  const save = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageCatalog) return;
    if (!name.trim() || columns.length === 0) {
      toast.error("El catálogo necesita nombre y al menos una columna");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(ep.manageCatalog, {
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

  return (
    <Card>
      <CardHead
        title="Catálogos · listas de referencia"
        right={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm" onClick={newCatalog}>
              <Icon.Plus size={12} /> Nuevo
            </button>
            <button className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty}>
              <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        }
      />
      <CardBody>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
          Tablas de referencia reutilizables (productos, precios, motivos…) que
          luego podés citar desde leads, el bot o los guiones del agente.
        </div>

        <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          {catalogs.length > 0 && (
            <select
              value={activeId ?? ""}
              onChange={(e) => {
                const c = catalogs.find((x) => x.catalogId === e.target.value);
                if (c) hydrate(c);
              }}
              style={inputStyle}
            >
              {catalogs.map((c) => (
                <option key={c.catalogId} value={c.catalogId}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            placeholder="Nombre del catálogo"
            style={{ ...inputStyle, flex: 1, minWidth: 200, fontWeight: 600 }}
          />
        </div>

        {loading ? (
          <div className="muted" style={{ padding: 20, textAlign: "center" }}>Cargando…</div>
        ) : activeId ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {columns.map((col, ci) => (
                    <th key={ci} style={{ padding: 3 }}>
                      <div className="row" style={{ gap: 2 }}>
                        <input
                          value={col}
                          onChange={(e) => {
                            setColumns((c) => c.map((x, idx) => (idx === ci ? e.target.value : x)));
                            setDirty(true);
                          }}
                          style={{ ...inputStyle, width: 130, fontWeight: 600 }}
                        />
                        <button
                          className="btn btn--ghost btn--sm btn--icon"
                          onClick={() => removeColumn(ci)}
                          title="Eliminar columna"
                        >
                          <Icon.Close size={11} />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th style={{ padding: 3 }}>
                    <button className="btn btn--ghost btn--sm" onClick={addColumn}>
                      <Icon.Plus size={11} /> Col
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {columns.map((_, ci) => (
                      <td key={ci} style={{ padding: 3 }}>
                        <input
                          value={row[ci] ?? ""}
                          onChange={(e) => {
                            setRows((rs) =>
                              rs.map((r, idx) =>
                                idx === ri ? r.map((c, j) => (j === ci ? e.target.value : c)) : r
                              )
                            );
                            setDirty(true);
                          }}
                          style={{ ...inputStyle, width: 130 }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: 3 }}>
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        onClick={() => removeRow(ri)}
                        title="Eliminar fila"
                      >
                        <Icon.Trash size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn--sm" onClick={addRow} style={{ marginTop: 8 }}>
              <Icon.Plus size={12} /> Agregar fila
            </button>
          </div>
        ) : (
          <div className="muted" style={{ padding: 20, textAlign: "center" }}>
            No hay catálogos. Creá uno con "Nuevo".
          </div>
        )}
      </CardBody>
    </Card>
  );
}
