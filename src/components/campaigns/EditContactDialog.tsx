import { useEffect, useState } from "react";
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
import { Loader2, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";
import type { CampaignContactRow } from "@/hooks/useCampaignContacts";

interface Props {
  campaignId: string;
  contact: CampaignContactRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// Normalize a flexibly-typed attributes value (string | object) to a record
function normalizeAttrs(
  raw: unknown
): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, string>;
}

export function EditContactDialog({
  campaignId,
  contact,
  open,
  onClose,
  onSaved,
}: Props) {
  const { updateContact, pending } = useCampaignContactMutations();
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [attrPairs, setAttrPairs] = useState<Array<{ key: string; value: string }>>(
    []
  );

  useEffect(() => {
    if (contact && open) {
      setPhone(contact.phone || "");
      setCustomerName(contact.customerName || "");
      const attrs = normalizeAttrs(contact.customAttributes);
      setAttrPairs(
        Object.entries(attrs).map(([key, value]) => ({
          key,
          value: String(value),
        }))
      );
    }
  }, [contact, open]);

  if (!contact) return null;

  const locked =
    contact.status === "dialing" || contact.status === "connected";

  const addAttr = () => setAttrPairs([...attrPairs, { key: "", value: "" }]);
  const removeAttr = (i: number) =>
    setAttrPairs(attrPairs.filter((_, idx) => idx !== i));
  const updateAttr = (i: number, field: "key" | "value", v: string) => {
    const copy = [...attrPairs];
    copy[i] = { ...copy[i], [field]: v };
    setAttrPairs(copy);
  };

  const handleSave = async () => {
    // Collect non-empty key-value pairs
    const attributes: Record<string, string> = {};
    for (const { key, value } of attrPairs) {
      const k = key.trim();
      if (k) attributes[k] = value;
    }
    try {
      await updateContact(campaignId, contact.rowId, {
        phone: phone.trim(),
        customerName: customerName.trim(),
        attributes,
      });
      toast.success("Contacto actualizado");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar contacto</DialogTitle>
          <DialogDescription>
            Status actual: <strong>{contact.status}</strong> · {contact.attempts}{" "}
            intento{contact.attempts === 1 ? "" : "s"}
            {locked && (
              <span className="block text-[var(--accent-red)]">
                No se puede editar mientras la llamada está {contact.status}.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={locked || pending} className="space-y-4 disabled:opacity-60">
          <div className="space-y-2">
            <Label>Teléfono (E.164)</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+51987654321"
            />
          </div>
          <div className="space-y-2">
            <Label>Nombre del cliente</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Ej: Juan Pérez"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Atributos personalizados</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addAttr}
              >
                <Plus className="mr-1 h-3 w-3" />
                Agregar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Se pasan al contact flow como Contact Attributes
              (<code>$.Attributes.*</code>).
            </p>
            {attrPairs.length === 0 && (
              <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                Sin atributos. Click "Agregar" para añadir uno.
              </p>
            )}
            {attrPairs.map((pair, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="clave (ej: cuenta_id)"
                  value={pair.key}
                  onChange={(e) => updateAttr(i, "key", e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="valor"
                  value={pair.value}
                  onChange={(e) => updateAttr(i, "value", e.target.value)}
                  className="flex-[2]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0"
                  onClick={() => removeAttr(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={locked || pending || !phone.trim()}>
            {pending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-1 h-4 w-4" />
                Guardar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
