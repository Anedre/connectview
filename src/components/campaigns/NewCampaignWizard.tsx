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
import { getApiEndpoints } from "@/lib/api";
import { parseCsvText, parsePhoneList, type ParsedContact } from "@/lib/csvParser";
import { useAuth } from "@/hooks/useAuth";

interface NewCampaignWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Step = 1 | 2 | 3 | 4;

const DIAL_MODES = [
  { value: "progressive", label: "Progressive (1 llamada por agente libre)" },
  { value: "power", label: "Power (2 llamadas por agente libre)" },
  { value: "agentless", label: "Agentless (IVR sin agente)" },
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

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Meta
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

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
  const [dialMode, setDialMode] = useState("progressive");
  const [concurrency, setConcurrency] = useState(5);
  const [timezone, setTimezone] = useState("America/Lima");
  const [windowStartHour, setWindowStartHour] = useState(9);
  const [windowEndHour, setWindowEndHour] = useState(18);
  const [retryNoAnswerMinutes, setRetryNoAnswerMinutes] = useState(30);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);

  // Reset when modal closes
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
      }, 200);
    }
  }, [open]);

  // Default selections once flows & phones load
  useEffect(() => {
    if (!sourcePhoneNumber && phones.length > 0) {
      setSourcePhoneNumber(phones[0].phoneNumber);
    }
  }, [phones, sourcePhoneNumber]);

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
  const canProceedStep3 = !!sourcePhoneNumber && !!contactFlowId;

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.createCampaign) {
        throw new Error("createCampaign endpoint not configured");
      }
      const flow = flows.find((f) => f.id === contactFlowId);
      const payload = {
        name: name.trim(),
        description: description.trim(),
        sourcePhoneNumber,
        contactFlowId,
        contactFlowName: flow?.name,
        dialMode,
        concurrency,
        timezone,
        windowStartHour,
        windowEndHour,
        windowDaysOfWeek: [1, 2, 3, 4, 5],
        retryNoAnswerMinutes,
        retryMaxAttempts,
        contacts: contacts.map((c) => ({
          phone: c.phone,
          customerName: c.customerName,
          attributes: c.attributes,
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
              ? "Configuración de dialing"
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Dial mode</Label>
                <Select value={dialMode} onValueChange={(v) => setDialMode(v || "progressive")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIAL_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Concurrencia máx.</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={concurrency}
                  onChange={(e) =>
                    setConcurrency(parseInt(e.target.value) || 1)
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Zona horaria</Label>
              <Select value={timezone} onValueChange={(v) => setTimezone(v || "America/Lima")}>
                <SelectTrigger>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ventana desde (hora)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={windowStartHour}
                  onChange={(e) =>
                    setWindowStartHour(parseInt(e.target.value) || 0)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Ventana hasta (hora)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={windowEndHour}
                  onChange={(e) =>
                    setWindowEndHour(parseInt(e.target.value) || 0)
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Retry no-answer (min)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={retryNoAnswerMinutes}
                  onChange={(e) =>
                    setRetryNoAnswerMinutes(parseInt(e.target.value) || 30)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Máx. intentos</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={retryMaxAttempts}
                  onChange={(e) =>
                    setRetryMaxAttempts(parseInt(e.target.value) || 3)
                  }
                />
              </div>
            </div>
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
          {step < 4 && (
            <Button
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
