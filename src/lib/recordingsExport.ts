import type { RecentLead } from "@/types/recordings";
import type { LeadOverview } from "@/hooks/useLeadOverview";
import type { ActiveCall } from "@/components/recordings/CallPlayerView";

/** ms → "m:ss" para las marcas de tiempo del transcript exportado. */
function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PART: Record<string, string> = {
  AGENT: "Agente",
  CUSTOMER: "Cliente",
  SYSTEM: "Sistema",
};

/**
 * Arma un Markdown legible con la ficha del contacto: datos, resumen de la
 * relación por canal, y —si hay una llamada abierta— su transcripción con marcas
 * de tiempo. Todo client-side; no toca el backend.
 */
export function buildContactMarkdown(opts: {
  lead: RecentLead;
  ov: LeadOverview;
  activeCall: ActiveCall | null;
  stageLabel?: string;
}): string {
  const { lead, ov, activeCall, stageLabel } = opts;
  const L: string[] = [];
  const name = lead.name || lead.phone;
  L.push(`# ${name}`, "");

  const facts: string[] = [];
  if (lead.phone) facts.push(`- **Teléfono:** ${lead.phone}`);
  if (lead.email) facts.push(`- **Email:** ${lead.email}`);
  if (lead.company) facts.push(`- **Empresa:** ${lead.company}`);
  if (stageLabel) facts.push(`- **Etapa:** ${stageLabel}`);
  if (lead.source) facts.push(`- **Origen:** ${lead.source}`);
  if (facts.length) L.push(...facts, "");

  L.push("## Resumen de la relación");
  const ch: [string, number | undefined][] = [
    ["Llamadas", ov.calls?.count],
    ["WhatsApp", ov.whatsapp?.count],
    ["Emails", ov.emails?.count],
    ["Archivos", ov.files?.count],
  ];
  let any = false;
  for (const [label, n] of ch) {
    if (n) {
      L.push(`- ${label}: ${n}`);
      any = true;
    }
  }
  if (!any) L.push("- (Sin interacciones registradas)");
  L.push("");

  if (activeCall && activeCall.segments.length > 0) {
    L.push("## Transcripción de la llamada", "");
    for (const s of activeCall.segments) {
      const who = PART[(s.participant || "").toUpperCase()] || s.participant || "—";
      const content = (s.content || "").trim();
      if (content) L.push(`**[${mmss(s.beginOffsetMs || 0)}] ${who}:** ${content}`);
    }
    L.push("");
  }

  L.push(`_Exportado desde ARIA · ${new Date().toLocaleString("es-PE")}_`);
  return L.join("\n");
}

/** Dispara la descarga de un archivo de texto generado en el navegador. */
export function downloadText(filename: string, content: string, mime = "text/markdown"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
