import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCampaignStats } from "@/hooks/useCampaignStats";
import { useCampaignContacts, type CampaignContactRow } from "@/hooks/useCampaignContacts";
import { useCampaignMutations, type RelaunchScope } from "@/hooks/useCampaignMutations";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";
import { useCan } from "@/hooks/usePermissions";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useCustomerNamesByPhone } from "@/hooks/useCustomerNamesByPhone";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { formatDistanceToNow, format } from "date-fns";
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

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  RUNNING: "En curso",
  PAUSED: "Pausada",
  COMPLETED: "Terminada",
  CANCELLED: "Cancelada",
};

// Campaign status → ARIA Pill tone (matches the CampaignsPage list).
const CAMPAIGN_STATUS_TONE: Record<string, "green" | "gold" | "cyan" | "red" | "outline"> = {
  DRAFT: "outline",
  RUNNING: "green",
  PAUSED: "gold",
  COMPLETED: "cyan",
  CANCELLED: "red",
};

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useCampaignStats(campaignId || null, 3000);
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

  const handleControl = async (action: "start" | "pause" | "resume" | "cancel") => {
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
      toast.success(`Campaña ${action}d`);
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
  const win = (() => {
    try {
      const tz = c.timezone || "America/Lima";
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      }).formatToParts(new Date());
      const hour = Number(parts.find((p) => p.type === "hour")?.value || "0") % 24;
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const day =
        dayMap[parts.find((p) => p.type === "weekday")?.value || ""] ?? new Date().getDay();
      const days: number[] = JSON.parse(c.windowDaysOfWeek || "[1,2,3,4,5]");
      const start = Number(c.windowStartHour ?? 9),
        end = Number(c.windowEndHour ?? 18);
      return { within: days.includes(day) && hour >= start && hour < end, start, end };
    } catch {
      return { within: true, start: 9, end: 18 };
    }
  })();
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
      ];

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* Header de detalle (liviano): back + nombre + estado + meta. Las
           acciones (editar/clonar/iniciar/pausar/…) las sube HeroBand al topbar
           — el bloque hero se retiró de todas las secciones. */}
      <div className="row gap10" style={{ marginBottom: 14, flexWrap: "wrap", minWidth: 0 }}>
        <Btn
          variant="ghost"
          size="sm"
          icon="chevL"
          onClick={() => navigate("/campaigns")}
          title="Volver a campañas"
        />
        <h1
          style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.02em", margin: 0, minWidth: 0 }}
        >
          {c.name}
        </h1>
        <Pill tone={CAMPAIGN_STATUS_TONE[c.status] || "outline"} icon="dot">
          {CAMPAIGN_STATUS_LABEL[c.status] || c.status}
        </Pill>
        <span className="dim mono" style={{ fontSize: 12 }}>
          {c.sourcePhoneNumber} · {isWa ? "WhatsApp" : c.dialMode}
          {c.createdAt
            ? ` · creada ${formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}`
            : ""}
        </span>
      </div>
      <HeroBand
        title={
          <span className="row gap10" style={{ flexWrap: "wrap" }}>
            <Btn
              variant="ghost"
              size="sm"
              icon="chevL"
              onClick={() => navigate("/campaigns")}
              title="Volver a campañas"
            />
            <span style={{ minWidth: 0 }}>{c.name}</span>
            <Pill tone={CAMPAIGN_STATUS_TONE[c.status] || "outline"} icon="dot">
              {CAMPAIGN_STATUS_LABEL[c.status] || c.status}
            </Pill>
          </span>
        }
        chip={
          <span className="row gap6 mono" style={{ flexWrap: "wrap" }}>
            <span>{c.sourcePhoneNumber}</span>
            <span>·</span>
            {isWa ? (
              <>
                <span className="row" style={{ gap: 4 }}>
                  <Icon.WhatsApp size={12} /> WhatsApp
                </span>
                {(c as unknown as { templateName?: string }).templateName && (
                  <>
                    <span>·</span>
                    <span>
                      {(c as unknown as { templateName?: string }).templateName}
                      {(c as unknown as { templateLanguage?: string }).templateLanguage
                        ? ` (${(c as unknown as { templateLanguage?: string }).templateLanguage})`
                        : ""}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <span>{c.dialMode}</span>
                <span>·</span>
                <span>concurrencia {c.concurrency}</span>
              </>
            )}
            {c.createdAt && (
              <>
                <span>·</span>
                <span>
                  creada {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                </span>
              </>
            )}
          </span>
        }
        chipIcon={isWa ? "wa" : "megaphone"}
        chipTone={isWa ? "var(--green)" : "var(--accent)"}
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
              {c.status === "RUNNING" && (
                <>
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
                <Btn
                  variant="primary"
                  size="sm"
                  icon="play"
                  onClick={() => handleControl("resume")}
                  disabled={controlling}
                >
                  Reanudar
                </Btn>
              )}
            </div>
          )
        }
      />

      {c.description && (
        <div className="muted" style={{ margin: "-8px 0 16px", fontSize: 13 }}>
          {c.description}
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
              . {isWa ? "Se enviarán" : "Se discarán"} automáticamente al volver al horario, o
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

      {/* ── Progress banner · ARIA accent-bar Card ───────────────── */}
      <Card
        className="card__accent-bar"
        style={{ ["--_c" as string]: isWa ? "var(--green)" : "var(--accent)" }}
      >
        <CardBody>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div
                className="tnum"
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                  color: "var(--text-1)",
                }}
              >
                <Num value={completed} />
                <span style={{ fontSize: 18, color: "var(--text-3)", fontWeight: 400 }}>
                  {" "}
                  / {total}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                Contactos procesados · {pct}%
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div className="row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {/* Pending — show only when there's something pending. */}
                {counts.pending > 0 && (
                  <button
                    className={`chip${filterStatus === "pending" ? " chip--amber" : ""}`}
                    onClick={() => setFilterStatus(filterStatus === "pending" ? null : "pending")}
                    style={{
                      border: "1px solid var(--border-1)",
                      cursor: "pointer",
                      background: filterStatus === "pending" ? "var(--gold-soft)" : "transparent",
                    }}
                    title="Filtrar pendientes"
                  >
                    <Icon.Clock size={11} /> {counts.pending} pendientes
                  </button>
                )}
                {counts.dialing + counts.connected > 0 && (
                  <span className="chip chip--green">
                    <span className="dot pulse" />
                    {counts.dialing + counts.connected} {isWa ? "enviando" : "en vivo"}
                  </span>
                )}
                {/* Finished-state outcome chips. Surface only the
                    non-zero buckets so the user immediately sees the
                    breakdown without the tiles row showing 1 lonely
                    pill. Each chip is clickable to filter the table. */}
                {(c.status === "COMPLETED" || c.status === "CANCELLED") && (
                  <>
                    {counts.done > 0 && (
                      <button
                        className={`chip chip--green`}
                        onClick={() => setFilterStatus(filterStatus === "done" ? null : "done")}
                        style={{
                          cursor: "pointer",
                          outline: filterStatus === "done" ? "2px solid var(--green)" : "none",
                        }}
                        title="Filtrar completados"
                      >
                        <Icon.Check size={11} /> {counts.done} completados
                      </button>
                    )}
                    {counts.no_answer > 0 && (
                      <button
                        className={`chip chip--amber`}
                        onClick={() =>
                          setFilterStatus(filterStatus === "no_answer" ? null : "no_answer")
                        }
                        style={{
                          cursor: "pointer",
                          outline: filterStatus === "no_answer" ? "2px solid var(--gold)" : "none",
                        }}
                        title="Filtrar sin contestar"
                      >
                        <Icon.Phone size={11} /> {counts.no_answer} sin contestar
                      </button>
                    )}
                    {counts.failed > 0 && (
                      <button
                        className={`chip chip--red`}
                        onClick={() => setFilterStatus(filterStatus === "failed" ? null : "failed")}
                        style={{
                          cursor: "pointer",
                          outline: filterStatus === "failed" ? "2px solid var(--red)" : "none",
                        }}
                        title="Filtrar fallidos"
                      >
                        <Icon.Close size={11} /> {counts.failed} fallidos
                      </button>
                    )}
                  </>
                )}
              </div>
              {c.startedAt && (
                <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
                  Iniciada {format(new Date(c.startedAt), "HH:mm")}
                </div>
              )}
            </div>
          </div>
          <div className="bar" style={{ marginTop: 14, height: 10 }}>
            <span
              style={{
                width: `${pct}%`,
                background: isWa ? "var(--green)" : "var(--accent)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </CardBody>
      </Card>

      {/* ── Charts (donut + sparkline + gauge) ───────────────────── */}
      <CampaignCharts
        counts={counts}
        total={total}
        startedAt={c.startedAt}
        // Bug #25: freeze the "en curso" clock for terminated campaigns.
        // We pass the endedAt (preferring the completedAt timestamp if
        // the backend includes one) and `isFinished` so the header label
        // flips to "de duración total".
        endedAt={
          (c as unknown as { completedAt?: string; endedAt?: string }).completedAt ||
          (c as unknown as { completedAt?: string; endedAt?: string }).endedAt ||
          null
        }
        isFinished={c.status === "COMPLETED" || c.status === "CANCELLED"}
        isWhatsApp={isWa}
      />

      {/* ── Pacing controls (live tuning of concurrency) ─────────────
           Solo para voz: WhatsApp no usa concurrencia ni modo de marcado. */}
      {!isWa && (
        <PacingControlCard
          campaignId={c.campaignId}
          concurrency={Number(c.concurrency) || 1}
          dialMode={c.dialMode}
          onUpdated={() => refresh()}
          disabled={c.status === "COMPLETED" || c.status === "CANCELLED" || mutations.pending}
        />
      )}

      {/* ── Orquestación (Pilar 7): prioridad · peso · meta · pool ─── */}
      {!isWa && (
        <CampaignOrchestrationCard
          campaignId={c.campaignId}
          priority={Number((c as unknown as { priority?: number }).priority) || undefined}
          weight={Number((c as unknown as { weight?: number }).weight) || undefined}
          goalType={(c as unknown as { goalType?: string }).goalType}
          goalTarget={Number((c as unknown as { goalTarget?: number }).goalTarget) || undefined}
          connectedCount={Number((c as unknown as { connectedCount?: number }).connectedCount) || 0}
          conversionsCount={
            Number((c as unknown as { conversionsCount?: number }).conversionsCount) || 0
          }
          onUpdated={() => refresh()}
          disabled={c.status === "COMPLETED" || c.status === "CANCELLED" || mutations.pending}
        />
      )}

      {/* ── WhatsApp: vista previa del mensaje real que se envía ───── */}
      {isWa && (
        <WhatsAppTemplateSummary
          templateName={(c as unknown as { templateName?: string }).templateName}
          templateLanguage={(c as unknown as { templateLanguage?: string }).templateLanguage}
          templateVarColumns={(c as unknown as { templateVarColumns?: string }).templateVarColumns}
        />
      )}

      {/* ── Status tiles (clickable filters) ─────────────────────── */}
      {/*
        For RUNNING / PAUSED / DRAFT campaigns we always render all 6
        tiles so the manager can watch them tick. For COMPLETED /
        CANCELLED we hide the row entirely — those outcomes are now
        surfaced as compact clickable chips inside the progress
        banner header, which avoids the "orphan tile" look that came
        from only 1 bucket having a non-zero value.
      */}
      {c.status !== "COMPLETED" && c.status !== "CANCELLED" && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {statusCards.map((s) => {
            const active = filterStatus === s.key;
            const Icn = s.Icn;
            return (
              <button
                key={s.key}
                className="stat"
                onClick={() => setFilterStatus(active ? null : s.key)}
                style={{
                  ["--_c" as string]: s.color,
                  cursor: "pointer",
                  textAlign: "left",
                  flex: "1 1 160px",
                  maxWidth: 240,
                  minWidth: 160,
                  borderColor: active ? s.color : undefined,
                  boxShadow: active
                    ? `0 0 0 3px color-mix(in srgb, ${s.color} 16%, transparent) inset`
                    : undefined,
                }}
                title={`Filtrar por ${s.label.toLowerCase()}`}
              >
                <div className="stat__top">
                  <div className="stat__ico">
                    <Icn size={15} />
                  </div>
                  <div className="stat__label">{s.label}</div>
                </div>
                <div className="stat__val tnum">{counts[s.key]}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Monitoreo en vivo: pools por cola/agente + nombres ──────── */}
      <CampaignMonitoringPanel byQueue={data.byQueue} byAgent={data.byAgent} />

      {/* ── Activity: live feed + agent leaderboard ──────────────── */}
      <CampaignActivity
        liveContacts={data.liveContacts}
        contacts={contacts}
        resolveAgentLabel={resolveAgentLabel}
        isWhatsApp={isWa}
      />

      {/* Assigned agents — routing profile auto-configured.
           WhatsApp no usa agentes (es envío de templates), así que se omite. */}
      {!isWa && (
        <AssignedAgentsPanel
          campaign={c}
          // Bug #28: pass the number of distinct agents who answered any
          // contact so the panel can disambiguate "no assignees" vs
          // "no assignees AND nobody answered yet".
          participatingAgentsCount={
            new Set(
              contacts.map((r) => resolveAgentLabel(r.agentUsername)).filter((n) => n && n !== "—"),
            ).size
          }
        />
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

      {/* ── Contacts table ───────────────────────────────────────── */}
      <Card>
        <div className="card__head" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="card__title">
            <Icon.Users size={17} /> Contactos
          </div>
          {filterStatus && (
            <span className="chip chip--amber" style={{ fontSize: 10.5 }}>
              filtro: {filterStatus}
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
                          {row.status}
                        </span>
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
