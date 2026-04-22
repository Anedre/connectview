import { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { parseCsvText, parsePhoneList, type ParsedContact } from "@/lib/csvParser";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";

interface Props {
  campaignId: string | null;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddContactsDialog({ campaignId, open, onClose, onAdded }: Props) {
  const { addContacts, pending } = useCampaignContactMutations();
  const [inputMode, setInputMode] = useState<"csv" | "paste">("paste");
  const [pastedList, setPastedList] = useState("");
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [skipped, setSkipped] = useState<Array<{ reason: string }>>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setInputMode("paste");
        setPastedList("");
        setContacts([]);
        setSkipped([]);
        setParseError(null);
      }, 200);
    }
  }, [open]);

  const onFilePick = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const result = await parseCsvText(text, "PE");
      if (!result.detected.phoneColumn) {
        setParseError("No se detectó columna de teléfono en el CSV.");
        return;
      }
      setContacts(result.contacts);
      setSkipped(result.skipped.map((s) => ({ reason: s.reason })));
      toast.success(
        `${result.contacts.length} contactos parseados (${result.skipped.length} skipped)`
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse error");
    }
  };

  const onUsePastedList = () => {
    const result = parsePhoneList(pastedList, "PE");
    setContacts(result.contacts);
    setSkipped(result.skipped.map((s) => ({ reason: `Invalid phone: ${s}` })));
    if (result.contacts.length === 0) {
      setParseError("No se encontró ningún teléfono válido.");
    } else {
      setParseError(null);
      toast.success(`${result.contacts.length} teléfonos parseados`);
    }
  };

  const handleSubmit = async () => {
    if (!campaignId || contacts.length === 0) return;
    try {
      const res = await addContacts(
        campaignId,
        contacts.map((c) => ({
          phone: c.phone,
          customerName: c.customerName,
          attributes: c.attributes,
        }))
      );
      toast.success(
        `${res.inserted} contactos agregados${
          res.skipped ? ` (${res.skipped} inválidos)` : ""
        }`
      );
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error agregando");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agregar contactos a la campaña</DialogTitle>
          <DialogDescription>
            Se agregan como <strong>pending</strong>. Si la campaña está
            RUNNING, el dialer los tomará en el próximo tick.
          </DialogDescription>
        </DialogHeader>

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
          <div>
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/40"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">
                Click para subir CSV
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Auto-detecta columnas · normaliza E.164
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
          </div>
        )}

        {inputMode === "paste" && (
          <div className="space-y-2">
            <Textarea
              rows={6}
              placeholder="+51987654321&#10;+51987654322&#10;+51987654323"
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

        {contacts.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
              {contacts.length} contactos listos
              {skipped.length > 0 && (
                <Badge variant="outline" className="ml-2 text-xs">
                  {skipped.length} skipped
                </Badge>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Nombre</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.slice(0, 10).map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">{c.phone}</td>
                      <td className="p-2">{c.customerName || "—"}</td>
                    </tr>
                  ))}
                  {contacts.length > 10 && (
                    <tr className="border-t bg-muted/30">
                      <td colSpan={2} className="p-2 text-center text-muted-foreground">
                        + {contacts.length - 10} más...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || contacts.length === 0}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Agregando...
              </>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Agregar {contacts.length} contacto{contacts.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
