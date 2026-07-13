import { useMemo, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { StageColumn, stageColor, type Lead } from "@/pages/LeadsPage";
import { PipelineSummary, type PipelineStageStat } from "@/components/leads/PipelineSummary";

/**
 * /leads-demo — preview sin auth del board de Leads premium (PipelineSummary +
 * StageColumn + LeadCard) con datos mock. DEV only. Sirve para iterar el pulido
 * visual sin login (la página real está tras Cognito).
 */

// Mock de una taxonomía con VARIAS etapas — el color sale de stageColor(i)
// (paleta por posición), igual que en la página real, para mostrar que cada
// etapa tiene su propio color por más etapas que cree el usuario.
const STAGE_DEFS: { id: string; label: string }[] = [
  { id: "nuevo", label: "Nuevo" },
  { id: "calificacion", label: "Calificación" },
  { id: "contactado", label: "Contactado" },
  { id: "interesado", label: "Interesado" },
  { id: "propuesta", label: "Propuesta" },
  { id: "negociando", label: "Negociando" },
  { id: "cerrado", label: "Cerrado" },
];
const STAGES = STAGE_DEFS.map((s, i) => ({ ...s, color: stageColor(i) }));

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600000).toISOString();

const LEADS: Lead[] = [
  {
    leadId: "1",
    name: "María Quispe",
    phone: "+51 987 654 321",
    company: "Bodega Alata",
    email: "maria@alata.pe",
    stageId: "nuevo",
    source: "web_form",
    montoEstimado: 1200,
    updatedAt: ago(2),
    createdAt: ago(2),
  },
  {
    leadId: "2",
    name: "Carlos Mendoza",
    phone: "+51 911 222 333",
    company: "Ferretería Sur",
    stageId: "nuevo",
    source: "campaign",
    montoEstimado: 800,
    updatedAt: ago(20),
    createdAt: ago(20),
  },
  {
    leadId: "3",
    name: "Lucía Ramos",
    phone: "+51 955 888 777",
    company: "Clínica Dental Norte",
    email: "lucia@dentalnorte.pe",
    stageId: "calificacion",
    source: "whatsapp",
    montoEstimado: 4500,
    updatedAt: ago(5),
    createdAt: ago(48),
    sfLeadId: "00Q1",
  },
  {
    leadId: "4",
    name: "Jorge Salas",
    phone: "+51 933 444 555",
    stageId: "contactado",
    source: "manual",
    updatedAt: ago(190),
    createdAt: ago(200),
  },
  {
    leadId: "5",
    name: "Andrea Flores",
    phone: "+51 944 111 999",
    company: "Distribuidora ABC",
    email: "andrea@abc.pe",
    stageId: "interesado",
    source: "salesforce",
    montoEstimado: 12000,
    updatedAt: ago(8),
    createdAt: ago(72),
    sfLeadId: "00Q2",
  },
  {
    leadId: "6",
    name: "Pedro Vega",
    phone: "+51 922 333 111",
    company: "Transportes Vega",
    stageId: "propuesta",
    source: "web_form",
    montoEstimado: 7800,
    updatedAt: ago(30),
    createdAt: ago(120),
  },
  {
    leadId: "7",
    name: "Sofía Núñez",
    phone: "+51 988 777 666",
    company: "Estudio Núñez",
    email: "sofia@nunez.pe",
    stageId: "negociando",
    source: "whatsapp",
    montoEstimado: 25000,
    updatedAt: ago(3),
    createdAt: ago(96),
    sfLeadId: "00Q3",
  },
  {
    leadId: "8",
    name: "Diego Torres",
    phone: "+51 977 555 444",
    company: "Importadora Torres",
    stageId: "cerrado",
    source: "campaign",
    montoEstimado: 18000,
    updatedAt: ago(12),
    createdAt: ago(240),
    sfLeadId: "00Q4",
  },
];

export function LeadsDemoPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const noop = () => {};
  const noopAsync = async () => {};

  const byStage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    for (const s of STAGES) m.set(s.id, []);
    for (const l of LEADS) (m.get(l.stageId || "nuevo") || m.get("nuevo")!).push(l);
    return m;
  }, []);

  const pipelineStages: PipelineStageStat[] = STAGES.map((s) => {
    const items = byStage.get(s.id) || [];
    return {
      id: s.id,
      label: s.label,
      color: s.color,
      count: items.length,
      value: items.reduce((a, l) => a + (l.montoEstimado || 0), 0),
    };
  });
  const totalLeads = LEADS.length;
  const totalValue = LEADS.reduce((a, l) => a + (l.montoEstimado || 0), 0);
  const weightedValue = Math.round(totalValue * 0.46);

  const toggle = (id: string) =>
    setSelectedIds((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
        <div
          style={{
            marginBottom: 6,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Leads · preview premium (mock)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 18px", color: "var(--text-1)" }}>
          Embudo de ventas
        </h1>

        <PipelineSummary
          stages={pipelineStages}
          totalLeads={totalLeads}
          totalValue={totalValue}
          weightedValue={weightedValue}
        />

        <DndProvider backend={HTML5Backend}>
          <div
            style={{
              display: "flex",
              gap: 14,
              overflowX: "auto",
              paddingBottom: 12,
              alignItems: "flex-start",
            }}
          >
            {STAGES.map((s, i) => {
              const items = byStage.get(s.id) || [];
              const colValue = items.reduce((a, l) => a + (l.montoEstimado || 0), 0);
              // Share del pipeline (% del total), coherente con el board real.
              const conv = totalLeads > 0 ? Math.round((items.length / totalLeads) * 100) : null;
              return (
                <StageColumn
                  key={s.id}
                  stageId={s.id}
                  label={s.label}
                  color={s.color}
                  items={items}
                  totalValue={colValue}
                  weightedValue={Math.round(colValue * (0.2 + i * 0.18))}
                  conversionPct={conv}
                  canManage
                  onDropLead={noop}
                  onOpenLead={noop}
                  onQuickCreate={noopAsync}
                  onCall={noop}
                  onWhatsApp={noop}
                  selectedIds={selectedIds}
                  onToggleLead={toggle}
                />
              );
            })}
          </div>
        </DndProvider>
      </div>
    </div>
  );
}
