import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCampaignStats } from "@/hooks/useCampaignStats";
import { useCampaignContacts, type CampaignContactRow } from "@/hooks/useCampaignContacts";
import { useCampaignMutations, type RelaunchScope } from "@/hooks/useCampaignMutations";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";
import { useCan } from "@/hooks/usePermissions";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useCustomerNamesByPhone } from "@/hooks/useCustomerNamesByPhone";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { EditCampaignDialog } from "@/components/campaigns/EditCampaignDialog";
import { AddContactsDialog } from "@/components/campaigns/AddContactsDialog";
import { EditContactDialog } from "@/components/campaigns/EditContactDialog";
import { AssignedAgentsPanel } from "@/components/campaigns/AssignedAgentsPanel";
import { CampaignCharts } from "@/components/campaigns/CampaignCharts";
import { CampaignActivity } from "@/components/campaigns/CampaignActivity";
import { CampaignMonitoringPanel } from "@/components/campaigns/CampaignMonitoringPanel";
import { PacingControlCard } from "@/components/campaigns/PacingControlCard";
import { CampaignOrchestrationCard } from "@/components/campaigns/CampaignOrchestrationCard";
import { WhatsAppTemplateSummary } from "@/components/campaigns/WhatsAppTemplateSummary";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Btn, Pill, Num, HeroBand } from "@/components/aria";
import { BusinessHoursPreview } from "@/components/campaigns/BusinessHoursPreview";
import {
  formatInZone,
  formatRelative,
  isWithinSchedule,
  nextScheduleChange,
  parseScheduleSnapshot,
  scheduleFromWindow,
} from "@/lib/callWindow";

// UUID heuristic — matches the v4 ARN-suffix form Connect emits. Used in
// the contacts table to detect legacy rows where agentUsername was written
// as a user-id instead of an actual username (the bug was fixed in
// process-contact-event but old rows may still have UUIDs).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map contact-row statuses → Vox chip variant classes. The Vox design
// system uses `.chip + .chip--<color>` for tags / status pills.
const STATUS_CHIP: Record<string, string> = {
  pending: "chip",
  dialing: "chip chip--cyan",
  connected: "chip chip--green",
  done: "chip chip--green",
  no_answer: "chip chip--amber",
  failed: "chip chip--red",
};

// Etiqueta legible (ES) de cada estado de contacto. Antes la tabla mostraba el
// string crudo ("no_answer", "dialing") mientras el resto de la página usaba
// español → dos vocabularios en la misma pantalla. Este mapa unifica.
const STATUS_LABEL_ES: Record<string, string> = {
  pending: "Pendiente",
  dialing: "Marcando",
  connected: "Conectado",
  done: "Completado",
  no_answer: "Sin contestar",
  failed: "Fallido",
  suppressed: "Suprimido",
};

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  SCHEDULED: "Programada",
  RUNNING: "En curso",
  PAUSED: "Pausada",
  COMPLETED: "Terminada",
  CANCELLED: "Cancelada",
};

// Campaign status → ARIA Pill tone (matches the CampaignsPage list).
const CAMPAIGN_STATUS_TONE: Record<string, "green" | "gold" | "cyan" | "red" | "outline"> = {
  DRAFT: "outline",
  SCHEDULED: "cyan",
  RUNNING: "green",
  PAUSED: "gold",
  COMPLETED: "cyan",
  CANCELLED: "red",
};

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useCampaignStats(campaignId || null, 3000);

  // El horario lo evalúa @/lib/callWindow, espejo exacto de la lógica del dialer
  // (_shared/callWindow.ts). Antes esto era una copia local que se quedó sin el
  // fix del bug de medianoche, así que el banner mentía respecto de lo que el
  // discador hacía de verdad.
  //
  // Se prefiere la copia guardada del Hours of Operation sobre la ventana
  // manual, en el mismo orden que usa el dialer. La diferencia es que acá no se
  // relee Connect: la copia alcanza para el banner y ahorra una llamada por
  // render. Va arriba de los returns tempranos porque es un hook.
  const hoursSnapshot = data?.campaign?.hoursOfOperationSnapshot;
  const campaignSchedule = useMemo(
    () =>
      parseScheduleSnapshot(hoursSnapshot) ||
      scheduleFromWindow(data?.campaign || { timezone: "America/Lima" }),
    [
      hoursSnapshot,
      data?.campaign?.timezone,
      data?.campaign?.windowStartHour,
      data?.campaign?.windowEndHour,
      data?.campaign?.windowDaysOfWeek,
      data?.campaign,
    ],
  );

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const { contacts, refresh: refreshContacts } = useCampaignContacts(
    campaignId || null,
    filterStatus,
    5000,
  );
  const [controlling, setControlling] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addContactsOpen, setAddContactsOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CampaignContactRow | null>(null);
  // Contacts table — search + bulk select state.
  const [contactSearch, setContactSearch] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  // Reorganización en 3 vistas para no apilar ~12 bloques en una columna:
  //  · live    — dashboard en vivo (tiles + gráficos + monitoreo + actividad)
  //  · contacts— la tabla de contactos (buscador, filtros, export, masivas)
  //  · config  — pacing + orquestación + agentes (voz) / plantilla (WhatsApp)
  const [tab, setTab] = useState<"live" | "contacts" | "config">("live");

  // ── Filtered contacts (search + status filter) ────────────────
  // Must live above the early-return guards — calling hooks
  // conditionally would violate the rules of hooks.
  const visibleContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((row) => {
      return (
        row.phone.toLowerCase().includes(q) ||
        (row.customerName || "").toLowerCase().includes(q) ||
        Object.values(row.customAttributes || {})
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [contacts, contactSearch]);

  // ── Customer name resolution by phone ─────────────────────────
  // Many campaigns are imported as phone-only — the `customerName`
  // field on the row is empty even though Customer Profiles has the
  // real name. We bulk-lookup the profiles in the background and
  // fall back to the resolved name in the table.
  const phonesNeedingName = useMemo(() => {
    return contacts.filter((c) => !c.customerName && c.phone).map((c) => c.phone);
  }, [contacts]);
  const namesByPhone = useCustomerNamesByPhone(phonesNeedingName);

  // ── Bulk operations on selected rows ──────────────────────────
  const lockedRowCount = useMemo(
    () =>
      contacts.filter(
        (r) => selectedRowIds.has(r.rowId) && (r.status === "dialing" || r.status === "connected"),
      ).length,
    [contacts, selectedRowIds],
  );
  const mutations = useCampaignMutations();
  const contactMutations = useCampaignContactMutations();
  // Gestión (editar/clonar/relanzar/iniciar/pausar/cancelar) = `manage_campaigns`
  // (Admin por defecto). Un Supervisor entra a monitorear la campaña en vivo, pero
  // sin los controles. Configurable en Configuración → Seguridad.
  const canManage = useCan("manage_campaigns");
  const { confirm, confirmDialog } = useConfirm();
  // Control admin en vivo: colgar una llamada puntual (admin-stop-contact,
  // backend exige Supervisor/Admin vía JWT).
  const { stopContact } = useAdminActions();
  // Pull assigned agents so we can resolve user-ids (assignedAgentUserId on
  // the contact row, and any UUID that snuck into agentUsername on legacy
  // rows) into human-readable usernames in the table.
  const { agents: assignedAgents } = useCampaignAgents(campaignId || null);
  const agentNameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignedAgents) map.set(a.userId, a.username);
    return map;
  }, [assignedAgents]);

  const resolveAgentLabel = (raw: string | undefined | null): string => {
    if (!raw) return "—";
    // If it looks like a Connect UUID, try to swap it for a username.
    if (UUID_RE.test(raw)) {
      const username = agentNameByUserId.get(raw);
      return username || "—";
    }
    return raw;
  };

  const handleDeleteContact = async (row: CampaignContactRow) => {
    if (!campaignId) return;
    if (
      !(await confirm({
        title: `¿Eliminar ${row.phone} (${row.customerName || "sin nombre"})?`,
        destructive: true,
        confirmLabel: "Eliminar",
      }))
    )
      return;
    try {
      const res = await contactMutations.deleteContacts(campaignId, [row.rowId]);
      if (res.removed > 0) {
        toast.success("Contacto eliminado");
      } else if (res.errors?.length) {
        toast.error(res.errors[0]);
      }
      refresh();
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error eliminando");
    }
  };

  const CONTROL_TOAST: Record<string, string> = {
    start: "Campaña iniciada",
    pause: "Campaña pausada",
    resume: "Campaña reanudada",
    cancel: "Campaña cancelada",
    unschedule: "Programación cancelada — la campaña volvió a borrador",
  };

  const handleControl = async (action: "start" | "pause" | "resume" | "cancel" | "unschedule") => {
    if (!campaignId) return;
    setControlling(true);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.controlCampaign) throw new Error("endpoint not configured");
      const r = await fetch(endpoints.controlCampaign, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || body?.message || `HTTP ${r.status}`);
      // Antes era `Campaña ${action}d` → "Campaña startd", "Campaña cancelrd".
      toast.success(CONTROL_TOAST[action] || "Acción aplicada");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setControlling(false);
    }
  };

  const handleClone = async () => {
    if (!campaignId) return;
    try {
      const res = await mutations.clone(campaignId);
      toast.success(`Clonada como "${res.name}". Abriendo la nueva...`);
      navigate(`/campaigns/${res.campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error clonando");
    }
  };

  // ── Control admin en vivo ────────────────────────────────────────────────
  // Freno de emergencia: cuelga TODAS las llamadas vivas (dialing/connected)
  // de la campaña vía StopContact masivo. No cambia el status — combínalo con
  // Pausar si además no quieres que salgan nuevas.
  const handleStopAllCalls = async () => {
    if (!campaignId) return;
    const live = (data?.counts.dialing ?? 0) + (data?.counts.connected ?? 0);
    if (
      !(await confirm({
        title: "¿Colgar TODAS las llamadas vivas?",
        description: `Se cortan ${live} llamada(s) de esta campaña (marcando y conectadas). Las no atendidas reintentan según la política de la campaña.`,
        destructive: true,
        confirmLabel: "Colgar todas",
      }))
    )
      return;
    try {
      const r = await mutations.stopAllCalls(campaignId);
      toast.success(
        `Llamadas detenidas: ${r.stopped}/${r.live}` +
          (r.failed ? ` · ${r.failed} ya habían terminado` : ""),
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron detener las llamadas");
    }
  };

  // Colgar UNA llamada viva desde el feed "En vivo ahora".
  const handleHangupLive = async (lc: {
    connectContactId?: string;
    customerName?: string;
    phone: string;
  }) => {
    if (!lc.connectContactId) return;
    if (
      !(await confirm({
        title: `¿Colgar la llamada de ${lc.customerName || lc.phone}?`,
        destructive: true,
        confirmLabel: "Colgar",
      }))
    )
      return;
    try {
      await stopContact(lc.connectContactId);
      toast.success("Llamada colgada");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo colgar");
    }
  };

  const handleRelaunch = async (scope: RelaunchScope = "all") => {
    if (!campaignId) return;
    const label =
      scope === "all" ? "TODOS los contactos (se reenvían)" : "solo los failed / no-answer";
    if (
      !(await confirm({
        title: "¿Relanzar la campaña?",
        description: `Se relanzará ${label}.`,
        destructive: true,
        confirmLabel: "Relanzar",
      }))
    )
      return;
    try {
      const res = await mutations.relaunch(campaignId, scope);
      toast.success(`Campaña relanzada · ${res.rowsReset} contactos reseteados a pending`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error relanzando");
    }
  };

  if (loading && !data) {
    // Bug #24 — replace the plain "Cargando campaña…" text with a
    // structured skeleton so the user gets an immediate visual hint
    // that the detail view is mounting (vs. the lingering list view).
    return (
      <div className="page" style={{ maxWidth: 1320 }}>
        <div className="row gap10" style={{ marginBottom: 16 }}>
          <div className="skel skel--text" style={{ width: 240, height: 26 }} />
          <div className="skel skel--text" style={{ width: 90, height: 22, borderRadius: 999 }} />
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card skel" style={{ minHeight: 116 }} />
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card skel" style={{ minHeight: 220 }} />
          <div className="card skel" style={{ minHeight: 220 }} />
        </div>
        <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Cargando campaña…
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="page" style={{ maxWidth: 1320 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: "var(--red-soft)",
            color: "var(--red-2)",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const c = data.campaign;
  const counts = data.counts;
  const total = c.totalContacts || 0;
  const completed = counts.done + counts.failed + counts.no_answer;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // ── Ventana de llamadas: avisar si está fuera de horario (causa #1 de "parece colgada") ──
  const isWa = String(c.campaignType || "voice").toLowerCase() === "whatsapp";
  // Campaña POR AGENTES (progressive/manual) vs POOL (agentless). Lo define el
  // dialMode, NO el nº de agentes: una campaña por agentes sigue siéndolo aunque
  // todavía no tenga agentes asignados. Solo las agentless (modelo pool, hoy fuera
  // del UI) muestran los controles de peso/pool. `agentCount` alimenta el mensaje
  // del Ritmo (manual / N agentes / sin agentes aún).
  const agentCount = assignedAgents.length;
  const bucketMode = String(c.dialMode || "").toLowerCase() !== "agentless";
  const win = {
    within: isWithinSchedule(campaignSchedule),
    start: Number(c.windowStartHour ?? 9),
    end: Number(c.windowEndHour ?? 18),
  };
  const nextChange = nextScheduleChange(campaignSchedule);
  const dialingBlocked = c.status === "RUNNING" && counts.pending > 0 && !win.within;
  // Voz en ventana con pendientes pero nada marcando ⇒ probablemente sin agente disponible.
  const waitingAgent =
    c.status === "RUNNING" && !isWa && win.within && counts.pending > 0 && counts.dialing === 0;

  const dialNow = async () => {
    const ep = getApiEndpoints();
    if (!ep?.updateCampaign) {
      toast.error("Endpoint no configurado");
      return;
    }
    try {
      await fetch(ep.updateCampaign, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          windowStartHour: 0,
          windowEndHour: 24,
          windowDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        }),
      });
      toast.success(
        isWa ? "Ventana 24h activada — enviará ahora" : "Ventana 24h activada — discará ahora",
      );
      refresh();
    } catch {
      toast.error("No se pudo activar la ventana 24h");
    }
  };

  const toggleRowSelected = (rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleAllSelected = () => {
    setSelectedRowIds((prev) => {
      const eligible = visibleContacts.filter(
        (r) => r.status !== "dialing" && r.status !== "connected",
      );
      const allSelected = eligible.every((r) => prev.has(r.rowId));
      const next = new Set(prev);
      if (allSelected) {
        for (const r of eligible) next.delete(r.rowId);
      } else {
        for (const r of eligible) next.add(r.rowId);
      }
      return next;
    });
  };

  // Click en un tile/chip de estado → filtra la tabla Y salta a la vista
  // Contactos para ver el resultado. Toggle: volver a clickear el mismo estado
  // limpia el filtro (y se queda en Contactos, donde el chip ✕ también lo limpia).
  const applyFilterAndView = (status: string | null) => {
    setFilterStatus((prev) => (prev === status ? null : status));
    if (status) setTab("contacts");
  };

  // Reintento MANUAL de los seleccionados: los devuelve a `pending` con
  // reintento inmediato (relaunch scope:"specific" pone nextRetryAt=now y el
  // backend patea al dialer) → marcan en segundos, sin esperar los 30 min del
  // retry automático. Sirve para no_answer/failed y también para adelantar
  // un pending programado.
  const handleBulkRetry = async () => {
    if (!campaignId || selectedRowIds.size === 0) return;
    const rowIds = Array.from(selectedRowIds).filter((id) => {
      const row = contacts.find((c) => c.rowId === id);
      return row && row.status !== "dialing" && row.status !== "connected";
    });
    if (rowIds.length === 0) return;
    try {
      const res = await mutations.relaunch(campaignId, "specific", rowIds);
      toast.success(
        `${res.rowsReset} contacto${res.rowsReset === 1 ? "" : "s"} en cola — marcando ahora`,
      );
      setSelectedRowIds(new Set());
      refresh();
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error reintentando");
    }
  };

  const handleBulkDelete = async () => {
    if (!campaignId || selectedRowIds.size === 0) return;
    const rowIds = Array.from(selectedRowIds).filter((id) => {
      const row = contacts.find((c) => c.rowId === id);
      return row && row.status !== "dialing" && row.status !== "connected";
    });
    if (rowIds.length === 0) return;
    if (
      !(await confirm({
        title: `¿Eliminar ${rowIds.length} contacto${rowIds.length === 1 ? "" : "s"}?`,
        destructive: true,
        confirmLabel: "Eliminar",
      }))
    ) {
      return;
    }
    try {
      const res = await contactMutations.deleteContacts(campaignId, rowIds);
      if (res.removed > 0) {
        toast.success(`${res.removed} eliminados`);
      }
      if (res.errors?.length) {
        toast.error(`${res.errors.length} con error`);
      }
      setSelectedRowIds(new Set());
      refresh();
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error eliminando");
    }
  };

  // ── CSV export ────────────────────────────────────────────────
  const handleExportCSV = () => {
    const rows = visibleContacts;
    if (rows.length === 0) {
      toast.info("Nada que exportar.");
      return;
    }
    const headers = [
      "phone",
      "customerName",
      "status",
      "attempts",
      "assignedTo",
      "handledBy",
      "lastAttemptAt",
      "disconnectReason",
      "connectContactId",
    ];
    const escape = (v: string | number | undefined | null): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.phone,
          r.customerName,
          r.status,
          r.attempts,
          resolveAgentLabel(r.assignedAgentUserId),
          resolveAgentLabel(r.agentUsername),
          r.lastAttemptAt,
          r.disconnectReason,
          r.connectContactId,
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${c.name.replace(/[^a-z0-9]/gi, "_")}-contactos-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado ${rows.length} filas`);
  };

  // ── Recording URL builder ─────────────────────────────────────
  const recordingEndpoint = getApiEndpoints()?.getRecording;
  // Abre la grabación: fetchea get-recording CON JWT (authedFetch) → obtiene el
  // presigned URL del tenant → lo abre. Antes era un <a href> directo que NO
  // mandaba JWT (el backend caía a Novasys) y encima abría el JSON, no el audio.
  const openRecording = async (contactId: string | undefined) => {
    if (!contactId || !recordingEndpoint) return;
    try {
      const r = await authedFetch(
        `${recordingEndpoint}?contactId=${encodeURIComponent(contactId)}`,
      );
      const j = await r.json().catch(() => ({}));
      if (j?.recordingUrl) window.open(j.recordingUrl, "_blank", "noopener");
      else toast.error("Grabación no disponible para este contacto");
    } catch {
      toast.error("No se pudo abrir la grabación");
    }
  };

  // ── Disposition (post-call outcome the agent annotates) ──────
  const DISPOSITION_OPTIONS = [
    { value: "", label: "—", chip: "" },
    { value: "interesado", label: "Interesado", chip: "chip chip--green" },
    { value: "callback", label: "Pedir callback", chip: "chip chip--cyan" },
    { value: "no_interesado", label: "No interesado", chip: "chip chip--red" },
    { value: "vendido", label: "Vendido", chip: "chip chip--violet" },
    { value: "buzon", label: "Buzón / VM", chip: "chip chip--amber" },
    { value: "no_calificado", label: "No califica", chip: "chip chip--amber" },
    { value: "otro", label: "Otro", chip: "chip" },
  ];

  const handleSetDisposition = async (row: CampaignContactRow, value: string) => {
    if (!campaignId) return;
    try {
      const next: Record<string, string> = {
        ...(row.customAttributes || {}),
      };
      if (value) {
        next.disposition = value;
      } else {
        delete next.disposition;
      }
      await contactMutations.updateContact(campaignId, row.rowId, {
        attributes: next,
      });
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando");
    }
  };

  const statusCards: Array<{
    key: keyof typeof counts;
    label: string;
    Icn: React.ElementType;
    color: string;
  }> = isWa
    ? [
        // WhatsApp: sin agentes ni "conectado/sin contestar" — sólo el ciclo de envío.
        { key: "pending", label: "Pendientes", Icn: Icon.Clock, color: "var(--text-3)" },
        { key: "dialing", label: "Enviando", Icn: Icon.WhatsApp, color: "var(--cyan)" },
        { key: "done", label: "Enviados", Icn: Icon.Check, color: "var(--green)" },
        { key: "failed", label: "Fallidos", Icn: Icon.Close, color: "var(--red)" },
      ]
    : [
        { key: "pending", label: "Pendientes", Icn: Icon.Clock, color: "var(--text-3)" },
        { key: "dialing", label: "Marcando", Icn: Icon.Phone, color: "var(--cyan)" },
        { key: "connected", label: "Conectados", Icn: Icon.PhoneIn, color: "var(--green)" },
        { key: "done", label: "Completados", Icn: Icon.Check, color: "var(--green)" },
        { key: "no_answer", label: "Sin contestar", Icn: Icon.Phone, color: "var(--gold)" },
        { key: "failed", label: "Fallidos", Icn: Icon.Close, color: "var(--red)" },
        // Pilar 3 (supresión): contactos gateados por DNC / no-tras-conversión /
        // opt-out SF. El backend ya devuelve `counts.suppressed`.
        { key: "suppressed", label: "Suprimidos", Icn: Icon.ShieldCheck, color: "var(--text-3)" },
      ];

  return (
    <div className="page cdet-stack" style={{ maxWidth: 1320 }}>
      {/* ── Hero premium: identidad + progreso en un solo panel ──────────
           Combina el antiguo header liviano y el banner de progreso. Las
           acciones (editar/clonar/iniciar/pausar/…) las sube HeroBand al
           topbar; aquí sólo vive la presentación. El acento (--_c) sigue el
           canal: voz = --accent, WhatsApp = --green. */}
      <div
        className="cdet-hero"
        style={{ ["--_c" as string]: isWa ? "var(--green)" : "var(--accent)" }}
      >
        <div className="cdet-hero__id">
          <Btn
            variant="ghost"
            size="sm"
            icon="chevL"
            onClick={() => navigate("/campaigns")}
            title="Volver a campañas"
          />
          <h1 className="cdet-hero__name">{c.name}</h1>
          <Pill tone={CAMPAIGN_STATUS_TONE[c.status] || "outline"} icon="dot">
            {CAMPAIGN_STATUS_LABEL[c.status] || c.status}
          </Pill>
          <span className="cdet-hero__meta">
            <span className="cdet-meta-chip mono">{c.sourcePhoneNumber}</span>
            <span className="cdet-meta-chip">
              {isWa ? (
                <>
                  <Icon.WhatsApp size={11} /> WhatsApp
                </>
              ) : (
                c.dialMode
              )}
            </span>
            {c.createdAt && (
              <span className="cdet-meta-chip">
                creada {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true, locale: es })}
              </span>
            )}
          </span>
        </div>

        {c.description && <div className="cdet-hero__desc">{c.description}</div>}

        <div className="cdet-hero__prog">
          <div>
            <div className="cdet-hero__big">
              <Num value={completed} /> <span>/ {total}</span>
            </div>
            <div className="cdet-hero__cap">Contactos procesados · {pct}%</div>
          </div>
          <div className="cdet-hero__chips">
            {/* Dedup: el desglose por estado vive UNA sola vez en los tiles de la
                vista "En vivo". El hero solo conserva el pulso de actividad viva
                (contexto que se ve desde cualquier tab) y la hora de inicio. */}
            {counts.dialing + counts.connected > 0 && (
              <span className="chip chip--green">
                <span className="dot pulse" />
                {counts.dialing + counts.connected} {isWa ? "enviando" : "en vivo"}
              </span>
            )}
            {c.startedAt && (
              <div className="muted mono" style={{ fontSize: 11 }}>
                Iniciada {format(new Date(c.startedAt), "HH:mm")}
              </div>
            )}
          </div>
        </div>

        <div className="cdet-hero__track">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {/* HeroBand solo empuja las ACCIONES al topbar global (renderiza null). Los
          antiguos props title/chip los ignoraba el componente → eran ~55 líneas de
          código muerto (nombre/estado/plantilla ya viven en el hero de arriba). */}
      <HeroBand
        right={
          !canManage ? null : (
            <div className="row gap8" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              {/* Edit — only while still editable */}
              {(c.status === "DRAFT" || c.status === "RUNNING" || c.status === "PAUSED") && (
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="settings"
                  onClick={() => setEditOpen(true)}
                  disabled={controlling}
                >
                  Editar
                </Btn>
              )}

              {/* Clone — always available */}
              <Btn
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={handleClone}
                disabled={mutations.pending}
              >
                Clonar
              </Btn>

              {/* Relaunch — only for terminal states */}
              {(c.status === "COMPLETED" || c.status === "CANCELLED") && (
                <>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="refresh"
                    onClick={() => handleRelaunch("failed")}
                    disabled={mutations.pending}
                  >
                    Relanzar fallidos
                  </Btn>
                  <Btn
                    variant="primary"
                    size="sm"
                    icon="refresh"
                    onClick={() => handleRelaunch("all")}
                    disabled={mutations.pending}
                  >
                    Relanzar todos
                  </Btn>
                </>
              )}

              {/* DRAFT → Start */}
              {c.status === "DRAFT" && (
                <Btn
                  variant="primary"
                  size="sm"
                  icon="play"
                  onClick={() => handleControl("start")}
                  disabled={controlling}
                >
                  Iniciar
                </Btn>
              )}
              {/* SCHEDULED → volver a borrador (el "Iniciar ahora" vive en el
                  banner de programación, junto a la fecha). */}
              {c.status === "SCHEDULED" && (
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => handleControl("unschedule")}
                  disabled={controlling}
                >
                  Cancelar programación
                </Btn>
              )}
              {c.status === "RUNNING" && (
                <>
                  {/* Freno de emergencia: cuelga TODAS las llamadas vivas.
                      Solo voz y solo si hay algo vivo que colgar. */}
                  {!isWa && (data.counts.dialing ?? 0) + (data.counts.connected ?? 0) > 0 && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="missed"
                      onClick={handleStopAllCalls}
                      disabled={mutations.pending}
                      style={{
                        color: "var(--red)",
                        borderColor: "color-mix(in srgb,var(--red) 40%,var(--border-1))",
                      }}
                    >
                      Colgar todas
                    </Btn>
                  )}
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="pause"
                    onClick={() => handleControl("pause")}
                    disabled={controlling}
                  >
                    Pausar
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="x"
                    onClick={() => handleControl("cancel")}
                    disabled={controlling}
                    style={{
                      color: "var(--red)",
                      borderColor: "color-mix(in srgb,var(--red) 40%,var(--border-1))",
                    }}
                  >
                    Cancelar
                  </Btn>
                </>
              )}
              {c.status === "PAUSED" && (
                <>
                  {!isWa && (data.counts.dialing ?? 0) + (data.counts.connected ?? 0) > 0 && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="missed"
                      onClick={handleStopAllCalls}
                      disabled={mutations.pending}
                      style={{
                        color: "var(--red)",
                        borderColor: "color-mix(in srgb,var(--red) 40%,var(--border-1))",
                      }}
                    >
                      Colgar todas
                    </Btn>
                  )}
                  <Btn
                    variant="primary"
                    size="sm"
                    icon="play"
                    onClick={() => handleControl("resume")}
                    disabled={controlling}
                  >
                    Reanudar
                  </Btn>
                </>
              )}
            </div>
          )
        }
      />

      {/* ── Campaña programada: todavía no arrancó, arranca sola ── */}
      {c.status === "SCHEDULED" && c.scheduledStartAt && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderRadius: 14,
            border: "1px solid color-mix(in srgb, var(--accent-cyan) 40%, transparent)",
            background: "var(--accent-cyan-soft)",
          }}
        >
          <Icon.Clock size={18} style={{ color: "var(--accent-cyan)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              Programada para {formatInZone(c.scheduledStartAt, c.timezone)}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {counts.pending} contacto{counts.pending === 1 ? "" : "s"} en espera. Arranca sola{" "}
              {formatRelative(new Date(c.scheduledStartAt))} y empieza a marcar dentro del horario
              de atención.
            </div>
          </div>
          <Btn
            variant="primary"
            size="sm"
            icon="play"
            onClick={() => handleControl("start")}
            disabled={controlling}
          >
            Iniciar ahora
          </Btn>
        </div>
      )}

      {/* ── Aviso de ventana fuera de horario (no está "colgada", solo esperando) ── */}
      {dialingBlocked && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderRadius: 14,
            border: "1px solid color-mix(in srgb, var(--gold) 40%, transparent)",
            background: "var(--gold-soft)",
          }}
        >
          <Icon.Clock size={18} style={{ color: "var(--gold-2)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              Fuera de la ventana de {isWa ? "envío" : "llamadas"} (
              {String(win.start).padStart(2, "0")}:00–{String(win.end).padStart(2, "0")}:00)
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              La campaña está activa con {counts.pending} pendiente{counts.pending === 1 ? "" : "s"}
              . {isWa ? "Se enviarán" : "Se discarán"} automáticamente
              {nextChange?.opens ? ` ${formatRelative(nextChange.at)}` : " al volver al horario"}, o
              puedes forzar ahora.
            </div>
          </div>
          <Btn variant="primary" size="sm" icon="play" onClick={dialNow} disabled={controlling}>
            {isWa ? "Enviar ahora (24h)" : "Discar ahora (24h)"}
          </Btn>
        </div>
      )}

      {/* ── Aviso voz: en ventana, con pendientes, pero sin nadie marcando (sin agente) ── */}
      {waitingAgent && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid color-mix(in srgb, var(--cyan) 30%, transparent)",
            background: "var(--cyan-soft)",
          }}
        >
          <Icon.PhoneIn size={16} style={{ color: "var(--cyan-2)", flexShrink: 0 }} />
          <div className="muted" style={{ fontSize: 12 }}>
            En horario y con {counts.pending} pendiente{counts.pending === 1 ? "" : "s"}, pero
            todavía no hay llamadas en curso. En modo progresivo el discador espera a que haya un
            agente disponible; el siguiente ciclo marcará apenas se libere uno.
          </div>
        </div>
      )}

      {/* ── Barra de vistas: 3 tabs para no apilar ~12 bloques en una columna ─ */}
      <div className="tabs" role="tablist" aria-label="Vistas de la campaña">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          className={`tabs__tab${tab === "live" ? " tabs__tab--active" : ""}`}
          onClick={() => setTab("live")}
        >
          En vivo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "contacts"}
          className={`tabs__tab${tab === "contacts" ? " tabs__tab--active" : ""}`}
          onClick={() => setTab("contacts")}
        >
          Contactos <span className="count">{total}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "config"}
          className={`tabs__tab${tab === "config" ? " tabs__tab--active" : ""}`}
          onClick={() => setTab("config")}
        >
          Configuración
        </button>
      </div>

      {/* ══════ VISTA: EN VIVO ══════
           desglose de estados (tiles = fuente canónica + filtro) → métricas →
           monitoreo por cola/agente → feed de actividad + leaderboard. */}
      {tab === "live" && (
        <>
          {/* Tiles: el ÚNICO lugar con el desglose por estado. Cada uno filtra la
              tabla y salta a la vista Contactos. --tile-count = nº de tiles → una
              sola fila; los buckets en 0 se atenúan para que los con datos salten. */}
          <div className="cdet-tiles" style={{ ["--tile-count" as string]: statusCards.length }}>
            {statusCards.map((s) => {
              const active = filterStatus === s.key;
              const val = counts[s.key] ?? 0;
              const Icn = s.Icn;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`cdet-tile${active ? " cdet-tile--active" : ""}${
                    val === 0 ? " cdet-tile--zero" : ""
                  }`}
                  onClick={() => applyFilterAndView(s.key)}
                  style={{ ["--_c" as string]: s.color }}
                  title={`Ver contactos: ${s.label.toLowerCase()}`}
                >
                  <div className="cdet-tile__head">
                    <span className="cdet-tile__ico">
                      <Icn size={14} />
                    </span>
                    <span className="cdet-tile__label">{s.label}</span>
                  </div>
                  <div className="cdet-tile__val">{val}</div>
                </button>
              );
            })}
          </div>

          {/* Charts (donut + sparkline + gauge). Bug #25: el reloj se congela en
              campañas terminadas vía endedAt/completedAt + isFinished. */}
          <CampaignCharts
            counts={counts}
            total={total}
            startedAt={c.startedAt}
            endedAt={
              (c as unknown as { completedAt?: string; endedAt?: string }).completedAt ||
              (c as unknown as { completedAt?: string; endedAt?: string }).endedAt ||
              null
            }
            isFinished={c.status === "COMPLETED" || c.status === "CANCELLED"}
            isWhatsApp={isWa}
          />

          <CampaignMonitoringPanel byQueue={data.byQueue} byAgent={data.byAgent} />

          <CampaignActivity
            liveContacts={data.liveContacts}
            contacts={contacts}
            resolveAgentLabel={resolveAgentLabel}
            isWhatsApp={isWa}
            // Colgar una llamada puntual desde "En vivo ahora" (solo admins de
            // campañas; el backend re-valida el rol vía JWT).
            onHangup={canManage && !isWa ? handleHangupLive : undefined}
          />
        </>
      )}

      {/* ══════ VISTA: CONFIGURACIÓN ══════
           voz: pacing + orquestación (Pilar 7) + agentes asignados.
           WhatsApp: vista previa de la plantilla que se envía. */}
      {tab === "config" && (
        <>
          {isWa ? (
            <WhatsAppTemplateSummary
              templateName={(c as unknown as { templateName?: string }).templateName}
              templateLanguage={(c as unknown as { templateLanguage?: string }).templateLanguage}
              templateVarColumns={
                (c as unknown as { templateVarColumns?: string }).templateVarColumns
              }
            />
          ) : (
            <>
              <Card>
                <CardBody>
                  <div className="row between" style={{ marginBottom: 10, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>Horario de atención</div>
                    <span className="muted" style={{ fontSize: 11 }}>
                      Fuera de estas franjas no se marca
                    </span>
                  </div>
                  <BusinessHoursPreview
                    schedule={campaignSchedule}
                    scheduledStartAt={c.scheduledStartAt}
                    compact
                  />
                </CardBody>
              </Card>
              <PacingControlCard dialMode={c.dialMode} agentCount={agentCount} />
              <CampaignOrchestrationCard
                campaignId={c.campaignId}
                priority={Number((c as unknown as { priority?: number }).priority) || undefined}
                weight={Number((c as unknown as { weight?: number }).weight) || undefined}
                goalType={(c as unknown as { goalType?: string }).goalType}
                goalTarget={
                  Number((c as unknown as { goalTarget?: number }).goalTarget) || undefined
                }
                connectedCount={
                  Number((c as unknown as { connectedCount?: number }).connectedCount) || 0
                }
                conversionsCount={
                  Number((c as unknown as { conversionsCount?: number }).conversionsCount) || 0
                }
                bucketMode={bucketMode}
                onUpdated={() => refresh()}
                disabled={c.status === "COMPLETED" || c.status === "CANCELLED" || mutations.pending}
              />
              <AssignedAgentsPanel
                campaign={c}
                // Bug #28: nº de agentes distintos que atendieron algún contacto →
                // el panel distingue "sin asignados" de "asignados pero nadie atendió".
                participatingAgentsCount={
                  new Set(
                    contacts
                      .map((r) => resolveAgentLabel(r.agentUsername))
                      .filter((n) => n && n !== "—"),
                  ).size
                }
              />
            </>
          )}
        </>
      )}

      <EditCampaignDialog
        campaign={c}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => refresh()}
      />
      <AddContactsDialog
        campaignId={campaignId || null}
        open={addContactsOpen}
        onClose={() => setAddContactsOpen(false)}
        onAdded={() => {
          refresh();
          refreshContacts();
        }}
      />
      <EditContactDialog
        campaignId={campaignId || ""}
        contact={editingContact}
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
        onSaved={() => {
          refresh();
          refreshContacts();
        }}
      />

      {/* ══════ VISTA: CONTACTOS ══════ tabla con buscador, filtros, export y masivas */}
      {tab === "contacts" && (
        <Card>
          <div className="card__head" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="card__title">
              <Icon.Users size={17} /> Contactos
            </div>
            {filterStatus && (
              <span className="chip chip--amber" style={{ fontSize: 10.5 }}>
                filtro: {STATUS_LABEL_ES[filterStatus] || filterStatus}
                <button
                  onClick={() => setFilterStatus(null)}
                  style={{
                    marginLeft: 6,
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              </span>
            )}
            <div
              className="tb__search"
              style={{
                maxWidth: 240,
                height: 28,
                marginLeft: "auto",
              }}
            >
              <Icon.Search size={12} />
              <input
                placeholder="Buscar contacto…"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
              />
            </div>
            <span className="card__sub">
              {visibleContacts.length}/{contacts.length}
            </span>
            <Btn
              variant="ghost"
              size="sm"
              icon="download"
              onClick={handleExportCSV}
              disabled={visibleContacts.length === 0}
              title="Exportar contactos como CSV"
            >
              CSV
            </Btn>
            {c.status !== "COMPLETED" && c.status !== "CANCELLED" && (
              <Btn variant="ghost" size="sm" icon="plus" onClick={() => setAddContactsOpen(true)}>
                Agregar
              </Btn>
            )}
          </div>

          {/* Bulk action toolbar — shown when at least 1 row selected. */}
          {selectedRowIds.size > 0 && (
            <div
              className="row"
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--border-1)",
                background: "var(--gold-soft)",
                gap: 10,
                fontSize: 12,
              }}
            >
              <Icon.Check size={13} style={{ color: "var(--gold-2)" }} />
              <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
                {selectedRowIds.size} seleccionado
                {selectedRowIds.size === 1 ? "" : "s"}
              </span>
              {lockedRowCount > 0 && (
                <span className="muted" style={{ fontSize: 11 }}>
                  ({lockedRowCount} bloqueado{lockedRowCount === 1 ? "" : "s"} por estar en llamada
                  activa)
                </span>
              )}
              <Btn
                variant="ghost"
                size="sm"
                style={{
                  marginLeft: "auto",
                  color: "var(--green-2)",
                  borderColor: "color-mix(in srgb,var(--green) 40%,var(--border-1))",
                }}
                onClick={handleBulkRetry}
                disabled={!canManage || mutations.pending || lockedRowCount === selectedRowIds.size}
                title="Vuelve los seleccionados a la cola y marca ahora (sin esperar el reintento automático)"
              >
                <Icon.Phone size={13} />
                Reintentar ahora {selectedRowIds.size - lockedRowCount}
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                style={{
                  color: "var(--red)",
                  borderColor: "color-mix(in srgb,var(--red) 40%,var(--border-1))",
                }}
                onClick={handleBulkDelete}
                disabled={contactMutations.pending || lockedRowCount === selectedRowIds.size}
              >
                <Icon.Trash size={13} />
                Eliminar {selectedRowIds.size - lockedRowCount}
              </Btn>
              <Btn variant="quiet" size="sm" onClick={() => setSelectedRowIds(new Set())}>
                Limpiar
              </Btn>
            </div>
          )}
          <CardBody flush>
            <div style={{ maxHeight: 500, overflow: "auto" }}>
              <table
                style={{
                  width: "100%",
                  fontSize: 12.5,
                  borderCollapse: "collapse",
                }}
              >
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "var(--bg-2)",
                    zIndex: 1,
                  }}
                >
                  <tr>
                    {/* Master checkbox */}
                    <th
                      style={{
                        padding: "8px 6px",
                        width: 32,
                        borderBottom: "1px solid var(--border-1)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          visibleContacts.length > 0 &&
                          visibleContacts
                            .filter((r) => r.status !== "dialing" && r.status !== "connected")
                            .every((r) => selectedRowIds.has(r.rowId))
                        }
                        onChange={toggleAllSelected}
                        title="Seleccionar todos los eligibles"
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                    {[
                      "Teléfono",
                      "Nombre",
                      "Estado",
                      "Disposición",
                      "Intentos",
                      "Asignado a",
                      "Atendido por",
                      "Último intento",
                      "Grabación",
                      "",
                    ].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: "8px 10px",
                          textAlign: i === 9 ? "right" : "left",
                          fontSize: 10.5,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--text-3)",
                          borderBottom: "1px solid var(--border-1)",
                          fontWeight: 500,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleContacts.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        style={{
                          padding: 32,
                          textAlign: "center",
                          color: "var(--text-3)",
                          fontSize: 12.5,
                        }}
                      >
                        {contactSearch
                          ? `Ningún contacto coincide con "${contactSearch}".`
                          : "Sin contactos para este filtro."}
                      </td>
                    </tr>
                  )}
                  {visibleContacts.map((row) => {
                    const locked = row.status === "dialing" || row.status === "connected";
                    const assignedLabel = resolveAgentLabel(row.assignedAgentUserId);
                    const handlerLabel = resolveAgentLabel(row.agentUsername);
                    const isSelected = selectedRowIds.has(row.rowId);
                    const recUrl = !!(row.connectContactId && recordingEndpoint);
                    return (
                      <tr
                        key={row.rowId}
                        style={{
                          borderTop: "1px solid var(--border-1)",
                          background: isSelected ? "var(--gold-soft)" : undefined,
                          transition: "background 0.12s ease",
                        }}
                      >
                        <td style={{ padding: "8px 6px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelected(row.rowId)}
                            disabled={locked}
                            title={locked ? "Llamada activa — no seleccionable" : "Seleccionar"}
                            style={{ cursor: locked ? "not-allowed" : "pointer" }}
                          />
                        </td>
                        <td className="mono" style={{ padding: "8px 10px", fontSize: 11.5 }}>
                          {row.phone}
                        </td>
                        <td style={{ padding: "8px 10px", color: "var(--text-1)" }}>
                          {row.customerName ? (
                            row.customerName
                          ) : namesByPhone[row.phone] ? (
                            <span
                              title="Resuelto desde Customer Profiles"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              {namesByPhone[row.phone]}
                              <span
                                className="muted"
                                style={{
                                  fontSize: 9,
                                  opacity: 0.6,
                                }}
                              >
                                ◆
                              </span>
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span
                            className={STATUS_CHIP[row.status] || "chip"}
                            style={{ fontSize: 10.5 }}
                          >
                            {STATUS_LABEL_ES[row.status] || row.status}
                          </span>
                          {/* Reintento automático programado (no_answer → pending con
                            nextRetryAt futuro): sin esto el admin ve "pending" con
                            intentos ≥1 y no sabe por qué no marca todavía. */}
                          {row.status === "pending" &&
                            row.nextRetryAt &&
                            Date.parse(row.nextRetryAt) > Date.now() && (
                              <span
                                className="muted"
                                style={{ display: "block", fontSize: 10, marginTop: 2 }}
                                title={`Reintento automático programado: ${new Date(row.nextRetryAt).toLocaleString("es-PE")}`}
                              >
                                ↻ reintenta{" "}
                                {new Date(row.nextRetryAt).toLocaleTimeString("es-PE", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <DispositionSelect
                            value={row.customAttributes?.disposition || ""}
                            options={DISPOSITION_OPTIONS}
                            // Only allow setting disposition once the call
                            // has finished — pending / dialing / connected
                            // don't have an outcome yet.
                            disabled={
                              row.status === "pending" ||
                              row.status === "dialing" ||
                              row.status === "connected" ||
                              contactMutations.pending
                            }
                            onChange={(v) => handleSetDisposition(row, v)}
                          />
                        </td>
                        <td className="mono" style={{ padding: "8px 10px", fontSize: 11.5 }}>
                          {row.attempts}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {assignedLabel === "—" ? (
                            <span className="muted" style={{ fontSize: 11.5 }}>
                              —
                            </span>
                          ) : (
                            <span className="chip chip--amber" style={{ fontSize: 10 }}>
                              {assignedLabel}
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 11.5,
                            color: "var(--text-2)",
                          }}
                        >
                          {handlerLabel === "—" ? <span className="muted">—</span> : handlerLabel}
                        </td>
                        <td className="muted" style={{ padding: "8px 10px", fontSize: 11 }}>
                          {row.lastAttemptAt
                            ? formatDistanceToNow(new Date(row.lastAttemptAt), {
                                addSuffix: true,
                                locale: es,
                              })
                            : "—"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {recUrl ? (
                            <button
                              type="button"
                              onClick={() => openRecording(row.connectContactId)}
                              className="chip chip--cyan"
                              style={{
                                fontSize: 10.5,
                                textDecoration: "none",
                                border: "none",
                                cursor: "pointer",
                              }}
                              title={`Escuchar (contactId ${row.connectContactId?.slice(-8)})`}
                            >
                              <Icon.Headset size={10} />
                              Escuchar
                            </button>
                          ) : (
                            <span className="muted" style={{ fontSize: 11 }}>
                              —
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <button
                              className="btn btn--ghost btn--sm btn--icon"
                              onClick={() => setEditingContact(row)}
                              disabled={locked}
                              title={locked ? "No se puede editar llamada activa" : "Editar"}
                            >
                              <Icon.Pencil size={12} />
                            </button>
                            <button
                              className="btn btn--ghost btn--sm btn--icon"
                              onClick={() => handleDeleteContact(row)}
                              disabled={locked || contactMutations.pending}
                              title={locked ? "No se puede eliminar llamada activa" : "Eliminar"}
                              style={{
                                color: locked ? undefined : "var(--red)",
                              }}
                            >
                              <Icon.Trash size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
      {confirmDialog}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DispositionSelect                                                           */
/* -------------------------------------------------------------------------- */

interface DispositionOption {
  value: string;
  label: string;
  chip: string;
}

function DispositionSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: DispositionOption[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // Render as a native <select> wrapped to look like a chip. We
  // intentionally use the native control for accessibility +
  // keyboard nav — building a custom dropdown is overkill for an
  // 8-item enum.
  const current = options.find((o) => o.value === value) || options[0];
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span
        className={current.chip || "chip"}
        style={{
          fontSize: 10.5,
          opacity: disabled ? 0.4 : 1,
          pointerEvents: "none",
          paddingRight: 20,
        }}
      >
        {current.label}
      </span>
      <span
        style={{
          position: "absolute",
          right: 6,
          color: "var(--text-3)",
          fontSize: 9,
          pointerEvents: "none",
        }}
      >
        ▾
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
