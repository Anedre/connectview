import { toast } from "sonner";
import { emitContactEvent } from "@/lib/contactEvents";

/**
 * Helpers de Salesforce para el frontend. Centraliza el "toast de lead guardado
 * con botón Ver en Salesforce": cada vez que se crea/edita un lead y sincroniza a
 * SF, mostramos un aviso con un botón que abre ese Lead exacto en la org del tenant.
 */

/** URL Lightning del Lead en la org de Salesforce del tenant. null si falta dato. */
export function salesforceLeadUrl(
  instanceUrl?: string | null,
  sfLeadId?: string | null,
): string | null {
  if (!instanceUrl || !sfLeadId) return null;
  return `${instanceUrl.replace(/\/+$/, "")}/lightning/r/Lead/${sfLeadId}/view`;
}

interface LeadSavedOpts {
  isNew?: boolean;
  /** Bloque `salesforce` de la respuesta de manage-leads: { leadId, action }. */
  salesforce?: { leadId?: string; action?: string } | null;
  instanceUrl?: string | null;
  /** Mensaje base opcional (default "Lead creado/actualizado"). */
  message?: string;
}

/**
 * Toast de éxito al guardar un lead, con un botón "Ver en Salesforce" que abre el
 * Lead exacto en la org del tenant (si sincronizó a SF). Sin SF → toast simple.
 * Un solo lugar para el patrón, reutilizable en todos los puntos de guardado.
 */
export function leadSavedToast(opts: LeadSavedOpts): void {
  const msg = opts.message || (opts.isNew ? "Lead creado" : "Lead actualizado");
  const url = salesforceLeadUrl(opts.instanceUrl, opts.salesforce?.leadId);
  if (url && opts.salesforce?.action && opts.salesforce.action !== "skipped") {
    toast.success(msg, {
      description: "Sincronizado con Salesforce",
      action: {
        label: "Ver en Salesforce",
        onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
      },
      duration: 8000,
    });
  } else {
    toast.success(msg);
  }
  // Propaga a las vistas suscritas (Leads / Reportes / Dashboard) para que
  // reflejen el lead recién guardado sin «Actualizar» — auto-update por el bus.
  try {
    emitContactEvent({ type: "lead:updated", leadId: opts.salesforce?.leadId ?? undefined });
  } catch {
    /* noop */
  }
}
