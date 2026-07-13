import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Users, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
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
 * ninguna llamada (a diferencia de crear una campaña). Reutiliza el parser de CSV
 * de campañas y el motor idempotente `importLeads` (dedup por teléfono). Llamar
 * queda como paso aparte: luego se crea una campaña con esos leads si se quiere.
 *
 * Uso doble: desde Leads (programa = el activo, editable) o desde el Centro del
 * programa (`lockProgram` fija el destino).
 */
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
  // Si el modal se reabre con otro programa por defecto, respétalo.
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
  const fileRef = useRef<HTMLInputElement>(null);

  // Etapa inicial = primera del embudo del programa; se re-sincroniza si cambia.
  useEffect(() => {
    if (tree.length && !tree.some((s) => s.id === stageId)) setStageId(tree[0].id);
  }, [tree, stageId]);

  const clearFile = () => {
    setContacts([]);
    setSkipped(0);
    setFileName("");
    setParseError(null);
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
    } catch {
      setParseError("No se pudo leer el archivo. ¿Es un CSV válido?");
      setContacts([]);
    }
  };

  const cols = Object.keys(contacts[0]?.attributes ?? {});

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
      const r = await authedFetch(ep.manageLeads, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "importLeads",
          programId: programId || undefined,
          stageId: stageId || undefined,
          contacts: contacts.map((c) => ({
            phone: c.phone,
            name: c.customerName || undefined,
            attributes: c.attributes,
          })),
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
      className="max-w-lg"
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
          maxHeight: "62vh",
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
              Detectamos las columnas solas (teléfono, nombre…). También .tsv o .txt
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
                <span className="dim">
                  {skipped} saltados (sin teléfono válido o duplicados en el archivo)
                </span>
              )}
            </div>
            {cols.length > 0 && (
              <div className="row wrap gap6" style={{ marginTop: 2 }}>
                {cols.slice(0, 8).map((c) => (
                  <span key={c} className="chip" style={{ height: 20, fontSize: 10.5 }}>
                    {c}
                  </span>
                ))}
                {cols.length > 8 && (
                  <span className="dim" style={{ fontSize: 11 }}>
                    +{cols.length - 8}
                  </span>
                )}
              </div>
            )}
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

        {/* Etapa inicial (del embudo del programa) */}
        <div className="col gap6">
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
            Etapa inicial
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
            {selectedProgram
              ? `Embudo de "${selectedProgram.name}". Todos entran en esta etapa.`
              : "Embudo por defecto. Asigna un programa para usar su propio embudo."}
          </span>
        </div>
      </div>
    </Modal>
  );
}
