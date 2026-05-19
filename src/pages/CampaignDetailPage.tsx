import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCampaignStats } from "@/hooks/useCampaignStats";
import { useCampaignContacts, type CampaignContactRow } from "@/hooks/useCampaignContacts";
import { useCampaignMutations, type RelaunchScope } from "@/hooks/useCampaignMutations";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useCustomerNamesByPhone } from "@/hooks/useCustomerNamesByPhone";
import { getApiEndpoints } from "@/lib/api";
import { formatDistanceToNow, format } from "date-fns";
import { EditCampaignDialog } from "@/components/campaigns/EditCampaignDialog";
import { AddContactsDialog } from "@/components/campaigns/AddContactsDialog";
import { EditContactDialog } from "@/components/campaigns/EditContactDialog";
import { AssignedAgentsPanel } from "@/components/campaigns/AssignedAgentsPanel";
import { CampaignCharts } from "@/components/campaigns/CampaignCharts";
import { CampaignActivity } from "@/components/campaigns/CampaignActivity";
import { PacingControlCard } from "@/components/campaigns/PacingControlCard";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

// UUID heuristic — matches the v4 ARN-suffix form Connect emits. Used in
// the contacts table to detect legacy rows where agentUsername was written
// as a user-id instead of an actual username (the bug was fixed in
// process-contact-event but old rows may still have UUIDs).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const CAMPAIGN_STATUS_CHIP: Record<string, string> = {
  DRAFT: "chip",
  RUNNING: "chip chip--green",
  PAUSED: "chip chip--amber",
  COMPLETED: "chip chip--cyan",
  CANCELLED: "chip chip--red",
};

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  RUNNING: "En curso",
  PAUSED: "Pausada",
  COMPLETED: "Terminada",
  CANCELLED: "Cancelada",
};

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useCampaignStats(campaignId || null, 3000);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const { contacts, refresh: refreshContacts } = useCampaignContacts(
    campaignId || null,
    filterStatus,
    5000
  );
  const [controlling, setControlling] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addContactsOpen, setAddContactsOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CampaignContactRow | null>(
    null
  );
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
    return contacts
      .filter((c) => !c.customerName && c.phone)
      .map((c) => c.phone);
  }, [contacts]);
  const namesByPhone = useCustomerNamesByPhone(phonesNeedingName);

  // ── Bulk operations on selected rows ──────────────────────────
  const lockedRowCount = useMemo(
    () =>
      contacts.filter(
        (r) =>
          selectedRowIds.has(r.rowId) &&
          (r.status === "dialing" || r.status === "connected")
      ).length,
    [contacts, selectedRowIds]
  );
  const mutations = useCampaignMutations();
  const contactMutations = useCampaignContactMutations();
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
    if (!confirm(`¿Eliminar ${row.phone} (${row.customerName || "sin nombre"})?`))
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

  const handleControl = async (
    action: "start" | "pause" | "resume" | "cancel"
  ) => {
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
      if (!r.ok)
        throw new Error(body?.error || body?.message || `HTTP ${r.status}`);
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
      scope === "all"
        ? "TODOS los contactos (se reenvían)"
        : "solo los failed / no-answer";
    if (!confirm(`¿Relanzar ${label}?`)) return;
    try {
      const res = await mutations.relaunch(campaignId, scope);
      toast.success(
        `Campaña relanzada · ${res.rowsReset} contactos reseteados a pending`
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error relanzando");
    }
  };

  if (loading && !data) {
    return (
      <div className="view">
        <div
          style={{
            display: "grid",
            placeItems: "center",
            padding: 80,
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          Cargando campaña…
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="view">
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
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
        (r) => r.status !== "dialing" && r.status !== "connected"
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
    if (!confirm(`¿Eliminar ${rowIds.length} contacto${rowIds.length === 1 ? "" : "s"}?`)) {
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
          .join(",")
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
  const recordingUrlFor = (contactId: string | undefined): string | null => {
    if (!contactId || !recordingEndpoint) return null;
    return `${recordingEndpoint}?contactId=${encodeURIComponent(contactId)}`;
  };

  // ── Disposition (post-call outcome the agent annotates) ──────
  const DISPOSITION_OPTIONS = [
    { value: "",               label: "—",             chip: "" },
    { value: "interesado",     label: "Interesado",    chip: "chip chip--green" },
    { value: "callback",       label: "Pedir callback",chip: "chip chip--cyan" },
    { value: "no_interesado",  label: "No interesado", chip: "chip chip--red" },
    { value: "vendido",        label: "Vendido",       chip: "chip chip--violet" },
    { value: "buzon",          label: "Buzón / VM",    chip: "chip chip--amber" },
    { value: "no_calificado",  label: "No califica",   chip: "chip chip--amber" },
    { value: "otro",           label: "Otro",          chip: "chip" },
  ];

  const handleSetDisposition = async (
    row: CampaignContactRow,
    value: string
  ) => {
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
  }> = [
    { key: "pending",   label: "Pendientes",   Icn: Icon.Clock,    color: "var(--text-3)" },
    { key: "dialing",   label: "Marcando",     Icn: Icon.Phone,    color: "var(--accent-cyan)" },
    { key: "connected", label: "Conectados",   Icn: Icon.PhoneIn,  color: "var(--accent-green)" },
    { key: "done",      label: "Completados",  Icn: Icon.Check,    color: "var(--accent-green)" },
    { key: "no_answer", label: "Sin contestar",Icn: Icon.Phone,    color: "var(--accent-amber)" },
    { key: "failed",    label: "Fallidos",     Icn: Icon.Close,    color: "var(--accent-red)" },
  ];

  return (
    <div className="view">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="view__header" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
          <button
            className="btn btn--ghost btn--sm btn--icon"
            onClick={() => navigate("/campaigns")}
            title="Volver a campañas"
          >
            <Icon.ArrowLeft size={14} />
          </button>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 40,
              height: 40,
              borderRadius: 12,
              background:
                "linear-gradient(135deg, var(--accent-amber), var(--accent-pink) 70%)",
              color: "#0B0F1A",
              flexShrink: 0,
            }}
          >
            <Icon.Megaphone size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <h1 className="view__title" style={{ margin: 0 }}>
                {c.name}
              </h1>
              <span className={CAMPAIGN_STATUS_CHIP[c.status] || "chip"}>
                <span className="dot" />
                {CAMPAIGN_STATUS_LABEL[c.status] || c.status}
              </span>
            </div>
            {c.description && (
              <div className="view__sub" style={{ marginTop: 2 }}>
                {c.description}
              </div>
            )}
            <div
              className="muted mono"
              style={{
                marginTop: 6,
                fontSize: 11.5,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span>{c.sourcePhoneNumber}</span>
              <span>·</span>
              <span>{c.dialMode}</span>
              <span>·</span>
              <span>concurrencia {c.concurrency}</span>
              {c.createdAt && (
                <>
                  <span>·</span>
                  <span>
                    creada {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="view__actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Edit — only while still editable */}
          {(c.status === "DRAFT" ||
            c.status === "RUNNING" ||
            c.status === "PAUSED") && (
            <button
              className="btn"
              onClick={() => setEditOpen(true)}
              disabled={controlling}
            >
              <Icon.Pencil size={13} /> Editar
            </button>
          )}

          {/* Clone — always available */}
          <button
            className="btn"
            onClick={handleClone}
            disabled={mutations.pending}
          >
            <Icon.Copy size={13} /> Clonar
          </button>

          {/* Relaunch — only for terminal states */}
          {(c.status === "COMPLETED" || c.status === "CANCELLED") && (
            <>
              <button
                className="btn"
                onClick={() => handleRelaunch("failed")}
                disabled={mutations.pending}
              >
                <Icon.Refresh size={13} /> Relanzar fallidos
              </button>
              <button
                className="btn btn--primary"
                onClick={() => handleRelaunch("all")}
                disabled={mutations.pending}
              >
                <Icon.Refresh size={13} /> Relanzar todos
              </button>
            </>
          )}

          {/* DRAFT → Start */}
          {c.status === "DRAFT" && (
            <button
              className="btn btn--primary"
              onClick={() => handleControl("start")}
              disabled={controlling}
            >
              <Icon.Play size={13} /> Iniciar
            </button>
          )}
          {c.status === "RUNNING" && (
            <>
              <button
                className="btn"
                onClick={() => handleControl("pause")}
                disabled={controlling}
              >
                <Icon.Pause size={13} /> Pausar
              </button>
              <button
                className="btn btn--danger"
                onClick={() => handleControl("cancel")}
                disabled={controlling}
              >
                <Icon.Stop size={13} /> Cancelar
              </button>
            </>
          )}
          {c.status === "PAUSED" && (
            <button
              className="btn btn--primary"
              onClick={() => handleControl("resume")}
              disabled={controlling}
            >
              <Icon.Play size={13} /> Reanudar
            </button>
          )}
        </div>
      </div>

      {/* ── Progress banner ──────────────────────────────────────── */}
      <Card>
        <CardBody>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                  color: "var(--text-1)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {completed}
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
              <div
                className="row"
                style={{ gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}
              >
                {/* Pending — show only when there's something pending. */}
                {counts.pending > 0 && (
                  <button
                    className={`chip${
                      filterStatus === "pending" ? " chip--amber" : ""
                    }`}
                    onClick={() =>
                      setFilterStatus(
                        filterStatus === "pending" ? null : "pending"
                      )
                    }
                    style={{
                      border: "1px solid var(--border-1)",
                      cursor: "pointer",
                      background:
                        filterStatus === "pending"
                          ? "var(--accent-amber-soft)"
                          : "transparent",
                    }}
                    title="Filtrar pendientes"
                  >
                    <Icon.Clock size={11} /> {counts.pending} pendientes
                  </button>
                )}
                {(counts.dialing + counts.connected) > 0 && (
                  <span className="chip chip--green">
                    <span className="dot pulse" />
                    {counts.dialing + counts.connected} en vivo
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
                        onClick={() =>
                          setFilterStatus(
                            filterStatus === "done" ? null : "done"
                          )
                        }
                        style={{
                          cursor: "pointer",
                          outline:
                            filterStatus === "done"
                              ? "2px solid var(--accent-green)"
                              : "none",
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
                          setFilterStatus(
                            filterStatus === "no_answer" ? null : "no_answer"
                          )
                        }
                        style={{
                          cursor: "pointer",
                          outline:
                            filterStatus === "no_answer"
                              ? "2px solid var(--accent-amber)"
                              : "none",
                        }}
                        title="Filtrar sin contestar"
                      >
                        <Icon.Phone size={11} /> {counts.no_answer} sin contestar
                      </button>
                    )}
                    {counts.failed > 0 && (
                      <button
                        className={`chip chip--red`}
                        onClick={() =>
                          setFilterStatus(
                            filterStatus === "failed" ? null : "failed"
                          )
                        }
                        style={{
                          cursor: "pointer",
                          outline:
                            filterStatus === "failed"
                              ? "2px solid var(--accent-red)"
                              : "none",
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
          <div
            style={{
              marginTop: 14,
              height: 10,
              width: "100%",
              overflow: "hidden",
              borderRadius: 999,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, var(--accent-amber), var(--accent-pink))",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </CardBody>
      </Card>

      {/* ── Charts (donut + sparkline + gauge) ───────────────────── */}
      <CampaignCharts counts={counts} total={total} startedAt={c.startedAt} />

      {/* ── Pacing controls (live tuning of concurrency) ─────────── */}
      <PacingControlCard
        campaignId={c.campaignId}
        concurrency={Number(c.concurrency) || 1}
        dialMode={c.dialMode}
        onUpdated={() => refresh()}
        disabled={
          c.status === "COMPLETED" ||
          c.status === "CANCELLED" ||
          mutations.pending
        }
      />

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
          gap: 10,
        }}
      >
        {statusCards
          .map((s) => {
            const active = filterStatus === s.key;
            const Icn = s.Icn;
            return (
              <button
                key={s.key}
                onClick={() => setFilterStatus(active ? null : s.key)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: active
                    ? `1px solid ${s.color}`
                    : "1px solid var(--border-1)",
                  background: active ? "var(--bg-2)" : "var(--bg-1)",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  transition: "border-color 0.15s ease, background 0.15s ease",
                  boxShadow: active ? `0 0 0 3px ${s.color}22 inset` : "none",
                  flex: "1 1 160px",
                  maxWidth: 240,
                  minWidth: 160,
                }}
                title={`Filtrar por ${s.label.toLowerCase()}`}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: `${s.color}1a`,
                    color: s.color,
                    flexShrink: 0,
                  }}
                >
                  <Icn size={13} />
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                    lineHeight: 1.15,
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: "var(--text-1)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {counts[s.key]}
                  </div>
                  <div
                    className="muted"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              </button>
            );
          })}
      </div>
      )}

      {/* ── Activity: live feed + agent leaderboard ──────────────── */}
      <CampaignActivity
        liveContacts={data.liveContacts}
        contacts={contacts}
        resolveAgentLabel={resolveAgentLabel}
      />

      {/* Assigned agents — routing profile auto-configured */}
      <AssignedAgentsPanel campaign={c} />

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
          <div className="card__title">Contactos</div>
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
          <button
            className="btn btn--sm"
            onClick={handleExportCSV}
            disabled={visibleContacts.length === 0}
            title="Exportar contactos como CSV"
          >
            <Icon.Download size={11} /> CSV
          </button>
          {c.status !== "COMPLETED" && c.status !== "CANCELLED" && (
            <button
              className="btn btn--sm"
              onClick={() => setAddContactsOpen(true)}
            >
              <Icon.Plus size={11} /> Agregar
            </button>
          )}
        </div>

        {/* Bulk action toolbar — shown when at least 1 row selected. */}
        {selectedRowIds.size > 0 && (
          <div
            className="row"
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border-1)",
              background: "var(--accent-amber-soft)",
              gap: 10,
              fontSize: 12,
            }}
          >
            <Icon.Check size={13} style={{ color: "var(--accent-amber)" }} />
            <span style={{ fontWeight: 500, color: "var(--text-1)" }}>
              {selectedRowIds.size} seleccionado
              {selectedRowIds.size === 1 ? "" : "s"}
            </span>
            {lockedRowCount > 0 && (
              <span className="muted" style={{ fontSize: 11 }}>
                ({lockedRowCount} bloqueado{lockedRowCount === 1 ? "" : "s"} por
                estar en llamada activa)
              </span>
            )}
            <button
              className="btn btn--sm"
              style={{
                marginLeft: "auto",
                color: "var(--accent-red)",
                borderColor: "var(--accent-red)",
              }}
              onClick={handleBulkDelete}
              disabled={
                contactMutations.pending ||
                lockedRowCount === selectedRowIds.size
              }
            >
              <Icon.Trash size={11} />
              Eliminar {selectedRowIds.size - lockedRowCount}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setSelectedRowIds(new Set())}
            >
              Limpiar
            </button>
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
                          .filter(
                            (r) =>
                              r.status !== "dialing" && r.status !== "connected"
                          )
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
                  const locked =
                    row.status === "dialing" || row.status === "connected";
                  const assignedLabel = resolveAgentLabel(
                    row.assignedAgentUserId
                  );
                  const handlerLabel = resolveAgentLabel(row.agentUsername);
                  const isSelected = selectedRowIds.has(row.rowId);
                  const recUrl = recordingUrlFor(row.connectContactId);
                  return (
                    <tr
                      key={row.rowId}
                      style={{
                        borderTop: "1px solid var(--border-1)",
                        background: isSelected
                          ? "var(--accent-amber-soft)"
                          : undefined,
                        transition: "background 0.12s ease",
                      }}
                    >
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelected(row.rowId)}
                          disabled={locked}
                          title={
                            locked
                              ? "Llamada activa — no seleccionable"
                              : "Seleccionar"
                          }
                          style={{ cursor: locked ? "not-allowed" : "pointer" }}
                        />
                      </td>
                      <td
                        className="mono"
                        style={{ padding: "8px 10px", fontSize: 11.5 }}
                      >
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
                      <td
                        className="mono"
                        style={{ padding: "8px 10px", fontSize: 11.5 }}
                      >
                        {row.attempts}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {assignedLabel === "—" ? (
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            —
                          </span>
                        ) : (
                          <span
                            className="chip chip--amber"
                            style={{ fontSize: 10 }}
                          >
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
                        {handlerLabel === "—" ? (
                          <span className="muted">—</span>
                        ) : (
                          handlerLabel
                        )}
                      </td>
                      <td
                        className="muted"
                        style={{ padding: "8px 10px", fontSize: 11 }}
                      >
                        {row.lastAttemptAt
                          ? formatDistanceToNow(new Date(row.lastAttemptAt), {
                              addSuffix: true,
                            })
                          : "—"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {recUrl ? (
                          <a
                            href={recUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="chip chip--cyan"
                            style={{
                              fontSize: 10.5,
                              textDecoration: "none",
                            }}
                            title={`Escuchar (contactId ${row.connectContactId?.slice(-8)})`}
                          >
                            <Icon.Headset size={10} />
                            Escuchar
                          </a>
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
                            title={
                              locked
                                ? "No se puede editar llamada activa"
                                : "Editar"
                            }
                          >
                            <Icon.Pencil size={12} />
                          </button>
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            onClick={() => handleDeleteContact(row)}
                            disabled={locked || contactMutations.pending}
                            title={
                              locked
                                ? "No se puede eliminar llamada activa"
                                : "Eliminar"
                            }
                            style={{
                              color: locked
                                ? undefined
                                : "var(--accent-red)",
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
