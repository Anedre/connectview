/* ============================================================
   ARIA · Cockpit · Ring REAL (entrante) — DATOS REALES
   Variante de Ring.tsx (modo demo) que recibe datos REALES del
   contacto entrante de Amazon Connect + el perfil del cliente
   (useCustomerProfile) + un resumen de toques/última interacción
   (useLeadOverview). Reusa el MISMO markup/clases del handoff.
   El screen-pop degrada honesto cuando no hay dato:
     • Sin perfil  → "Contacto no registrado — se creará al contestar".
     • Con perfil, sin historial → oculta la línea de screen-pop de IA.
   Rechazar/Contestar disparan reject()/accept() REALES.
   ============================================================ */
import { Av, Icon, Pill } from "@/components/aria";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useLeadOverview } from "@/hooks/useLeadOverview";
import { displayCustomerName } from "@/lib/customerName";

/** "hace N días/horas/min" a partir de un ISO timestamp. Vacío si no hay ts. */
function relativeFrom(ts: string | undefined): string | null {
  if (!ts) return null;
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return null;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const d = Math.floor(hr / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Etiqueta del canal de la última interacción a partir del overview. */
function lastChannelLabel(
  ov: ReturnType<typeof useLeadOverview>
): { label: string; ts?: string } | null {
  const cands: { label: string; ts?: string }[] = [
    { label: "WhatsApp", ts: ov.whatsapp?.lastTs },
    { label: "llamada", ts: ov.calls?.lastTs },
    { label: "email", ts: ov.emails?.lastTs },
  ].filter((c) => !!c.ts);
  if (cands.length === 0) return null;
  cands.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return cands[0];
}

export function RingReal({
  phone,
  queueName,
  attributes,
  onAccept,
  onReject,
}: {
  phone: string | null;
  queueName?: string;
  /** Atributos del contacto de Connect (etapa/origen puestos por el flow). */
  attributes?: Record<string, string>;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { profile } = useCustomerProfile(phone);
  const ov = useLeadOverview(phone);

  const fullName = profile
    ? displayCustomerName(
        {
          firstName: profile.firstName,
          lastName: profile.lastName,
          businessName: profile.businessName,
          email: profile.email,
          phoneNumber: profile.phoneNumber,
        },
        ""
      ) || null
    : null;
  const known = !!fullName;
  const displayName = fullName || phone || "Cliente entrante";
  const avatarName = fullName || phone || "?";

  // Datos del screen-pop: preferimos atributos del contacto (los pone el
  // flow de Connect); si no, caemos a lo que sabemos del lead/overview.
  const attrs = attributes || {};
  const stage =
    attrs.stage ||
    attrs.udep_stage ||
    attrs.etapa ||
    profile?.attributes?.stage ||
    null;
  const origen =
    attrs.origen ||
    attrs.source ||
    attrs.udep_source ||
    attrs.utm_source ||
    profile?.attributes?.origen ||
    null;
  const programa = attrs.programa || attrs.program || queueName || null;

  // Toques = total de eventos del historial del lead (si lo tenemos).
  const touches = ov.history?.count ?? null;
  const last = lastChannelLabel(ov);
  const lastRel = last ? relativeFrom(last.ts) : null;

  // ¿Hay algo real que mostrar en el bloque de screen-pop?
  const hasScreenPop =
    known && (!!stage || !!origen || touches != null || !!lastRel);

  return (
    <div className="row center" style={{ padding: "20px 0" }}>
      <div
        className="card card--pop ring-pulse"
        style={{
          padding: 32,
          textAlign: "center",
          maxWidth: 460,
          width: "100%",
          borderColor: "color-mix(in srgb,var(--green) 45%,var(--border-1))",
        }}
      >
        <Pill tone="green" icon="arrowIn" style={{ margin: "0 auto" }}>
          Llamada entrante{queueName ? ` · ${queueName}` : ""}
        </Pill>
        <div style={{ margin: "20px auto 14px", width: "fit-content" }}>
          <Av name={avatarName} size={84} radius={26} color="var(--cyan)" />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>
          {displayName}
        </div>
        {phone && (
          <div className="mono dim" style={{ fontSize: 13, marginTop: 4 }}>
            {phone}
            {programa ? ` · ${programa}` : ""}
          </div>
        )}

        {hasScreenPop ? (
          <div
            style={{
              margin: "16px 0",
              padding: "11px 14px",
              borderRadius: "var(--r-md)",
              background: "var(--iris-soft)",
              fontSize: 12.5,
              color: "var(--text-2)",
              textAlign: "left",
            }}
          >
            <span
              className="row gap8"
              style={{ fontWeight: 700, color: "var(--iris-2)", marginBottom: 3 }}
            >
              <Icon name="sparkle" size={14} />
              Screen-pop
            </span>
            {[
              origen ? `Origen ${origen}` : null,
              touches != null ? `${touches} ${touches === 1 ? "toque" : "toques"}` : null,
              lastRel && last ? `última interacción ${lastRel} (${last.label})` : null,
              stage ? `Etapa: ${stage}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        ) : (
          /* Degradado honesto: cliente no registrado (o sin datos aún). */
          <div
            style={{
              margin: "16px 0",
              padding: "11px 14px",
              borderRadius: "var(--r-md)",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              fontSize: 12.5,
              color: "var(--text-3)",
              textAlign: "left",
            }}
          >
            <span
              className="row gap8"
              style={{ fontWeight: 700, color: "var(--text-2)", marginBottom: 3 }}
            >
              <Icon name="user" size={14} />
              {known ? "Sin historial previo" : "Contacto no registrado"}
            </span>
            {known
              ? "Aún no hay interacciones registradas para este contacto."
              : "Se creará el lead automáticamente al contestar."}
          </div>
        )}

        <div className="row gap12 center">
          <button
            type="button"
            className="btn"
            style={{
              background: "var(--red)",
              color: "#fff",
              height: 52,
              width: 52,
              borderRadius: "50%",
            }}
            onClick={onReject}
            title="Rechazar"
          >
            <Icon name="phone" size={22} style={{ transform: "rotate(135deg)" }} />
          </button>
          <button
            type="button"
            className="btn"
            style={{
              background: "var(--green)",
              color: "#fff",
              height: 52,
              padding: "0 26px",
              borderRadius: 99,
              fontWeight: 750,
            }}
            onClick={onAccept}
            title="Contestar"
          >
            <Icon name="phone" size={20} />
            Contestar
          </button>
        </div>
      </div>
    </div>
  );
}
