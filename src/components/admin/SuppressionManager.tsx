import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/usePermissions";
import {
  useSuppression,
  type SuppressionEntry,
  type SuppressionRules,
} from "@/hooks/useSuppression";

/**
 * SuppressionManager — Configuración → Supresión y cumplimiento (Pilar 3 · R6).
 * Dos vistas: la lista DNC/opt-out, y la política (reglas: anti-doble-envío,
 * frecuencia, horario). La enforcement corre en cada envío (`_shared/suppression.ts`).
 */

const STATUS_META: Record<SuppressionEntry["status"], { label: string; chip: string }> = {
  opted_out: { label: "Baja (opt-out)", chip: "chip--amber" },
  dnc: { label: "No contactar", chip: "chip--red" },
  quarantined: { label: "Cuarentena", chip: "chip--violet" },
  converted: { label: "Convertido", chip: "chip--green" },
};
const SOURCE_LABEL: Record<SuppressionEntry["source"], string> = {
  inbound_keyword: "STOP por WhatsApp",
  manual: "Manual",
  status_webhook: "Número inválido",
  import: "Importado",
  conversion: "Conversión (lead ganado)",
};
const CHANNEL_LABEL: Record<string, string> = {
  all: "Todos",
  whatsapp: "WhatsApp",
  voice: "Voz",
  email: "Email",
};
/** Opciones del selector de canal en el alta manual (labels largos). */
const CHANNEL_OPTS: { value: string; label: string }[] = [
  { value: "all", label: "Todos los canales" },
  { value: "whatsapp", label: "Solo WhatsApp" },
  { value: "voice", label: "Solo Voz" },
  { value: "email", label: "Solo Email" },
];

function channelsText(channels: string[]): string {
  if (!channels?.length) return "—";
  if (channels.includes("all")) return "Todos los canales";
  return channels.map((c) => CHANNEL_LABEL[c] || c).join(" · ");
}

export function SuppressionManager() {
  const { user } = useAuth();
  const canManage = useCan("manage_suppression");
  const { entries, rules, loading, error, add, remove, saveRules } = useSuppression();
  const [view, setView] = useState<"list" | "rules">("list");

  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState("all");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const kpis = useMemo(() => {
    let optOut = 0,
      dnc = 0,
      quar = 0;
    for (const e of entries) {
      if (e.status === "opted_out") optOut++;
      else if (e.status === "dnc") dnc++;
      else if (e.status === "quarantined") quar++;
    }
    return { total: entries.length, optOut, dnc, quar };
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        (e.e164 || e.phone).toLowerCase().includes(q) || (e.reason || "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  const doAdd = async () => {
    const p = phone.trim();
    if (!p) {
      toast.error("Ingresa un número");
      return;
    }
    setSaving(true);
    try {
      await add({
        phone: p,
        channels: [channel],
        reason: reason.trim() || undefined,
        status: "dnc",
        actor: user?.username || "admin",
      });
      toast.success(`Número bloqueado: ${p}`);
      setPhone("");
      setReason("");
      setChannel("all");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo bloquear");
    } finally {
      setSaving(false);
    }
  };

  const doRemove = async (e: SuppressionEntry) => {
    if (!confirm(`¿Quitar ${e.e164 || e.phone} de la lista? Volverá a recibir envíos.`)) return;
    try {
      await remove(e.e164 || e.phone);
      toast.success("Número reactivado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo quitar");
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header + tabs */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Supresión y cumplimiento
          </div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 620, lineHeight: 1.5 }}
          >
            Cada envío de WhatsApp pasa por este filtro antes de salir. La <strong>lista</strong> es
            el “no contactar”; las <strong>reglas</strong> son el anti-doble-envío, la frecuencia y
            el horario.
          </div>
        </div>
        <div
          className="row"
          style={{
            gap: 6,
            flex: "0 0 auto",
            padding: 4,
            background: "var(--bg-2)",
            borderRadius: 10,
          }}
        >
          <button
            className={`btn btn--sm ${view === "list" ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setView("list")}
          >
            <Icon.Stop size={12} /> Lista
          </button>
          <button
            className={`btn btn--sm ${view === "rules" ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setView("rules")}
          >
            <Icon.Shield size={12} /> Reglas
          </button>
        </div>
      </div>

      {view === "rules" ? (
        <RulesPanel
          rules={rules}
          canManage={canManage}
          onSave={(patch) => saveRules(patch, user?.username)}
        />
      ) : (
        <>
          {/* Cómo funciona */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              borderRadius: 12,
              border: "1px solid var(--accent-cyan)",
              background: "var(--accent-cyan-soft)",
              padding: "12px 14px",
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--accent-cyan)",
                color: "#fff",
                flex: "0 0 auto",
              }}
            >
              <Icon.Shield size={16} />
            </span>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-2)" }}>
              Cuando un cliente responde <b>STOP</b> o <b>BAJA</b> por WhatsApp, se agrega
              automáticamente aquí y se le confirma la baja (responder <b>ALTA</b> lo reactiva).
              También puedes <b>bloquear un número a mano</b> abajo. El anti-doble-envío y la
              frecuencia se configuran en <b>Reglas</b>.
            </div>
          </div>

          {/* KPI strip */}
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}
          >
            <Kpi label="Suprimidos" value={kpis.total} color="var(--accent-cyan)" />
            <Kpi label="Bajas (opt-out)" value={kpis.optOut} color="var(--accent-amber)" />
            <Kpi label="Bloqueos manuales" value={kpis.dnc} color="var(--accent-red)" />
            <Kpi label="Cuarentena" value={kpis.quar} color="var(--accent-violet)" />
          </div>

          {/* Alta manual */}
          {canManage && (
            <Card>
              <CardBody>
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ flex: "1 1 200px", minWidth: 180 }}>
                    <div
                      className="muted"
                      style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}
                    >
                      Número
                    </div>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doAdd();
                      }}
                      placeholder="+51953730189"
                      style={inp}
                    />
                  </label>
                  <label style={{ flex: "0 0 160px" }}>
                    <div
                      className="muted"
                      style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}
                    >
                      Canales
                    </div>
                    <Select value={channel} onValueChange={(v) => v && setChannel(v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {CHANNEL_OPTS.find((o) => o.value === channel)?.label || channel}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNEL_OPTS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label style={{ flex: "2 1 220px", minWidth: 180 }}>
                    <div
                      className="muted"
                      style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}
                    >
                      Motivo (opcional)
                    </div>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doAdd();
                      }}
                      placeholder="Pidió no ser contactado"
                      style={inp}
                    />
                  </label>
                  <button
                    className="btn btn--primary"
                    onClick={doAdd}
                    disabled={saving}
                    style={{ flex: "0 0 auto" }}
                  >
                    <Icon.Stop size={13} /> {saving ? "Bloqueando…" : "Bloquear número"}
                  </button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Lista */}
          <Card>
            <CardBody flush>
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-1)",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  Lista de supresión{" "}
                  <span className="muted" style={{ fontWeight: 500 }}>
                    · {entries.length}
                  </span>
                </div>
                <div
                  className="row"
                  style={{
                    gap: 7,
                    alignItems: "center",
                    padding: "7px 11px",
                    borderRadius: 8,
                    border: "1px solid var(--border-1)",
                    background: "var(--bg-1)",
                  }}
                >
                  <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar número o motivo…"
                    style={{
                      border: "none",
                      background: "transparent",
                      outline: "none",
                      fontSize: 13,
                      color: "var(--text-1)",
                      width: 180,
                    }}
                  />
                </div>
              </div>

              {loading ? (
                <div className="muted" style={{ padding: 28, textAlign: "center" }}>
                  Cargando lista…
                </div>
              ) : error ? (
                <div
                  style={{
                    padding: 28,
                    textAlign: "center",
                    color: "var(--accent-red)",
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              ) : visible.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 24px" }}>
                  <div
                    style={{
                      display: "inline-grid",
                      placeItems: "center",
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: "var(--accent-green-soft)",
                      color: "var(--accent-green)",
                      marginBottom: 12,
                    }}
                  >
                    <Icon.Check size={22} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {query ? "Ningún número coincide" : "Nadie está suprimido"}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {query
                      ? "Prueba otra búsqueda."
                      : "Las bajas por STOP y los bloqueos manuales aparecerán aquí."}
                  </div>
                </div>
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Estado</th>
                      <th>Canales</th>
                      <th>Motivo</th>
                      <th>Origen</th>
                      <th>Fecha</th>
                      {canManage && <th style={{ width: 90 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => {
                      const sm = STATUS_META[e.status] || STATUS_META.dnc;
                      return (
                        <tr key={e.phone}>
                          <td className="mono" style={{ fontWeight: 600 }}>
                            {e.e164 || e.phone}
                          </td>
                          <td>
                            <span className={`chip ${sm.chip}`}>{sm.label}</span>
                          </td>
                          <td className="col-muted">{channelsText(e.channels)}</td>
                          <td
                            className="col-muted"
                            style={{
                              maxWidth: 260,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={e.reason || ""}
                          >
                            {e.reason || "—"}
                          </td>
                          <td className="col-muted">{SOURCE_LABEL[e.source] || e.source}</td>
                          <td className="col-muted mono" style={{ fontSize: 11.5 }}>
                            {e.createdAt
                              ? new Date(e.createdAt).toLocaleDateString("es-PE", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "2-digit",
                                })
                              : "—"}
                          </td>
                          {canManage && (
                            <td>
                              <button
                                className="btn btn--sm"
                                onClick={() => doRemove(e)}
                                title="Quitar de la lista (re-alta)"
                              >
                                <Icon.Refresh size={12} /> Quitar
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-1)",
  background: "var(--bg-1)",
  color: "var(--text-1)",
  outline: "none",
  fontSize: 13.5,
};

/** Panel de política (reglas). WhatsApp-first en v1. */
function RulesPanel({
  rules,
  canManage,
  onSave,
}: {
  rules: SuppressionRules | null;
  canManage: boolean;
  onSave: (patch: Partial<SuppressionRules>) => Promise<SuppressionRules | null>;
}) {
  const waCap = rules?.freqCaps?.find((f) => f.channel === "whatsapp");
  const waQuiet = rules?.quietHours?.find((q) => q.channel === "whatsapp");

  const [dedupDays, setDedupDays] = useState(1);
  const [freqOn, setFreqOn] = useState(false);
  const [freqMax, setFreqMax] = useState(3);
  const [freqWindow, setFreqWindow] = useState(7);
  const [quietOn, setQuietOn] = useState(false);
  const [quietStart, setQuietStart] = useState(8);
  const [quietEnd, setQuietEnd] = useState(21);
  const [quietTz, setQuietTz] = useState("America/Lima");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hidratar cuando llegan las reglas.
  useEffect(() => {
    setDedupDays(rules?.dedupWindowDays ?? 1);
    setFreqOn(!!waCap && waCap.max > 0);
    setFreqMax(waCap?.max || 3);
    setFreqWindow(waCap?.windowDays || 7);
    setQuietOn(!!waQuiet);
    setQuietStart(waQuiet?.startHour ?? 8);
    setQuietEnd(waQuiet?.endHour ?? 21);
    setQuietTz(waQuiet?.timezone || "America/Lima");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  const mark = () => setDirty(true);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        dedupWindowDays: Math.max(0, Math.floor(dedupDays)),
        freqCaps: freqOn
          ? [
              {
                channel: "whatsapp",
                max: Math.max(1, freqMax),
                windowDays: Math.max(1, freqWindow),
              },
            ]
          : [],
        quietHours: quietOn
          ? [{ channel: "whatsapp", startHour: quietStart, endHour: quietEnd, timezone: quietTz }]
          : [],
      });
      toast.success("Reglas guardadas");
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* Anti-doble-envío */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                🎯 Anti-doble-envío{" "}
                <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
                  · R6
                </span>
              </div>
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}
              >
                No reenviar un WhatsApp al mismo número si ya recibió uno en los últimos N días. Es
                la deduplicación automática: nunca más “a estos ya les mandé”.{" "}
                <b>0 = desactivado</b>.
              </div>
            </div>
            <label className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
              <input
                type="number"
                min={0}
                max={365}
                value={dedupDays}
                disabled={!canManage}
                onChange={(e) => {
                  setDedupDays(Number(e.target.value));
                  mark();
                }}
                style={{ ...inp, width: 72, textAlign: "center" }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                días
              </span>
            </label>
          </div>
        </CardBody>
      </Card>

      {/* Frecuencia */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <Switch
                  checked={freqOn}
                  disabled={!canManage}
                  onCheckedChange={(v) => {
                    setFreqOn(v);
                    mark();
                  }}
                  aria-label="Tope de frecuencia (WhatsApp)"
                />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Tope de frecuencia (WhatsApp)</span>
              </div>
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}
              >
                Máximo de mensajes por número en una ventana. Protege el número de Meta de
                sobre-mensajear.
              </div>
            </div>
            <div
              className="row"
              style={{ gap: 6, alignItems: "center", flex: "0 0 auto", opacity: freqOn ? 1 : 0.45 }}
            >
              <span className="muted" style={{ fontSize: 13 }}>
                máx
              </span>
              <input
                type="number"
                min={1}
                max={99}
                value={freqMax}
                disabled={!canManage || !freqOn}
                onChange={(e) => {
                  setFreqMax(Number(e.target.value));
                  mark();
                }}
                style={{ ...inp, width: 64, textAlign: "center" }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                cada
              </span>
              <input
                type="number"
                min={1}
                max={90}
                value={freqWindow}
                disabled={!canManage || !freqOn}
                onChange={(e) => {
                  setFreqWindow(Number(e.target.value));
                  mark();
                }}
                style={{ ...inp, width: 64, textAlign: "center" }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                días
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Horario permitido */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <Switch
                  checked={quietOn}
                  disabled={!canManage}
                  onCheckedChange={(v) => {
                    setQuietOn(v);
                    mark();
                  }}
                  aria-label="Horario permitido (WhatsApp)"
                />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Horario permitido (WhatsApp)</span>
              </div>
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}
              >
                Solo enviar dentro de la franja horaria (zona del cliente). Ej.: no antes de las 8
                ni después de las 21.
              </div>
            </div>
            <div
              className="row"
              style={{
                gap: 6,
                alignItems: "center",
                flex: "0 0 auto",
                opacity: quietOn ? 1 : 0.45,
              }}
            >
              <span className="muted" style={{ fontSize: 13 }}>
                de
              </span>
              <input
                type="number"
                min={0}
                max={23}
                value={quietStart}
                disabled={!canManage || !quietOn}
                onChange={(e) => {
                  setQuietStart(Number(e.target.value));
                  mark();
                }}
                style={{ ...inp, width: 60, textAlign: "center" }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                a
              </span>
              <input
                type="number"
                min={0}
                max={23}
                value={quietEnd}
                disabled={!canManage || !quietOn}
                onChange={(e) => {
                  setQuietEnd(Number(e.target.value));
                  mark();
                }}
                style={{ ...inp, width: 60, textAlign: "center" }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                h
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {canManage && (
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
            <Icon.Check size={13} /> {saving ? "Guardando…" : "Guardar reglas"}
          </button>
          {dirty && (
            <span className="chip chip--amber" style={{ height: 28 }}>
              <span className="dot" /> Sin guardar
            </span>
          )}
          {rules?.updatedAt && !dirty && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Última actualización: {new Date(rules.updatedAt).toLocaleString("es-PE")}
              {rules.updatedBy ? ` · ${rules.updatedBy}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
