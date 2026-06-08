import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, Rocket,
  Users, Search, ArrowLeft, Phone, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { useContactFlows, useSourcePhones } from "@/hooks/useContactFlows";
import { useQueues } from "@/hooks/useQueues";
import { useFlowQueues } from "@/hooks/useFlowQueues";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { getApiEndpoints } from "@/lib/api";
import { parseCsvText, parsePhoneList, type ParsedContact } from "@/lib/csvParser";
import { WaTemplateConfigurator } from "@/components/whatsapp/WaTemplateConfigurator";
import { useAuth } from "@/hooks/useAuth";

/**
 * CampaignCreatePage — full-screen, single-page campaign builder (replaces the
 * 4-step modal wizard). Two columns: Audiencia (contacts: CSV / Leads / paste)
 * ↔ Configuración (channel + dialing + advanced, all visible). Sticky header
 * with inline name + launch. Real data: createCampaign Lambda.
 */
interface PoolLead {
  leadId: string; phone: string; name?: string; email?: string; company?: string;
  stageId?: string; source?: string; montoEstimado?: number; createdAt?: string; updatedAt?: string;
}
const LEAD_SOURCE_LABEL: Record<string, string> = {
  web_form: "Web", campaign: "Campaña", salesforce: "Salesforce", whatsapp: "WhatsApp", manual: "Manual",
};

/** Mapea un lead del embudo a un contacto de campaña (mismo formato que "Desde Leads"). */
function leadToContact(l: PoolLead): ParsedContact {
  const attributes: Record<string, string> = {
    ...(l.company ? { empresa: l.company } : {}),
    ...(l.email ? { email: l.email } : {}),
    ...(l.source ? { lead_source: l.source } : {}),
    ...(l.stageId ? { lead_stage: l.stageId } : {}),
  };
  return { phone: l.phone, customerName: l.name || "", attributes, originalRow: { ...attributes } };
}

interface WaTemplateButton { type: string; text: string; url?: string; phoneNumber?: string }
interface WaTemplate {
  name: string; metaTemplateId?: string; language?: string; category?: string; status?: string;
  bodyText?: string; variableCount?: number; headerText?: string; footerText?: string; buttons?: WaTemplateButton[];
}

const DIAL_MODES = [
  { value: "progressive", label: "Automático — 1 a la vez", short: "Marca un contacto, espera a que termine, marca el siguiente.", icon: "📞" },
  { value: "power", label: "Automático — 2 a la vez", short: "Marca 2 por agente libre, prioriza el primero que conteste.", icon: "⚡" },
  { value: "manual", label: "Manual — el agente decide", short: "Los leads aparecen en lista; el agente elige cuándo marcar.", icon: "👤" },
  { value: "agentless", label: "Sin agente (IVR / encuesta)", short: "Marca sin agente; atiende un flujo automático.", icon: "🤖" },
];
const TIMEZONES = [
  { value: "America/Lima", label: "Perú (Lima) — UTC-5" },
  { value: "America/Bogota", label: "Colombia (Bogotá) — UTC-5" },
  { value: "America/Mexico_City", label: "México (CDMX) — UTC-6" },
  { value: "America/Santiago", label: "Chile (Santiago) — UTC-3" },
  { value: "America/Buenos_Aires", label: "Argentina — UTC-3" },
  { value: "America/New_York", label: "USA (Eastern) — UTC-5" },
  { value: "Europe/Madrid", label: "España (Madrid) — UTC+1" },
];

const NIVEL_KEYS = ["nivel", "level", "udep_nivel", "tipo", "category", "c_grado de instruccion", "grado de instruccion", "a_codigo del programa", "codigo programa"];
const KNOWN_NIVELS = new Set(["pregrado", "posgrado", "diplomados", "alumnos"]);
const NIVEL_ALIAS: Record<string, string> = {
  universitario: "pregrado", pregrado: "pregrado", bachiller: "pregrado", posgrado: "posgrado", postgrado: "posgrado",
  maestria: "posgrado", "maestría": "posgrado", doctorado: "posgrado", mba: "posgrado",
  diplomado: "diplomados", diplomados: "diplomados", alumno: "alumnos", alumnos: "alumnos",
};
const NIVEL_PREFIX: Array<[RegExp, string]> = [
  [/^prg|^pre/i, "pregrado"], [/^pos|^mae|^mba|^doc/i, "posgrado"], [/^dip/i, "diplomados"], [/^alu/i, "alumnos"],
];
function canonicaliseNivel(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (KNOWN_NIVELS.has(v)) return v;
  if (NIVEL_ALIAS[v]) return NIVEL_ALIAS[v];
  for (const [re, t] of NIVEL_PREFIX) if (re.test(v)) return t;
  return null;
}

export function CampaignCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Leads pre-seleccionados traídos desde el embudo (LeadsPage → "Lanzar campaña con N").
  const presetLeads = useMemo<PoolLead[]>(() => {
    const s = location.state as { presetLeads?: PoolLead[] } | null;
    return Array.isArray(s?.presetLeads) ? s.presetLeads : [];
  }, [location.state]);
  const { user } = useAuth();
  const { flows, loading: flowsLoading } = useContactFlows();
  const { phones, loading: phonesLoading } = useSourcePhones();
  const { queues } = useQueues();
  const { tree: leadStages } = useTaxonomy();

  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [campaignType, setCampaignType] = useState<"voice" | "whatsapp">("voice");

  // Contacts
  const [inputMode, setInputMode] = useState<"csv" | "leads" | "paste">(() => (presetLeads.length > 0 ? "leads" : "csv"));
  const [pastedList, setPastedList] = useState("");
  const [contacts, setContacts] = useState<ParsedContact[]>(() => presetLeads.map(leadToContact));
  const [skipped, setSkipped] = useState<Array<{ reason: string }>>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [nameMapCol, setNameMapCol] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lead picker
  const [leadPool, setLeadPool] = useState<PoolLead[]>([]);
  const [leadPoolLoading, setLeadPoolLoading] = useState(false);
  const [leadPoolLoaded, setLeadPoolLoaded] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadSourceFilter, setLeadSourceFilter] = useState("all");
  const [leadStageFilter, setLeadStageFilter] = useState("all");
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set(presetLeads.map((l) => l.leadId)));

  // Voice config
  const [sourcePhoneNumber, setSourcePhoneNumber] = useState("");
  const [contactFlowId, setContactFlowId] = useState("");
  const [campaignQueueId, setCampaignQueueId] = useState("");
  const [dialMode, setDialMode] = useState("progressive");
  const [concurrency, setConcurrency] = useState(5);
  const [timezone, setTimezone] = useState("America/Lima");
  const [windowStartHour, setWindowStartHour] = useState(9);
  const [windowEndHour, setWindowEndHour] = useState(18);
  const [retryNoAnswerMinutes, setRetryNoAnswerMinutes] = useState(30);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);
  const [maxContactsPerAgent, setMaxContactsPerAgent] = useState(5);

  // WhatsApp config
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLang, setWaTemplateLang] = useState("es");
  const [waVarColumns, setWaVarColumns] = useState<string[]>([]);

  // Auto-name on mount
  useEffect(() => {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" });
    setName(`Campaña ${fmt.format(now).replace(",", " ·")}`);
  }, []);

  // Default source phone + flow
  useEffect(() => {
    if (sourcePhoneNumber || phones.length === 0) return;
    const pe = phones.find((p) => p.countryCode === "PE");
    setSourcePhoneNumber((pe || phones[0]).phoneNumber);
  }, [phones, sourcePhoneNumber]);
  useEffect(() => {
    if (contactFlowId || flows.length === 0) return;
    // Default: el saliente canónico de ARIA (provisionado en el onboarding);
    // compat con el flow de routing-por-nivel del fundador; si no, el primero.
    const smart =
      flows.find((f) => f.name === "ARIA-Outbound") ||
      flows.find((f) => f.name === "UDEP-Outbound-Smart");
    setContactFlowId((smart || flows[0]).id);
  }, [flows, contactFlowId]);

  // Auto queue from flow
  const { data: flowQueues, loading: flowQueuesLoading } = useFlowQueues(contactFlowId || null);
  useEffect(() => {
    const primary = flowQueues?.primaryQueue;
    if (primary && !primary.isDynamic) setCampaignQueueId(primary.queueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowQueues?.primaryQueue?.queueId]);

  // WhatsApp templates (lazy on switch)
  useEffect(() => {
    if (campaignType !== "whatsapp" || waTemplates.length > 0) return;
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) return;
    setWaTemplatesLoading(true);
    fetch(ep.listWhatsAppTemplates).then((r) => r.json()).then((j) => {
      const list = (j.templates || []) as WaTemplate[];
      setWaTemplates(list);
      if (list.length > 0 && !waTemplateName) {
        setWaTemplateName(list[0].name);
        setWaTemplateLang(list[0].language || "es");
        setWaVarColumns(new Array(list[0].variableCount || 0).fill(""));
      }
    }).catch(() => setWaTemplates([])).finally(() => setWaTemplatesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignType]);
  useEffect(() => {
    if (!waTemplateName) return;
    const tpl = waTemplates.find((t) => t.name === waTemplateName);
    if (!tpl) return;
    setWaTemplateLang(tpl.language || "es");
    setWaVarColumns((prev) => {
      const n = tpl.variableCount || 0;
      const next = new Array(n).fill("");
      for (let i = 0; i < Math.min(prev.length, n); i++) next[i] = prev[i];
      return next;
    });
  }, [waTemplateName, waTemplates]);

  // Lead pool (lazy on tab)
  useEffect(() => {
    if (inputMode !== "leads" || leadPoolLoaded) return;
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    setLeadPoolLoading(true);
    fetch(ep.manageLeads).then((r) => r.json()).then((d) => {
      setLeadPool(Array.isArray(d.leads) ? d.leads : []);
      setLeadPoolLoaded(true);
    }).catch(() => setLeadPool([])).finally(() => setLeadPoolLoading(false));
  }, [inputMode, leadPoolLoaded]);

  const filteredLeadPool = useMemo(() => {
    const needle = leadQuery.trim().toLowerCase();
    return leadPool
      .filter((l) => leadSourceFilter === "all" || l.source === leadSourceFilter)
      .filter((l) => leadStageFilter === "all" || l.stageId === leadStageFilter)
      .filter((l) => !needle || `${l.name || ""} ${l.phone || ""} ${l.company || ""} ${l.email || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (b.createdAt || b.updatedAt || "").localeCompare(a.createdAt || a.updatedAt || ""));
  }, [leadPool, leadQuery, leadSourceFilter, leadStageFilter]);
  const leadSources = useMemo(() => [...new Set(leadPool.map((l) => l.source).filter(Boolean))] as string[], [leadPool]);

  const onFilePick = async (file: File) => {
    setParseError(null);
    try {
      const result = await parseCsvText(await file.text(), "PE");
      if (!result.detected.phoneColumn) { setParseError("No se detectó columna de teléfono."); return; }
      setContacts(result.contacts);
      setSkipped(result.skipped.map((s) => ({ reason: s.reason })));
      toast.success(`${result.contacts.length} contactos cargados (${result.skipped.length} skipped)`);
      const sampleAttrs = Object.keys(result.contacts[0]?.attributes ?? {});
      if (sampleAttrs.some((k) => ["nivel", "level", "udep_nivel", "tipo"].includes(k.trim().toLowerCase())) && !contactFlowId) {
        // Datos con atributo de nivel → preferimos un flow que enrute por nivel
        // (el del fundador); si no existe, caemos al saliente canónico de ARIA.
        const smart =
          flows.find((f) => f.name === "UDEP-Outbound-Smart") ||
          flows.find((f) => f.name === "ARIA-Outbound");
        if (smart) setContactFlowId(smart.id);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse error");
    }
  };
  const onUsePastedList = () => {
    const result = parsePhoneList(pastedList, "PE");
    setContacts(result.contacts);
    setSkipped(result.skipped.map((s) => ({ reason: `Inválido: ${s}` })));
    if (result.contacts.length === 0) setParseError("No se encontró ningún teléfono válido.");
    else { setParseError(null); toast.success(`${result.contacts.length} teléfonos cargados`); }
  };
  const applySelectedLeads = () => {
    const chosen = leadPool.filter((l) => selectedLeadIds.has(l.leadId));
    if (chosen.length === 0) { toast.error("Selecciona al menos un lead"); return; }
    setContacts(chosen.map((l) => ({
      phone: l.phone, customerName: l.name || "",
      originalRow: {},
      attributes: {
        ...(l.company ? { empresa: l.company } : {}), ...(l.email ? { email: l.email } : {}),
        ...(l.source ? { lead_source: l.source } : {}), ...(l.stageId ? { lead_stage: l.stageId } : {}),
      },
    })));
    setSkipped([]); setParseError(null);
    toast.success(`${chosen.length} leads listos para la campaña`);
  };

  // Inline personalization of the loaded contacts (edit name/phone, or bulk-map
  // the name from a CSV column) — "matchear/personalizar ahí nomas".
  const editContact = (i: number, field: "phone" | "customerName", value: string) =>
    setContacts((cur) => cur.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  const applyNameMap = (col: string) => {
    setNameMapCol(col);
    if (!col) return;
    setContacts((cur) => cur.map((c) => ({ ...c, customerName: c.attributes[col] ?? c.customerName })));
    toast.success(`Nombre tomado de la columna "${col}"`);
  };

  const canLaunch = name.trim().length > 0 && contacts.length > 0 && (
    campaignType === "whatsapp" ? !!waTemplateName && waVarColumns.every((c) => !!c && c !== "lit:") : !!sourcePhoneNumber && !!contactFlowId
  );
  const missing = !name.trim() ? "nombre" : contacts.length === 0 ? "audiencia (contactos)"
    : campaignType === "whatsapp" ? (!waTemplateName ? "plantilla" : "mapear variables")
    : !sourcePhoneNumber ? "número saliente" : !contactFlowId ? "contact flow" : null;

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const ep = getApiEndpoints();
      if (!ep?.createCampaign) throw new Error("createCampaign endpoint no configurado");
      const flow = flows.find((f) => f.id === contactFlowId);
      const queue = queues.find((q) => q.id === campaignQueueId);
      const payload = {
        name: name.trim(), description: description.trim(),
        campaignType,
        templateName: campaignType === "whatsapp" ? waTemplateName : undefined,
        templateLanguage: campaignType === "whatsapp" ? waTemplateLang : undefined,
        templateVarColumns: campaignType === "whatsapp" ? waVarColumns : undefined,
        sourcePhoneNumber, contactFlowId, contactFlowName: flow?.name,
        campaignQueueId: campaignQueueId || undefined, campaignQueueName: queue?.name,
        dialMode, concurrency, timezone, windowStartHour, windowEndHour,
        windowDaysOfWeek: [1, 2, 3, 4, 5], retryNoAnswerMinutes, retryMaxAttempts, maxContactsPerAgent,
        contacts: contacts.map((c) => ({
          phone: c.phone, customerName: c.customerName,
          attributes: (() => {
            const out = { ...c.attributes };
            const nivelKey = Object.keys(out).find((k) => NIVEL_KEYS.includes(k.trim().toLowerCase()));
            if (nivelKey && !out.udep_nivel) { const can = canonicaliseNivel(out[nivelKey] || ""); if (can) out.udep_nivel = can; }
            return out;
          })(),
        })),
        createdBy: user?.username || "system", startNow: true,
      };
      const r = await fetch(ep.createCampaign, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || body?.message || `HTTP ${r.status}`);
      toast.success(`Campaña creada (${body.totalContacts} contactos). Iniciando dialing…`);
      navigate("/campaigns");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la campaña");
    } finally {
      setSubmitting(false);
    }
  };

  const csvCols = Object.keys(contacts[0]?.attributes ?? {});

  return (
    <div className="view camp-new">
      {/* Sticky header */}
      <div className="camp-new__bar">
        <button className="cal-nav__btn" onClick={() => navigate("/campaigns")} title="Volver"><ArrowLeft size={16} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="camp-new__crumb">Crecimiento · Nueva campaña</div>
          <input className="camp-new__name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la campaña" />
        </div>
        <div className="camp-new__actions">
          <span className="camp-new__ready">
            {canLaunch ? <><CheckCircle2 size={14} style={{ color: "var(--accent-green)" }} /> Listo para lanzar</>
              : <span className="muted">Falta: {missing}</span>}
          </span>
          <button className="btn" onClick={() => navigate("/campaigns")}>Cancelar</button>
          <button className="btn btn--primary" disabled={!canLaunch || submitting} onClick={handleCreate} title={canLaunch ? "" : `Falta: ${missing}`}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Lanzando…</> : <><Rocket size={14} /> Lanzar campaña</>}
          </button>
        </div>
      </div>

      <div className="camp-new__grid">
        {/* ── AUDIENCIA ── */}
        <section className="card camp-new__col">
          <div className="camp-new__h">
            <span className="camp-new__hn">1</span> Audiencia
            {contacts.length > 0 && <span className="camp-new__badge">{contacts.length} contactos</span>}
          </div>

          <div className="camp-tabs">
            {([["csv", "Subir CSV", FileSpreadsheet], ["leads", "Desde Leads", Users], ["paste", "Pegar lista", MessageSquare]] as const).map(([id, label, I]) => (
              <button key={id} className={`camp-tab ${inputMode === id ? "camp-tab--active" : ""}`} onClick={() => setInputMode(id)}>
                <I size={14} /> {label}
              </button>
            ))}
          </div>

          {inputMode === "csv" && (
            <div className="camp-drop" onClick={() => fileInputRef.current?.click()}>
              <Upload size={26} style={{ color: "var(--text-3)" }} />
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 8 }}>Click para subir CSV</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Detecta columnas · valida números · normaliza E.164</div>
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePick(f); }} />
            </div>
          )}

          {inputMode === "paste" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Textarea rows={6} placeholder={"+51987654321\n+51987654322\n…"} value={pastedList} onChange={(e) => setPastedList(e.target.value)} />
              <button className="btn" onClick={onUsePastedList} disabled={!pastedList.trim()}>Parsear lista</button>
            </div>
          )}

          {inputMode === "leads" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {presetLeads.length > 0 && (
                <div className="row" style={{ gap: 8, padding: "8px 11px", borderRadius: 8, background: "var(--accent-green-soft, rgba(34,197,94,0.12))", color: "var(--accent-green)", fontSize: 12 }}>
                  <CheckCircle2 size={15} />
                  <span><strong>{presetLeads.length}</strong> lead{presetLeads.length === 1 ? "" : "s"} traído{presetLeads.length === 1 ? "" : "s"} desde el embudo y listo{presetLeads.length === 1 ? "" : "s"} como audiencia. Ajusta la selección si querés.</span>
                </div>
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
                  <Search size={14} style={{ position: "absolute", left: 9, top: 9, color: "var(--text-3)" }} />
                  <Input style={{ paddingLeft: 30 }} placeholder="Buscar nombre, teléfono, empresa…" value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} />
                </div>
                <Select value={leadSourceFilter} onValueChange={(v) => setLeadSourceFilter(v || "all")}>
                  <SelectTrigger className="w-[150px]"><SelectValue>{leadSourceFilter === "all" ? "Todas las fuentes" : (LEAD_SOURCE_LABEL[leadSourceFilter] || leadSourceFilter)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las fuentes</SelectItem>
                    {leadSources.map((s) => <SelectItem key={s} value={s}>{LEAD_SOURCE_LABEL[s] || s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={leadStageFilter} onValueChange={(v) => setLeadStageFilter(v || "all")}>
                  <SelectTrigger className="w-[160px]"><SelectValue>{leadStageFilter === "all" ? "Todas las etapas" : (leadStages.find((s) => s.id === leadStageFilter)?.label || "Etapa")}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las etapas</SelectItem>
                    {leadStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border-1)", borderRadius: 10 }}>
                {leadPoolLoading ? (
                  <div className="row" style={{ gap: 8, padding: 16, color: "var(--text-3)", fontSize: 13 }}><Loader2 className="h-4 w-4 animate-spin" /> Cargando leads…</div>
                ) : (
                  <table className="camp-ltable">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input type="checkbox" aria-label="Seleccionar todos"
                            checked={filteredLeadPool.length > 0 && filteredLeadPool.every((l) => selectedLeadIds.has(l.leadId))}
                            onChange={() => { const all = filteredLeadPool.length > 0 && filteredLeadPool.every((l) => selectedLeadIds.has(l.leadId)); setSelectedLeadIds(all ? new Set() : new Set(filteredLeadPool.map((l) => l.leadId))); }} />
                        </th>
                        <th>Nombre</th><th>Teléfono</th><th>Empresa</th><th>Etapa</th><th>Fuente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeadPool.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: 26, textAlign: "center", color: "var(--text-3)" }}>{leadPool.length === 0 ? "No hay leads todavía." : "Ningún lead coincide con los filtros."}</td></tr>
                      ) : filteredLeadPool.map((l) => {
                        const checked = selectedLeadIds.has(l.leadId);
                        const st = leadStages.find((s) => s.id === l.stageId);
                        return (
                          <tr key={l.leadId} className={`camp-ltr ${checked ? "camp-ltr--on" : ""}`}
                            onClick={() => setSelectedLeadIds((prev) => { const n = new Set(prev); if (n.has(l.leadId)) n.delete(l.leadId); else n.add(l.leadId); return n; })}>
                            <td><input type="checkbox" checked={checked} readOnly tabIndex={-1} /></td>
                            <td style={{ fontWeight: 600 }}>{l.name || "—"}</td>
                            <td className="mono muted">{l.phone}</td>
                            <td className="muted" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company || "—"}</td>
                            <td>{st ? <span className="chip" style={{ height: 18, fontSize: 10 }}>{st.label}</span> : <span className="muted">—</span>}</td>
                            <td>{l.source ? <Badge variant="outline" className="text-[10px]">{LEAD_SOURCE_LABEL[l.source] || l.source}</Badge> : <span className="muted">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted" style={{ fontSize: 11.5 }}>{selectedLeadIds.size} de {filteredLeadPool.length} seleccionados</span>
                <button className="btn btn--primary btn--sm" disabled={selectedLeadIds.size === 0} onClick={applySelectedLeads}>
                  <Users size={14} /> Usar {selectedLeadIds.size} lead{selectedLeadIds.size === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          {parseError && (
            <div className="row" style={{ gap: 8, marginTop: 10, padding: "8px 11px", borderRadius: 8, background: "var(--accent-red-soft)", color: "var(--accent-red)", fontSize: 12.5 }}>
              <AlertTriangle size={15} /> {parseError}
            </div>
          )}

          {contacts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span className="row" style={{ gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                  <CheckCircle2 size={15} style={{ color: "var(--accent-green)" }} /> {contacts.length} contactos
                  {skipped.length > 0 && <span style={{ color: "var(--accent-red)", fontSize: 11 }}>· {skipped.length} descartados</span>}
                </span>
                {inputMode === "csv" && csvCols.length > 0 && (
                  <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
                    <span className="muted" style={{ fontSize: 11 }}>Nombre desde columna:</span>
                    <Select value={nameMapCol} onValueChange={(v) => applyNameMap(v || "")}>
                      <SelectTrigger size="sm" style={{ minWidth: 130 }}><SelectValue placeholder="(elegir)">{nameMapCol || "(elegir)"}</SelectValue></SelectTrigger>
                      <SelectContent>{csvCols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <LevelDistributionPreview contacts={contacts} />
              <div className="muted" style={{ fontSize: 10.5, margin: "9px 0 5px" }}>✏️ Edita nombre o teléfono directamente en la tabla antes de lanzar.</div>
              <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border-1)", borderRadius: 8 }}>
                <table className="camp-ltable">
                  <thead><tr><th style={{ width: 40 }}>#</th><th>Teléfono</th><th>Nombre</th><th>Atributos</th></tr></thead>
                  <tbody>
                    {contacts.slice(0, 100).map((c, i) => (
                      <tr key={i}>
                        <td className="muted">{i + 1}</td>
                        <td style={{ width: "28%" }}><input className="camp-edit mono" value={c.phone} onChange={(e) => editContact(i, "phone", e.target.value)} /></td>
                        <td style={{ width: "32%" }}><input className="camp-edit" value={c.customerName || ""} placeholder="—" onChange={(e) => editContact(i, "customerName", e.target.value)} /></td>
                        <td className="muted" style={{ fontSize: 10.5 }}>{Object.keys(c.attributes).slice(0, 3).join(", ") || "—"}</td>
                      </tr>
                    ))}
                    {contacts.length > 100 && <tr><td colSpan={4} style={{ padding: "7px 10px", textAlign: "center", color: "var(--text-3)" }}>+ {contacts.length - 100} más (se incluyen todos al lanzar)</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ── CONFIGURACIÓN ── */}
        <section className="card camp-new__col">
          <div className="camp-new__h"><span className="camp-new__hn">2</span> Configuración</div>

          {/* Canal */}
          <div className="camp-field">
            <label className="camp-lbl">Canal</label>
            <div className="row" style={{ gap: 8 }}>
              <button className={`camp-chan ${campaignType === "voice" ? "camp-chan--voice" : ""}`} onClick={() => setCampaignType("voice")}><Phone size={15} /> Llamada de voz</button>
              <button className={`camp-chan ${campaignType === "whatsapp" ? "camp-chan--wa" : ""}`} onClick={() => setCampaignType("whatsapp")}><MessageSquare size={15} /> WhatsApp</button>
            </div>
          </div>

          <div className="camp-field">
            <label className="camp-lbl">Descripción (opcional)</label>
            <Textarea rows={2} placeholder="Objetivo, audiencia, contexto…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {campaignType === "whatsapp" ? (
            <>
              <div className="camp-field">
                <label className="camp-lbl">Plantilla de WhatsApp (APPROVED)</label>
                {waTemplatesLoading ? (
                  <div className="muted" style={{ fontSize: 12 }}>Cargando plantillas…</div>
                ) : waTemplates.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>Sin templates aprobados</div>
                ) : (
                  <WaTemplateConfigurator
                    mode="campaign"
                    templates={waTemplates}
                    templateName={waTemplateName}
                    language={waTemplateLang}
                    variables={waVarColumns}
                    columns={csvCols}
                    onChange={({ templateName, language, variables }) => { setWaTemplateName(templateName); setWaTemplateLang(language); setWaVarColumns(variables); }}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="camp-2col">
                <div className="camp-field">
                  <label className="camp-lbl">Número saliente</label>
                  <Select value={sourcePhoneNumber} onValueChange={(v) => setSourcePhoneNumber(v || "")} disabled={phonesLoading}>
                    <SelectTrigger><SelectValue placeholder="Elegir número">{sourcePhoneNumber || (phonesLoading ? "Cargando…" : "Elegir número")}</SelectValue></SelectTrigger>
                    <SelectContent>{phones.map((p) => <SelectItem key={p.phoneNumberId} value={p.phoneNumber}>{p.phoneNumber} · {p.countryCode}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="camp-field">
                  <label className="camp-lbl">Contact flow</label>
                  <Select value={contactFlowId} onValueChange={(v) => { setContactFlowId(v || ""); }} disabled={flowsLoading}>
                    <SelectTrigger><SelectValue placeholder="Elegir flow">{flows.find((f) => f.id === contactFlowId)?.name || (flowsLoading ? "Cargando…" : "Elegir flow")}</SelectValue></SelectTrigger>
                    <SelectContent>{flows.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="camp-field">
                <label className="camp-lbl">Colas que usará la campaña</label>
                {flowQueuesLoading ? <p className="muted" style={{ fontSize: 11.5 }}>Detectando colas…</p>
                  : flowQueues && flowQueues.literalQueues.length > 0 ? (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {flowQueues.literalQueues.map((q) => <span key={q.queueId} className="chip chip--green" style={{ height: 22 }}>✓ {q.queueName}</span>)}
                    </div>
                  ) : <p className="muted" style={{ fontSize: 11.5 }}>El flow define las colas (enrutamiento por atributos).</p>}
              </div>

              <div className="camp-field">
                <label className="camp-lbl">¿Cómo se marcan los leads?</label>
                <div className="camp-modes">
                  {DIAL_MODES.map((m) => (
                    <button key={m.value} className={`camp-mode ${dialMode === m.value ? "camp-mode--active" : ""}`} onClick={() => setDialMode(m.value)}>
                      <span style={{ fontSize: 17 }}>{m.icon}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{m.label}</span>
                        <span className="muted" style={{ fontSize: 10.5, display: "block", lineHeight: 1.35 }}>{m.short}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced — visible (no collapse) for full customization */}
              <div className="camp-adv">
                <div className="camp-adv__title">Personalización avanzada</div>
                <div className="camp-2col">
                  <div className="camp-field"><label className="camp-lbl">Llamadas simultáneas</label>
                    <Input type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)} /></div>
                  <div className="camp-field"><label className="camp-lbl">Cola por agente</label>
                    <Input type="number" min={1} max={50} value={maxContactsPerAgent} onChange={(e) => setMaxContactsPerAgent(parseInt(e.target.value) || 5)} /></div>
                </div>
                <div className="camp-field">
                  <label className="camp-lbl">Horario de llamadas</label>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Input type="number" min={0} max={23} value={windowStartHour} onChange={(e) => setWindowStartHour(parseInt(e.target.value) || 0)} style={{ width: 70 }} />
                    <span className="muted" style={{ fontSize: 12 }}>a</span>
                    <Input type="number" min={0} max={23} value={windowEndHour} onChange={(e) => setWindowEndHour(parseInt(e.target.value) || 0)} style={{ width: 70 }} />
                    <Select value={timezone} onValueChange={(v) => setTimezone(v || "America/Lima")}>
                      <SelectTrigger className="flex-1"><SelectValue>{TIMEZONES.find((t) => t.value === timezone)?.label || timezone}</SelectValue></SelectTrigger>
                      <SelectContent>{TIMEZONES.map((tz) => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="camp-2col">
                  <div className="camp-field"><label className="camp-lbl">Reintentar (min)</label>
                    <Input type="number" min={5} max={1440} value={retryNoAnswerMinutes} onChange={(e) => setRetryNoAnswerMinutes(parseInt(e.target.value) || 30)} /></div>
                  <div className="camp-field"><label className="camp-lbl">Intentos máximos</label>
                    <Input type="number" min={1} max={10} value={retryMaxAttempts} onChange={(e) => setRetryMaxAttempts(parseInt(e.target.value) || 3)} /></div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* Level distribution preview (UDEP nivel routing) — same logic as the wizard. */
const NIVEL_TONE: Record<string, string> = { pregrado: "var(--accent-green)", posgrado: "var(--accent-cyan)", diplomados: "var(--accent-violet)", alumnos: "var(--accent-amber)" };
function LevelDistributionPreview({ contacts }: { contacts: ParsedContact[] }) {
  const sampleKeys = Object.keys(contacts[0]?.attributes ?? {});
  const nivelKey = sampleKeys.find((k) => NIVEL_KEYS.includes(k.trim().toLowerCase()));
  if (!nivelKey) return null;
  const counts = new Map<string, number>();
  let empty = 0, unknown = 0;
  for (const c of contacts) {
    const raw = (c.attributes[nivelKey] ?? "").trim();
    if (!raw) { empty++; continue; }
    const can = canonicaliseNivel(raw);
    if (can) counts.set(can, (counts.get(can) ?? 0) + 1); else unknown++;
  }
  const total = contacts.length;
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ border: "1px solid var(--border-1)", borderRadius: 8, padding: 10, background: "var(--bg-2)" }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Distribución por <span className="mono">{nivelKey}</span> · se rutea automáticamente</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map(([nivel, count]) => (
          <div key={nivel} className="row" style={{ gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 78, textTransform: "capitalize" }}>{nivel}</span>
            <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--border-1)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((count / total) * 100)}%`, background: NIVEL_TONE[nivel] || "var(--text-3)" }} />
            </div>
            <span className="mono" style={{ width: 60, textAlign: "right" }}>{count} · {Math.round((count / total) * 100)}%</span>
          </div>
        ))}
      </div>
      {(empty > 0 || unknown > 0) && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 7 }}>
          {empty > 0 && `${empty} sin nivel`}{empty > 0 && unknown > 0 && " · "}{unknown > 0 && `${unknown} desconocido`} → van a Pregrado por default
        </div>
      )}
    </div>
  );
}
