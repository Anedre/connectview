import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  Users,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wand2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProgram } from "@/context/ProgramContext";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import type { Valoracion } from "@/lib/dispositions";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { parseCsvText, type ParsedContact } from "@/lib/csvParser";

export interface ImportSummary {
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  dropped: number;
}

/**
 * LeadImportModal — importa un CSV histórico como LEADS de un programa, SIN lanzar
 * ninguna llamada. Reutiliza el parser de CSV de campañas y el motor idempotente
 * `importLeads` (dedup por teléfono).
 *
 * Import ORGÁNICO (para replicar dashboards tipo el QuickSight de UDEP): además del
 * teléfono/nombre, un WIZARD DE MAPEO cuadra columna del CSV → campo de ARIA
 * (Estado, Sub-Estado, Agente, Origen, Comentario, Fec. tipificación, Fec. carga,
 * Email). El Estado se resuelve contra la taxonomía del programa; el backend siembra
 * un evento de history por lead → la vista de Tipificaciones muestra estado,
 * sub-estado, agente, comentario y fecha CUADRADOS, como si se hubiera gestionado
 * en ARIA.
 */

type FieldKey =
  | "estado"
  | "sub"
  | "agente"
  | "origen"
  | "comentario"
  | "fechaTip"
  | "fechaCarga"
  | "email";
type Mapping = Record<FieldKey, string>;

const EMPTY_MAPPING: Mapping = {
  estado: "",
  sub: "",
  agente: "",
  origen: "",
  comentario: "",
  fechaTip: "",
  fechaCarga: "",
  email: "",
};

const FIELD_DEFS: Array<{ key: FieldKey; label: string; keywords: string[] }> = [
  {
    key: "estado",
    label: "Estado",
    keywords: ["estado", "etapa", "stage", "disposition", "tipific"],
  },
  {
    key: "sub",
    label: "Sub-estado",
    keywords: [
      "sub estado",
      "sub. estado",
      "sub-estado",
      "subestado",
      "substage",
      "motivo",
      "razon",
      "razón",
    ],
  },
  {
    key: "agente",
    label: "Agente",
    keywords: ["agente", "asesor", "agent", "ejecutivo", "vendedor", "owner", "responsable"],
  },
  {
    key: "origen",
    label: "Origen",
    keywords: ["origen", "fuente", "source", "canal", "medio", "procedencia"],
  },
  {
    key: "comentario",
    label: "Comentario",
    keywords: ["comentario", "observ", "nota", "comment", "detalle", "glosa"],
  },
  { key: "fechaTip", label: "Fec. tipificación", keywords: ["tipific", "gestion", "gestión"] },
  {
    key: "fechaCarga",
    label: "Fec. carga",
    keywords: ["carga", "created", "ingreso", "registro", "alta"],
  },
  { key: "email", label: "Email", keywords: ["email", "correo", "mail", "e-mail"] },
];

const VAL_COLOR: Record<Valoracion, string> = {
  inicial: "var(--cyan)",
  positiva: "var(--green)",
  negativa: "var(--red)",
  cierre: "var(--iris)",
};

const normStage = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const slug = (s: string): string => normStage(s).replace(/\s+/g, "_").slice(0, 48) || "sin_etapa";

/** Parsea fechas del CSV: dd/MM/yyyy [HH:mm[:ss]], yyyy-MM-dd o ISO → ISO. */
function parseFlexibleDate(raw?: string): string | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, d, mo, y, h, mi, se] = m;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(
      yr,
      Number(mo) - 1,
      Number(d),
      Number(h || 0),
      Number(mi || 0),
      Number(se || 0),
    );
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  const t = Date.parse(s);
  return isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Auto-mapea columnas del CSV a campos por heurística de header (editable luego). */
function autoDetect(cols: string[]): Mapping {
  const used = new Set<string>();
  const m: Mapping = { ...EMPTY_MAPPING };
  for (const f of FIELD_DEFS) {
    const hit = cols.find((col) => {
      if (used.has(col)) return false;
      const h = col.toLowerCase();
      const isDate = /fec|fecha|hora|date/.test(h);
      if ((f.key === "fechaTip" || f.key === "fechaCarga") && !isDate) return false;
      if ((f.key === "estado" || f.key === "sub") && isDate) return false;
      return f.keywords.some((k) => h.includes(k));
    });
    if (hit) {
      m[f.key] = hit;
      used.add(hit);
    }
  }
  return m;
}

/** `<select>` nativo compacto (columna del CSV) con estilo ARIA. */
function ColSelect({
  value,
  onChange,
  cols,
}: {
  value: string;
  onChange: (v: string) => void;
  cols: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "auto",
        height: 32,
        width: "100%",
        borderRadius: 8,
        border: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        color: value ? "var(--text-1)" : "var(--text-3)",
        padding: "0 8px",
        fontSize: 12.5,
        fontWeight: 600,
      }}
    >
      <option value="">— ninguna —</option>
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function LeadImportModal({
  open,
  onClose,
  defaultProgramId,
  lockProgram,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  defaultProgramId?: string;
  lockProgram?: boolean;
  onImported?: (summary: ImportSummary) => void;
}) {
  const { programs, activeProgramId } = useProgram();
  const activePrograms = useMemo(
    () => programs.filter((p) => p.status !== "archivado"),
    [programs],
  );
  const [programId, setProgramId] = useState<string>(
    defaultProgramId ||
      (activeProgramId !== "all" && activeProgramId !== "none" ? activeProgramId : ""),
  );
  useEffect(() => {
    if (defaultProgramId) setProgramId(defaultProgramId);
  }, [defaultProgramId, open]);

  const selectedProgram = programs.find((p) => p.programId === programId);
  const { tree } = useTaxonomy(selectedProgram?.taxonomyId);

  const [stageId, setStageId] = useState<string>("");
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({ ...EMPTY_MAPPING });
  const fileRef = useRef<HTMLInputElement>(null);

  // Etapa inicial = primera del embudo del programa; se re-sincroniza si cambia.
  useEffect(() => {
    if (tree.length && !tree.some((s) => s.id === stageId)) setStageId(tree[0].id);
  }, [tree, stageId]);

  // Todas las columnas de datos presentes en el CSV (unión, no solo la 1ª fila).
  const cols = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) for (const k of Object.keys(c.attributes)) s.add(k);
    return Array.from(s);
  }, [contacts]);

  // Índice de la taxonomía (label/id normalizado → etapa) para resolver el Estado.
  const stageIndex = useMemo(() => {
    const m = new Map<string, { id: string; label: string; valoracion: Valoracion }>();
    for (const s of tree) {
      const entry = { id: s.id, label: s.label, valoracion: s.valoracion };
      m.set(normStage(s.label), entry);
      m.set(normStage(s.id), entry);
    }
    return m;
  }, [tree]);
  const resolveStage = (raw: string) => stageIndex.get(normStage(raw)) || null;

  // Cada fila enriquecida con los campos mapeados + el Estado resuelto.
  const enriched = useMemo(() => {
    return contacts.map((c) => {
      const val = (k: FieldKey) => (mapping[k] ? (c.attributes[mapping[k]] || "").trim() : "");
      const estadoRaw = val("estado");
      const st = estadoRaw ? resolveStage(estadoRaw) : null;
      return {
        c,
        estadoRaw,
        st,
        stageIdRow: st ? st.id : estadoRaw ? slug(estadoRaw) : undefined,
        stageLabelRow: st ? st.label : estadoRaw || undefined,
        valRow: st ? st.valoracion : undefined,
        sub: val("sub"),
        agente: val("agente"),
        origen: val("origen"),
        comentario: val("comentario"),
        email: val("email"),
        fechaTip: mapping.fechaTip ? parseFlexibleDate(c.attributes[mapping.fechaTip]) : undefined,
        fechaCarga: mapping.fechaCarga
          ? parseFlexibleDate(c.attributes[mapping.fechaCarga])
          : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, mapping, stageIndex]);

  const withEstado = enriched.filter((e) => e.estadoRaw).length;
  const recognized = enriched.filter((e) => e.st).length;
  const unknownStages = useMemo(
    () =>
      Array.from(
        new Set(enriched.filter((e) => e.estadoRaw && !e.st).map((e) => e.estadoRaw)),
      ).slice(0, 8),
    [enriched],
  );

  const clearFile = () => {
    setContacts([]);
    setSkipped(0);
    setFileName("");
    setParseError(null);
    setMapping({ ...EMPTY_MAPPING });
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFilePick = async (file: File) => {
    setParseError(null);
    setFileName(file.name);
    try {
      const result = await parseCsvText(await file.text(), "PE");
      if (!result.detected.phoneColumn) {
        setParseError("No se detectó una columna de teléfono en el archivo.");
        setContacts([]);
        return;
      }
      setContacts(result.contacts);
      setSkipped(result.skipped.length);
      setMapping(autoDetect(result.detected.attributeColumns));
    } catch {
      setParseError("No se pudo leer el archivo. ¿Es un CSV válido?");
      setContacts([]);
    }
  };

  const doImport = async () => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) {
      toast.error("Endpoint no disponible");
      return;
    }
    if (contacts.length === 0) {
      toast.error("Carga un CSV con contactos primero");
      return;
    }
    setImporting(true);
    try {
      const payload = enriched.map((e) => ({
        phone: e.c.phone,
        name: e.c.customerName || undefined,
        email: e.email || undefined,
        source: e.origen || undefined,
        assignedAgent: e.agente || undefined,
        stageId: e.stageIdRow,
        stageLabel: e.stageLabelRow,
        subStageLabel: e.sub || undefined,
        valoracion: e.valRow,
        comment: e.comentario || undefined,
        typifiedAt: e.fechaTip,
        createdAt: e.fechaCarga,
        attributes: e.c.attributes,
      }));
      const r = await authedFetch(ep.manageLeads, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "importLeads",
          programId: programId || undefined,
          stageId: stageId || undefined,
          contacts: payload,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      const created = d.created ?? 0;
      const updated = d.updated ?? 0;
      const sk = d.skipped ?? 0;
      const dropped = d.dropped ?? 0;
      toast.success(`Importados: ${created} nuevos · ${updated} actualizados`, {
        description:
          [
            selectedProgram ? `En "${selectedProgram.name}"` : "Sin programa",
            withEstado ? `${recognized}/${withEstado} con estado reconocido` : "",
            sk ? `${sk} sin teléfono válido` : "",
            dropped ? `${dropped} no procesados — reintenta` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      onImported?.(d as ImportSummary);
      clearFile();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo importar");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          clearFile();
          onClose();
        }
      }}
      title={
        <span className="row gap10" style={{ alignItems: "center" }}>
          <span className="card__ico" style={{ ["--_c" as string]: "var(--gold)" }}>
            <Users size={16} />
          </span>
          Importar leads (CSV)
        </span>
      }
      className="max-w-2xl"
      footer={
        <div className="row between" style={{ width: "100%", alignItems: "center", gap: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            {contacts.length > 0 ? (
              <>
                <b style={{ color: "var(--text-1)" }}>{contacts.length}</b> listos para importar
              </>
            ) : (
              "No se llama a nadie — solo se cargan al tablero"
            )}
          </span>
          <div className="row gap8">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={doImport}
              disabled={contacts.length === 0 || importing || !stageId}
            >
              {importing ? (
                <span className="row gap6" style={{ alignItems: "center" }}>
                  <Loader2 size={14} className="animate-spin" /> Importando…
                </span>
              ) : (
                `Importar ${contacts.length || ""} leads`.trim()
              )}
            </button>
          </div>
        </div>
      }
    >
      <div
        style={{
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxHeight: "64vh",
          overflowY: "auto",
        }}
      >
        {/* Dropzone / file picker */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFilePick(f);
          }}
        />
        {contacts.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="col gap8"
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: "26px 16px",
              borderRadius: "var(--r-lg)",
              border: "1.5px dashed var(--border-2)",
              background: "var(--bg-2)",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <Upload size={26} style={{ color: "var(--text-3)" }} />
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Haz clic para subir tu CSV</div>
            <div className="dim" style={{ fontSize: 11.5 }}>
              Detectamos las columnas solas (teléfono, nombre, estado, agente…). También .tsv o .txt
            </div>
            {parseError && (
              <div
                className="row gap6"
                style={{ alignItems: "center", color: "var(--red)", fontSize: 12, marginTop: 4 }}
              >
                <AlertTriangle size={13} /> {parseError}
              </div>
            )}
          </button>
        ) : (
          <div
            className="col gap8"
            style={{
              padding: "12px 13px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border-1)",
              background: "var(--bg-2)",
            }}
          >
            <div className="row between" style={{ alignItems: "center" }}>
              <span className="row gap8" style={{ alignItems: "center", minWidth: 0 }}>
                <FileSpreadsheet size={16} style={{ color: "var(--green)", flexShrink: 0 }} />
                <b className="trunc" style={{ fontSize: 13 }}>
                  {fileName || "archivo.csv"}
                </b>
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ fontSize: 12, padding: "3px 8px" }}
                onClick={clearFile}
              >
                Cambiar
              </button>
            </div>
            <div className="row gap12" style={{ alignItems: "center", fontSize: 12.5 }}>
              <span className="row gap6" style={{ alignItems: "center", color: "var(--green)" }}>
                <CheckCircle2 size={14} /> {contacts.length} contactos
              </span>
              {skipped > 0 && (
                <span className="dim">{skipped} saltados (sin teléfono válido o duplicados)</span>
              )}
            </div>
          </div>
        )}

        {/* Programa destino */}
        <div className="col gap6">
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
            Programa destino
          </label>
          {lockProgram ? (
            <div
              className="row gap8"
              style={{
                alignItems: "center",
                padding: "9px 11px",
                borderRadius: "var(--r-md)",
                border: "1px solid var(--border-1)",
                background: "var(--bg-2)",
                fontSize: 13,
              }}
            >
              <span className="dot" style={{ background: "var(--gold)" }} />
              <b>{selectedProgram?.name ?? "Programa"}</b>
            </div>
          ) : (
            <Select
              value={programId || "none"}
              onValueChange={(v) => setProgramId(v && v !== "none" ? v : "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin programa">
                  {programId ? (selectedProgram?.name ?? "Programa") : "Sin programa"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin programa (solo al pool general)</SelectItem>
                {activePrograms.map((p) => (
                  <SelectItem key={p.programId} value={p.programId}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Mapeo de columnas (import orgánico) — solo con un CSV cargado y columnas */}
        {contacts.length > 0 && cols.length > 0 && (
          <div
            className="col gap10"
            style={{
              padding: "13px 14px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border-1)",
              background: "var(--bg-1)",
            }}
          >
            <div className="row between" style={{ alignItems: "center", gap: 10 }}>
              <span className="row gap8" style={{ alignItems: "center" }}>
                <Wand2 size={15} style={{ color: "var(--gold)" }} />
                <b style={{ fontSize: 13 }}>Mapeo de columnas</b>
              </span>
              {withEstado > 0 && (
                <span
                  className="chip"
                  style={{
                    fontSize: 11,
                    color: recognized === withEstado ? "var(--green)" : "var(--gold)",
                    background:
                      recognized === withEstado
                        ? "var(--accent-green-soft)"
                        : "var(--accent-gold-soft)",
                  }}
                >
                  {recognized}/{withEstado} estados reconocidos
                </span>
              )}
            </div>
            <span className="dim" style={{ fontSize: 11.5, marginTop: -4 }}>
              Cuadramos cada columna del CSV con su campo en ARIA. Ajusta si algo quedó mal.
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 10,
              }}
            >
              {FIELD_DEFS.map((f) => (
                <div key={f.key} className="col" style={{ gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>
                    {f.label}
                  </label>
                  <ColSelect
                    value={mapping[f.key]}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                    cols={cols}
                  />
                </div>
              ))}
            </div>
            {unknownStages.length > 0 && (
              <div className="row wrap gap6" style={{ alignItems: "center", marginTop: 2 }}>
                <span className="dim" style={{ fontSize: 11 }}>
                  Estados sin equivalencia en el embudo (entran tal cual):
                </span>
                {unknownStages.map((u) => (
                  <span
                    key={u}
                    className="chip"
                    style={{ height: 20, fontSize: 10.5, color: "var(--text-2)" }}
                  >
                    {u}
                  </span>
                ))}
              </div>
            )}

            {/* Preview de las primeras filas ya cuadradas */}
            <div style={{ overflowX: "auto", marginTop: 4 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                    {["Teléfono", "Nombre", "Estado", "Sub", "Agente", "Origen", "Fec. tip."].map(
                      (h) => (
                        <th
                          key={h}
                          style={{ padding: "4px 8px", fontWeight: 700, whiteSpace: "nowrap" }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {enriched.slice(0, 4).map((e, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border-1)" }}>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{e.c.phone}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        {e.c.customerName || "—"}
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        {e.stageLabelRow ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              color: e.valRow ? VAL_COLOR[e.valRow] : "var(--text-3)",
                              fontWeight: 700,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: e.valRow ? VAL_COLOR[e.valRow] : "var(--text-3)",
                              }}
                            />
                            {e.stageLabelRow}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "var(--text-2)" }}
                      >
                        {e.sub || "—"}
                      </td>
                      <td
                        style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "var(--text-2)" }}
                      >
                        {e.agente || "—"}
                      </td>
                      <td
                        style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "var(--text-2)" }}
                      >
                        {e.origen || "—"}
                      </td>
                      <td
                        style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "var(--text-2)" }}
                      >
                        {e.fechaTip ? new Date(e.fechaTip).toLocaleDateString("es-PE") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Etapa inicial (fallback para filas SIN columna de estado) */}
        <div className="col gap6">
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
            Etapa por defecto {mapping.estado ? "(solo filas sin estado)" : ""}
          </label>
          <Select value={stageId} onValueChange={(v) => setStageId(v || "")}>
            <SelectTrigger>
              <SelectValue placeholder="Elige una etapa">
                {tree.find((s) => s.id === stageId)?.label ?? "Elige una etapa"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tree.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="dim" style={{ fontSize: 11.5 }}>
            {mapping.estado
              ? "Las filas con columna de Estado usan su propia tipificación; el resto entra en esta etapa."
              : selectedProgram
                ? `Embudo de "${selectedProgram.name}". Todos entran en esta etapa.`
                : "Embudo por defecto. Asigna un programa para usar su propio embudo."}
          </span>
        </div>
      </div>
    </Modal>
  );
}
