import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { useContactFlows, useSourcePhones } from "@/hooks/useContactFlows";
import { useQueues } from "@/hooks/useQueues";
import { useFlowQueues } from "@/hooks/useFlowQueues";
import { getApiEndpoints } from "@/lib/api";
import { parseCsvText, parsePhoneList, type ParsedContact } from "@/lib/csvParser";
import { useAuth } from "@/hooks/useAuth";

interface NewCampaignWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Step = 1 | 2 | 3 | 4;

interface WhatsAppTemplateButton {
  type: string; // QUICK_REPLY · URL · PHONE_NUMBER · COPY_CODE
  text: string;
  url?: string;
  phoneNumber?: string;
}

interface WhatsAppTemplate {
  name: string;
  metaTemplateId?: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  footerText?: string;
  buttons?: WhatsAppTemplateButton[];
}

const DIAL_MODES = [
  {
    value: "progressive",
    label: "Automático — 1 a la vez",
    short: "Dialer marca un contacto, espera a que termine, marca el siguiente.",
    detail:
      "Lo más usado. Cuando el agente está libre, el sistema marca el próximo lead automáticamente.",
    icon: "📞",
  },
  {
    value: "power",
    label: "Automático — 2 a la vez",
    short: "Dialer marca 2 contactos por cada agente libre, prioriza el primero que conteste.",
    detail:
      "Más rápido. Útil cuando muchos leads no contestan y querés maximizar conversaciones por hora.",
    icon: "⚡",
  },
  {
    value: "manual",
    label: "Manual — el agente decide",
    short: "Los leads aparecen en una lista. El agente revisa y elige cuándo marcar o saltar.",
    detail:
      "Recomendado para cuentas premium o cuando el agente necesita ver contexto antes de hablar.",
    icon: "👤",
  },
  {
    value: "agentless",
    label: "Sin agente (IVR / encuesta)",
    short: "Marca sin necesidad de agente. La llamada la atiende un flujo automático.",
    detail:
      "Para encuestas grabadas, recordatorios automáticos, NPS, etc. No requiere agentes asignados.",
    icon: "🤖",
  },
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

export function NewCampaignWizard({
  open,
  onOpenChange,
  onCreated,
}: NewCampaignWizardProps) {
  const { user } = useAuth();
  const { flows, loading: flowsLoading } = useContactFlows();
  const { phones, loading: phonesLoading } = useSourcePhones();
  const { queues } = useQueues();

  // Bug #29 — the wizard used to default to step 2 and, more importantly,
  // didn't fully reset on close, so reopening landed the user back at
  // step 2 with stale data. We now start at step 1 (the canonical
  // beginning) and fully reset every piece of state on close.
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Meta
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Channel selector — voice (existing) or whatsapp (Meta template).
  // The whole step-3 config layout flips: WhatsApp campaigns don't
  // need source phone / dial mode / queue, they need template + vars.
  const [campaignType, setCampaignType] = useState<"voice" | "whatsapp">("voice");

  // WhatsApp template state (step 3 when campaignType === "whatsapp")
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplate[]>([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLang, setWaTemplateLang] = useState("es");
  /** Ordered list of CSV column names that fill {{1}}, {{2}}, … of the
   *  selected template. Length == template variableCount. The sentinel
   *  "__customerName__" maps to the contact's customerName field. */
  const [waVarColumns, setWaVarColumns] = useState<string[]>([]);

  // Step 2 — Contactos
  const [inputMode, setInputMode] = useState<"csv" | "paste">("csv");
  const [pastedList, setPastedList] = useState("");
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [skipped, setSkipped] = useState<Array<{ row?: Record<string, string>; reason: string }>>(
    []
  );
  const [detectedColumns, setDetectedColumns] = useState<{
    phoneColumn: string | null;
    nameColumn: string | null;
    firstNameColumn: string | null;
    lastNameColumn: string | null;
    attributeColumns: string[];
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3 — Dialing config
  const [sourcePhoneNumber, setSourcePhoneNumber] = useState("");
  const [contactFlowId, setContactFlowId] = useState("");
  const [campaignQueueId, setCampaignQueueId] = useState("");
  const [queueTouched, setQueueTouched] = useState(false);
  const [dialMode, setDialMode] = useState("progressive");
  const [concurrency, setConcurrency] = useState(5);
  const [timezone, setTimezone] = useState("America/Lima");
  const [windowStartHour, setWindowStartHour] = useState(9);
  const [windowEndHour, setWindowEndHour] = useState(18);
  const [retryNoAnswerMinutes, setRetryNoAnswerMinutes] = useState(30);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);
  /** How many contacts the dialer pre-assigns to each Available agent.
   *  Each agent ends up with their own ordered bucket — the dialer takes
   *  the next one when the agent is free, and refills the bucket from the
   *  general pool when it empties. */
  const [maxContactsPerAgent, setMaxContactsPerAgent] = useState(5);

  // Reset when modal closes — and pre-fill an auto-generated name when
  // the modal OPENS. Bug #29: previously some state (sourcePhoneNumber,
  // contactFlowId, dialMode, retries…) persisted across opens, so a user
  // who started a draft and cancelled would see those values leak into
  // the next attempt. We now reset everything user-touchable.
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1);
        setName("");
        setDescription("");
        setContacts([]);
        setSkipped([]);
        setDetectedColumns(null);
        setPastedList("");
        setParseError(null);
        setSubmitting(false);
        setCampaignQueueId("");
        setQueueTouched(false);
        // Channel + voice/WA config
        setCampaignType("voice");
        setInputMode("csv");
        setSourcePhoneNumber("");
        setContactFlowId("");
        setDialMode("progressive");
        setConcurrency(5);
        setTimezone("America/Lima");
        setWindowStartHour(9);
        setWindowEndHour(18);
        setRetryNoAnswerMinutes(30);
        setRetryMaxAttempts(3);
        setMaxContactsPerAgent(5);
        setWaTemplateName("");
        setWaTemplateLang("es");
        setWaVarColumns([]);
      }, 200);
      return;
    }
    // Auto-name: "Campaña 20 may · 11:34" — short, sortable, editable.
    if (!name) {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
      });
      setName(`Campaña ${fmt.format(now).replace(",", " ·")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-detect primary queue when the user picks a contact flow, unless they
  // already manually picked a different queue.
  const { data: flowQueues, loading: flowQueuesLoading } = useFlowQueues(
    contactFlowId || null
  );
  useEffect(() => {
    if (queueTouched) return;
    const primary = flowQueues?.primaryQueue;
    if (primary && !primary.isDynamic) {
      setCampaignQueueId(primary.queueId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowQueues?.primaryQueue?.queueId]);

  // Default selections once flows & phones load. We prefer the
  // "UDEP-Outbound-Smart" flow (the lead-routing flow) over anything
  // else — when it's the only flow that makes sense for outbound
  // campaigns, the wizard shouldn't make the user pick it manually.
  // Voice source phone: prefer Peru numbers over WhatsApp / US.
  useEffect(() => {
    if (sourcePhoneNumber || phones.length === 0) return;
    // Look for a PE (Peru) number first, then fall back to the first phone.
    const pe = phones.find((p) => p.countryCode === "PE");
    setSourcePhoneNumber((pe || phones[0]).phoneNumber);
  }, [phones, sourcePhoneNumber]);

  useEffect(() => {
    if (contactFlowId || flows.length === 0) return;
    // Pre-select UDEP-Outbound-Smart whenever it exists. Falls back to
    // the first published flow if it doesn't (non-UDEP deployments).
    const smart = flows.find((f) => f.name === "UDEP-Outbound-Smart");
    setContactFlowId((smart || flows[0]).id);
  }, [flows, contactFlowId]);

  // Lazy-load WhatsApp templates the first time the user switches the
  // campaign type to WhatsApp. We cache the result for the modal's
  // lifetime — reopening the wizard refreshes them.
  useEffect(() => {
    if (campaignType !== "whatsapp" || waTemplates.length > 0) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.listWhatsAppTemplates) return;
    setWaTemplatesLoading(true);
    fetch(endpoints.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => {
        const list = (j.templates || []) as WhatsAppTemplate[];
        setWaTemplates(list);
        // Auto-pick the first APPROVED template if none chosen yet
        if (list.length > 0 && !waTemplateName) {
          const first = list[0];
          setWaTemplateName(first.name);
          setWaTemplateLang(first.language || "es");
          setWaVarColumns(new Array(first.variableCount || 0).fill(""));
        }
      })
      .catch(() => setWaTemplates([]))
      .finally(() => setWaTemplatesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignType]);

  // When the user picks a different template, resize the variable
  // mapping array to match (and reset entries to empty so the manager
  // re-maps explicitly for the new template).
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

  // ------- File upload -------
  const onFilePick = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const result = await parseCsvText(text, "PE");
      if (!result.detected.phoneColumn) {
        setParseError(
          "No se detectó columna de teléfono. Revisa que el CSV tenga una columna con números válidos."
        );
        return;
      }
      setContacts(result.contacts);
      setSkipped(result.skipped);
      setDetectedColumns(result.detected);
      toast.success(
        `${result.contacts.length} contactos cargados (${result.skipped.length} skipped)`
      );

      // Auto-pick the UDEP-Outbound-Smart flow when the CSV contains a
      // nivel-like column AND the user hasn't already chosen a flow.
      // Saves a step in the wizard for the common UDEP case.
      const sampleAttrs = Object.keys(result.contacts[0]?.attributes ?? {});
      const hasNivel = sampleAttrs.some((k) =>
        ["nivel", "level", "udep_nivel", "tipo"].includes(k.trim().toLowerCase())
      );
      if (hasNivel && !contactFlowId) {
        const smart = flows.find((f) => f.name === "UDEP-Outbound-Smart");
        if (smart) {
          setContactFlowId(smart.id);
          toast.info(
            "Detecté columna 'nivel' → autoseleccioné UDEP-Outbound-Smart"
          );
        }
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse error");
    }
  };

  const onUsePastedList = () => {
    const result = parsePhoneList(pastedList, "PE");
    setContacts(result.contacts);
    setSkipped(result.skipped.map((s) => ({ reason: `Invalid phone: ${s}` })));
    setDetectedColumns({
      phoneColumn: "phone",
      nameColumn: null,
      firstNameColumn: null,
      lastNameColumn: null,
      attributeColumns: [],
    });
    if (result.contacts.length === 0) {
      setParseError("No se encontró ningún teléfono válido.");
    } else {
      setParseError(null);
      toast.success(`${result.contacts.length} teléfonos cargados`);
    }
  };

  // ------- Submit -------
  const canProceedStep1 = name.trim().length > 0;
  const canProceedStep2 = contacts.length > 0;
  // Step 3 is reachable when the channel-specific minimum config is set:
  //  · voice: source phone + contact flow
  //  · whatsapp: template name + all variable mappings filled
  const canProceedStep3 =
    campaignType === "whatsapp"
      ? !!waTemplateName && waVarColumns.every((c) => !!c)
      : !!sourcePhoneNumber && !!contactFlowId;

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.createCampaign) {
        throw new Error("createCampaign endpoint not configured");
      }
      const flow = flows.find((f) => f.id === contactFlowId);
      const queue = queues.find((q) => q.id === campaignQueueId);
      const payload = {
        name: name.trim(),
        description: description.trim(),
        // Channel + (voice fields | whatsapp fields). Sending both is
        // harmless — the backend reads only the ones relevant to
        // campaignType. We keep the voice fields present even for
        // whatsapp so a later "convert to voice" admin action has
        // sensible defaults.
        campaignType,
        templateName: campaignType === "whatsapp" ? waTemplateName : undefined,
        templateLanguage: campaignType === "whatsapp" ? waTemplateLang : undefined,
        templateVarColumns: campaignType === "whatsapp" ? waVarColumns : undefined,
        sourcePhoneNumber,
        contactFlowId,
        contactFlowName: flow?.name,
        campaignQueueId: campaignQueueId || undefined,
        campaignQueueName: queue?.name,
        dialMode,
        concurrency,
        timezone,
        windowStartHour,
        windowEndHour,
        windowDaysOfWeek: [1, 2, 3, 4, 5],
        retryNoAnswerMinutes,
        retryMaxAttempts,
        maxContactsPerAgent,
        contacts: contacts.map((c) => ({
          phone: c.phone,
          customerName: c.customerName,
          // Inject a canonical `udep_nivel` attribute when we can derive
          // it from any nivel-like column in the CSV (grado de
          // instrucción, código de programa, etc). The Smart contact
          // flow branches on $.Attributes.udep_nivel — so this is what
          // makes lead-based routing work even when the CSV uses real-
          // world column names like "C_GRADO DE INSTRUCCION".
          attributes: (() => {
            const out = { ...c.attributes };
            const keys = Object.keys(out);
            const nivelKey = keys.find((k) =>
              NIVEL_KEYS.includes(k.trim().toLowerCase())
            );
            if (nivelKey && !out.udep_nivel) {
              const canonical = canonicaliseNivel(out[nivelKey] || "");
              if (canonical) out.udep_nivel = canonical;
            }
            return out;
          })(),
        })),
        createdBy: user?.username || "system",
        startNow: true,
      };
      const r = await fetch(endpoints.createCampaign, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body?.error || body?.message || `HTTP ${r.status}`);
      }
      toast.success(
        `Campaña creada (${body.totalContacts} contactos). Iniciando dialing...`
      );
      onCreated();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo crear la campaña"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva campaña</DialogTitle>
          <DialogDescription>
            Paso {step} de 4 ·{" "}
            {step === 1
              ? "Información básica"
              : step === 2
              ? "Listado de contactos"
              : step === 3
              ? "Cómo se van a marcar los leads"
              : "Revisar y lanzar"}
          </DialogDescription>
        </DialogHeader>

        <StepperIndicator step={step} />

        {/* STEP 1 — Meta */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre de la campaña *</Label>
              <Input
                id="name"
                placeholder="Ej: Recordatorio de cita médica Enero"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Textarea
                id="description"
                rows={3}
                placeholder="Contexto breve, objetivo, audiencia..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* STEP 2 — Contactos */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex gap-2 rounded-lg border p-1">
              <button
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  inputMode === "csv"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => setInputMode("csv")}
              >
                <FileSpreadsheet className="mr-1 inline h-4 w-4" />
                Subir CSV
              </button>
              <button
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  inputMode === "paste"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => setInputMode("paste")}
              >
                Pegar lista
              </button>
            </div>

            {inputMode === "csv" && (
              <div className="space-y-3">
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/40"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">
                    Click para subir CSV (o arrastra)
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Detecta columnas automáticamente · valida números con
                    libphonenumber · normaliza a E.164
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onFilePick(f);
                    }}
                  />
                </div>

                {detectedColumns && (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs">
                    <div className="mb-2 font-semibold">
                      Columnas detectadas:
                    </div>
                    <div className="space-y-0.5">
                      <div>
                        📞 <span className="text-muted-foreground">Phone:</span>{" "}
                        <code>{detectedColumns.phoneColumn}</code>
                      </div>
                      {(detectedColumns.firstNameColumn ||
                        detectedColumns.lastNameColumn) && (
                        <div>
                          👤{" "}
                          <span className="text-muted-foreground">Nombre:</span>{" "}
                          <code>
                            {detectedColumns.firstNameColumn}
                            {detectedColumns.firstNameColumn &&
                            detectedColumns.lastNameColumn
                              ? " + "
                              : ""}
                            {detectedColumns.lastNameColumn}
                          </code>
                        </div>
                      )}
                      {detectedColumns.nameColumn && (
                        <div>
                          👤{" "}
                          <span className="text-muted-foreground">Nombre:</span>{" "}
                          <code>{detectedColumns.nameColumn}</code>
                        </div>
                      )}
                      {detectedColumns.attributeColumns.length > 0 && (
                        <div>
                          🏷️{" "}
                          <span className="text-muted-foreground">
                            Attributes:
                          </span>{" "}
                          {detectedColumns.attributeColumns.map((c) => (
                            <Badge
                              key={c}
                              variant="outline"
                              className="ml-1 text-[10px]"
                            >
                              {c}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {inputMode === "paste" && (
              <div className="space-y-3">
                <Textarea
                  rows={6}
                  placeholder="+51987654321&#10;+51987654322&#10;+51987654323&#10;..."
                  value={pastedList}
                  onChange={(e) => setPastedList(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUsePastedList}
                  disabled={!pastedList.trim()}
                >
                  Parsear lista
                </Button>
              </div>
            )}

            {parseError && (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4" />
                {parseError}
              </div>
            )}

            {/* Preview */}
            {contacts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
                    {contacts.length} contactos
                    {skipped.length > 0 && (
                      <span className="ml-2 text-xs text-rose-600">
                        · {skipped.length} skipped
                      </span>
                    )}
                  </div>
                </div>

                {/* Lead routing preview: if the CSV has a `nivel` (or
                    similar) column we show the distribution per nivel
                    plus warnings for unknown / empty values. The wizard
                    doesn't gate on this — the smart flow routes
                    unknowns to UDEP-Pregrado by default. */}
                <LevelDistributionPreview contacts={contacts} />
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">Phone</th>
                        <th className="p-2 text-left">Nombre</th>
                        <th className="p-2 text-left">Attrs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.slice(0, 10).map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2 text-muted-foreground">{i + 1}</td>
                          <td className="p-2 font-mono">{c.phone}</td>
                          <td className="p-2">{c.customerName || "—"}</td>
                          <td className="p-2 text-[11px] text-muted-foreground">
                            {Object.keys(c.attributes).length > 0
                              ? Object.keys(c.attributes).slice(0, 3).join(", ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                      {contacts.length > 10 && (
                        <tr className="border-t bg-muted/30">
                          <td
                            colSpan={4}
                            className="p-2 text-center text-muted-foreground"
                          >
                            + {contacts.length - 10} más...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 — Dialing config */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Channel selector — switch the whole layout between
                voice (StartOutboundVoiceContact) and WhatsApp (Meta
                template send). */}
            <div className="space-y-2">
              <Label>Canal de la campaña</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCampaignType("voice")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                    campaignType === "voice"
                      ? "border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-950/30 dark:text-orange-200"
                      : "border-muted bg-muted/40 text-muted-foreground"
                  }`}
                >
                  📞 Llamada de voz
                </button>
                <button
                  type="button"
                  onClick={() => setCampaignType("whatsapp")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                    campaignType === "whatsapp"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                      : "border-muted bg-muted/40 text-muted-foreground"
                  }`}
                >
                  💬 WhatsApp (template Meta)
                </button>
              </div>
            </div>

            {/* WhatsApp template config — only when channel = whatsapp */}
            {campaignType === "whatsapp" && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div className="space-y-2">
                  <Label>Plantilla Meta (APPROVED)</Label>
                  <Select
                    value={waTemplateName}
                    onValueChange={(v) => setWaTemplateName(v || "")}
                    disabled={waTemplatesLoading || waTemplates.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          waTemplatesLoading
                            ? "Cargando templates…"
                            : waTemplates.length === 0
                            ? "No hay templates aprobados"
                            : "Elegir template"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {waTemplates.map((t) => (
                        <SelectItem key={t.metaTemplateId || t.name} value={t.name}>
                          {t.name} · {t.language || "es"} · {t.category || "?"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Preview of the rendered WhatsApp bubble: header,
                      body with {{N}} placeholders, footer, and the
                      action buttons (Quick Reply / URL / Phone) so the
                      manager sees exactly what the customer will get. */}
                  {(() => {
                    const tpl = waTemplates.find((t) => t.name === waTemplateName);
                    if (!tpl?.bodyText) return null;
                    return (
                      <div className="rounded-md border bg-background p-2 text-xs space-y-1">
                        {tpl.headerText && (
                          <div className="font-medium">{tpl.headerText}</div>
                        )}
                        <div className="whitespace-pre-wrap text-muted-foreground">
                          {tpl.bodyText}
                        </div>
                        {tpl.footerText && (
                          <div className="text-[10px] italic text-muted-foreground/70">
                            {tpl.footerText}
                          </div>
                        )}
                        {tpl.buttons && tpl.buttons.length > 0 && (
                          <div className="mt-2 border-t pt-1.5 flex flex-wrap gap-1.5">
                            {tpl.buttons.map((b, i) => {
                              const icon =
                                b.type === "URL"
                                  ? "🔗"
                                  : b.type === "PHONE_NUMBER"
                                  ? "📞"
                                  : b.type === "COPY_CODE"
                                  ? "📋"
                                  : "💬";
                              const subtitle =
                                b.url || b.phoneNumber || b.type.toLowerCase();
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-50 px-2.5 py-1 text-[10.5px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                                  title={subtitle}
                                >
                                  <span>{icon}</span>
                                  <span className="font-medium">{b.text}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Variable → CSV column mapping */}
                {waVarColumns.length > 0 && (
                  <div className="space-y-2">
                    <Label>Variables del template (mapear a CSV)</Label>
                    {waVarColumns.map((col, idx) => {
                      const csvCols = Object.keys(contacts[0]?.attributes ?? {});
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground w-12">
                            {`{{${idx + 1}}}`}
                          </span>
                          <Select
                            value={col}
                            onValueChange={(v) => {
                              setWaVarColumns((prev) => {
                                const next = [...prev];
                                next[idx] = v || "";
                                return next;
                              });
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Elegir columna del CSV…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__customerName__">
                                (Nombre del contacto)
                              </SelectItem>
                              {csvCols.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                    <div className="text-[11px] text-muted-foreground">
                      Cada variable se llena con el valor de la columna seleccionada
                      por cada lead. Si la columna no existe en un lead se envía vacía.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Voice config — only when channel = voice. We wrap the
                entire existing block in a fragment so the wizard renders
                NOTHING voice-specific when WhatsApp is selected. */}
            {campaignType === "voice" && (
            <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Número saliente</Label>
                <Select
                  value={sourcePhoneNumber}
                  onValueChange={(v) => setSourcePhoneNumber(v || "")}
                  disabled={phonesLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        phonesLoading ? "Cargando..." : "Elegir número"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {phones.map((p) => (
                      <SelectItem key={p.phoneNumberId} value={p.phoneNumber}>
                        {p.phoneNumber} · {p.countryCode}
                        {p.description ? ` · ${p.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact flow</Label>
                <Select
                  value={contactFlowId}
                  onValueChange={(v) => setContactFlowId(v || "")}
                  disabled={flowsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={flowsLoading ? "Cargando..." : "Elegir flow"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Colas detectadas del flow — READ-ONLY summary. Un flow
                puede enrutar a varias colas (UDEP-Outbound-Smart tiene 4
                según el udep_nivel del lead). Cuando el admin asigne
                agentes, podrá elegir qué cola atiende cada uno (UI smart
                en AssignedAgentsPanel). Aquí solo informamos.

                campaignQueueId sigue existiendo como fallback técnico:
                se auto-rellena con el primaryQueue del flow para que el
                backend tenga algo cuando una asignación llegue sin
                queueByUserId explícito. El usuario no lo edita. */}
            <div className="space-y-2">
              <Label>Colas que usará la campaña</Label>
              {flowQueuesLoading ? (
                <p className="text-xs text-muted-foreground">
                  Detectando colas del flow…
                </p>
              ) : flowQueues && flowQueues.literalQueues.length > 0 ? (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {flowQueues.literalQueues.map((q) => (
                      <span
                        key={q.queueId}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                      >
                        <span>✓</span>
                        {q.queueName}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {flowQueues.literalQueues.length === 1
                      ? "Esta campaña enviará todos los leads a esta cola."
                      : `Esta campaña enruta automáticamente a ${flowQueues.literalQueues.length} colas según los atributos del lead (por ejemplo udep_nivel). Cuando asignes agentes, vas a elegir qué cola atiende cada uno.`}
                  </p>
                </div>
              ) : flowQueues && flowQueues.dynamicQueues.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  El flow usa enrutamiento dinámico — las colas dependen
                  de los atributos del lead. Al asignar agentes podrás
                  elegir entre las colas disponibles del instance.
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Elige un Contact flow arriba para ver a qué colas
                  enrutará los leads.
                </p>
              )}
            </div>

            {/* Visual dial-mode picker — 4 tarjetas con descripción
                clara, sin jergon de contact center. */}
            <div className="space-y-2">
              <Label>¿Cómo se marcan los leads?</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DIAL_MODES.map((m) => {
                  const isActive = dialMode === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setDialMode(m.value)}
                      className={`text-left rounded-lg border p-3 transition ${
                        isActive
                          ? "border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-950/30"
                          : "border-muted bg-muted/30 hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg leading-none">{m.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm font-semibold ${
                              isActive
                                ? "text-orange-900 dark:text-orange-100"
                                : "text-foreground"
                            }`}
                          >
                            {m.label}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                            {m.short}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Detail text for the selected mode */}
              {(() => {
                const sel = DIAL_MODES.find((m) => m.value === dialMode);
                return sel ? (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pl-1">
                    💡 {sel.detail}
                  </p>
                ) : null;
              })()}
            </div>

            {/* Configuración avanzada — collapsible. Los campos
                quedan escondidos por defecto con valores razonables.
                Los expertos los abren si los necesitan. */}
            <details className="rounded-lg border bg-muted/20">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium hover:bg-muted/40 rounded-lg">
                Configuración avanzada (opcional)
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-4">
                <p className="text-[11px] text-muted-foreground">
                  Valores por defecto razonables. Tocalos solo si sabes
                  exactamente lo que necesitas.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Llamadas simultáneas</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={concurrency}
                      onChange={(e) =>
                        setConcurrency(parseInt(e.target.value) || 1)
                      }
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Cuántas llamadas puede tener la campaña en vuelo a
                      la vez. Más = más rápido, pero también más demanda
                      sobre los agentes.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cola por agente</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={maxContactsPerAgent}
                      onChange={(e) =>
                        setMaxContactsPerAgent(parseInt(e.target.value) || 5)
                      }
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Cuántos leads se le pre-asignan a cada agente. Los
                      ve en orden de llegada y los atiende uno por uno.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Horario de llamadas</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={windowStartHour}
                      onChange={(e) =>
                        setWindowStartHour(parseInt(e.target.value) || 0)
                      }
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">
                      hasta
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={windowEndHour}
                      onChange={(e) =>
                        setWindowEndHour(parseInt(e.target.value) || 0)
                      }
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">hs</span>
                    <Select
                      value={timezone}
                      onValueChange={(v) =>
                        setTimezone(v || "America/Lima")
                      }
                    >
                      <SelectTrigger className="flex-1 ml-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Fuera de este horario el dialer no marca. Para llamar
                    24/7, deja 0 → 23.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Si no contestan, reintentar en…
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={5}
                        max={1440}
                        value={retryNoAnswerMinutes}
                        onChange={(e) =>
                          setRetryNoAnswerMinutes(
                            parseInt(e.target.value) || 30
                          )
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        min
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Cuánto tiempo dejar pasar antes de volver a marcar
                      a un lead que no contestó.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Intentos máximos</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={retryMaxAttempts}
                      onChange={(e) =>
                        setRetryMaxAttempts(parseInt(e.target.value) || 3)
                      }
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Tras este número de intentos sin éxito, el lead se
                      marca como fallido y deja de reintentarse.
                    </p>
                  </div>
                </div>
              </div>
            </details>
            </>
            )}
          </div>
        )}

        {/* STEP 4 — Review */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Nombre</span>
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">Contactos</span>
                <span className="font-medium">
                  {contacts.length} válidos
                  {skipped.length > 0 && ` (${skipped.length} skipped)`}
                </span>
                <span className="text-muted-foreground">Número saliente</span>
                <span className="font-mono text-xs">{sourcePhoneNumber}</span>
                <span className="text-muted-foreground">Contact flow</span>
                <span className="text-xs">
                  {flows.find((f) => f.id === contactFlowId)?.name || "—"}
                </span>
                <span className="text-muted-foreground">Queue destino</span>
                <span className="text-xs">
                  {queues.find((q) => q.id === campaignQueueId)?.name ||
                    "— (no asignable)"}
                </span>
                <span className="text-muted-foreground">Dial mode</span>
                <span>{dialMode}</span>
                <span className="text-muted-foreground">Concurrencia</span>
                <span>{concurrency}</span>
                <span className="text-muted-foreground">Zona horaria</span>
                <span>{timezone}</span>
                <span className="text-muted-foreground">Ventana</span>
                <span>
                  {windowStartHour}:00 – {windowEndHour}:00
                </span>
                <span className="text-muted-foreground">Retry</span>
                <span>
                  cada {retryNoAnswerMinutes} min · max {retryMaxAttempts}{" "}
                  intentos
                </span>
                <span className="text-muted-foreground">
                  Capacidad por agente
                </span>
                <span>{maxContactsPerAgent} contactos en su cola</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Rocket className="h-4 w-4" />
              Al confirmar, la campaña inicia inmediatamente y el dialer
              comenzará a llamar en el próximo tick (~1 min).
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={submitting}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Atrás
            </Button>
          )}

          {/* On step 2 we expose a 1-click "Lanzar ahora" fast path:
              with auto-name + auto-flow + auto-source-phone + sensible
              defaults already applied, the manager just needs to drop
              a CSV and click. The "Siguiente" button stays as the
              power-user path to tweak dial mode, concurrency, window,
              retries, etc. */}
          {step === 2 && canProceedStep2 && (
            <Button
              onClick={handleCreate}
              disabled={submitting || !canProceedStep3}
              title={
                !canProceedStep3
                  ? "Falta source phone o contact flow — usa Siguiente para configurar"
                  : "Lanzar con la configuración por defecto"
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Lanzando…
                </>
              ) : (
                <>
                  <Rocket className="mr-1 h-4 w-4" />
                  Lanzar campaña
                </>
              )}
            </Button>
          )}

          {step < 4 && (
            <Button
              variant={step === 2 ? "outline" : "default"}
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3)
              }
            >
              Siguiente
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Creando...
                </>
              ) : (
                <>
                  <Rocket className="mr-1 h-4 w-4" />
                  Lanzar campaña
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lead routing distribution preview shown after CSV upload. Looks for a
 * `nivel` (or equivalent) column in the parsed contacts and renders:
 *   - One row per nivel value found, with count + percentage bar
 *   - A warning chip for unknown values (anything outside the known set)
 *   - A warning chip for leads missing nivel entirely (they'll go to
 *     the default Pregrado queue via the UDEP-Outbound-Smart flow)
 *
 * When the CSV has no nivel-style column at all, the component renders
 * nothing — the wizard works the same as before for non-UDEP CSVs.
 */
const NIVEL_KEYS = [
  "nivel",
  "level",
  "udep_nivel",
  "tipo",
  "category",
  // Real-world UDEP CSV columns — same data, different name. We pick
  // the first one that's present in the CSV header.
  "c_grado de instruccion",
  "c_grado_de_instruccion",
  "grado de instruccion",
  "grado_instruccion",
  "a_codigo del programa",
  "a_codigo_del_programa",
  "codigo programa",
];

const KNOWN_NIVELS = new Set([
  "pregrado",
  "posgrado",
  "diplomados",
  "alumnos",
]);

// Map values found in CSVs to one of the 4 canonical nivels the
// UDEP-Outbound-Smart flow knows. This is the place to extend when
// a new program-code mapping needs to be supported.
const NIVEL_ALIAS: Record<string, string> = {
  // Grado-de-instrucción synonyms
  universitario: "pregrado",
  pregrado: "pregrado",
  bachiller: "pregrado",
  posgrado: "posgrado",
  postgrado: "posgrado",
  maestria: "posgrado",
  "maestría": "posgrado",
  doctorado: "posgrado",
  mba: "posgrado",
  diplomado: "diplomados",
  diplomados: "diplomados",
  alumno: "alumnos",
  alumnos: "alumnos",
  // Program-code prefixes (anything starting with these maps to the
  // matching nivel via the prefix check in canonicaliseNivel below).
};

const NIVEL_PROGRAM_PREFIX: Array<[RegExp, string]> = [
  [/^prg|^pre/i, "pregrado"],
  [/^pos|^mae|^mba|^doc/i, "posgrado"],
  [/^dip/i, "diplomados"],
  [/^alu/i, "alumnos"],
];

function canonicaliseNivel(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (KNOWN_NIVELS.has(v)) return v;
  if (NIVEL_ALIAS[v]) return NIVEL_ALIAS[v];
  for (const [re, target] of NIVEL_PROGRAM_PREFIX) {
    if (re.test(v)) return target;
  }
  return null; // unknown
}

const NIVEL_TONE: Record<string, string> = {
  pregrado: "bg-emerald-500",
  posgrado: "bg-blue-500",
  diplomados: "bg-violet-500",
  alumnos: "bg-amber-500",
};

function LevelDistributionPreview({ contacts }: { contacts: ParsedContact[] }) {
  // Detect which attribute key carries the nivel — case-insensitive.
  // We look at the FIRST contact's attribute keys; CSV header is the same
  // for every row so this is safe.
  const sampleKeys = Object.keys(contacts[0]?.attributes ?? {});
  const nivelKey = sampleKeys.find((k) =>
    NIVEL_KEYS.includes(k.trim().toLowerCase())
  );

  if (!nivelKey) return null;

  // Tally each canonical nivel, plus the empty / unknown buckets.
  // We push raw values through canonicaliseNivel so "Universitario"
  // → "pregrado", "PRG100" → "pregrado", etc.
  const counts = new Map<string, number>();
  const unknownByRaw = new Map<string, number>();
  let empty = 0;
  for (const c of contacts) {
    const raw = (c.attributes[nivelKey] ?? "").trim();
    if (!raw) {
      empty += 1;
      continue;
    }
    const canonical = canonicaliseNivel(raw);
    if (canonical) {
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    } else {
      unknownByRaw.set(raw, (unknownByRaw.get(raw) ?? 0) + 1);
    }
  }

  const total = contacts.length;
  const knownEntries: Array<[string, number]> = Array.from(counts.entries());
  const unknownEntries: Array<[string, number]> = Array.from(unknownByRaw.entries());
  knownEntries.sort((a, b) => b[1] - a[1]);
  unknownEntries.sort((a, b) => b[1] - a[1]);

  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">
          Distribución por <span className="font-mono">{nivelKey}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          se ruteará automáticamente al asesor correspondiente
        </div>
      </div>

      <div className="space-y-1.5">
        {knownEntries.map(([nivel, count]) => (
          <div key={nivel} className="flex items-center gap-2 text-xs">
            <span className="w-20 capitalize">{nivel}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`absolute inset-y-0 left-0 ${
                  NIVEL_TONE[nivel] || "bg-foreground/60"
                }`}
                style={{ width: `${pct(count)}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono tabular-nums">
              {count}
            </span>
            <span className="w-10 text-right text-muted-foreground tabular-nums">
              {pct(count)}%
            </span>
          </div>
        ))}
      </div>

      {(unknownEntries.length > 0 || empty > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {empty > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-3 w-3" />
              {empty} sin <span className="font-mono">{nivelKey}</span> → irán a
              UDEP-Pregrado por default
            </span>
          )}
          {unknownEntries.map(([nivel, count]) => (
            <span
              key={nivel}
              className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-1 text-[11px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
              title="Valor no reconocido — caerán al default Pregrado"
            >
              <AlertTriangle className="h-3 w-3" />
              {count} con "{nivel}" (desconocido)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StepperIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            s <= step
              ? "bg-gradient-to-r from-orange-500 to-pink-600"
              : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
