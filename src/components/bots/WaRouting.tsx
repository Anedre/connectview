import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Icon, Btn } from "@/components/aria";
import type { WhatsAppNumberRef } from "@/hooks/useConnections";

/**
 * WaRouting — vista de Ruteo de WhatsApp (sección Bots). Ancla cada número de
 * WhatsApp de Meta a UN flujo/bot (`number.botId`). Las credenciales del número se
 * cargan en Configuración → Integraciones; acá SOLO se decide QUÉ flujo lo atiende.
 * 1 número = 1 flujo (nunca dos bots peleando por un número). Persiste vía
 * manage-connections { action: "setWaNumberBot", id, botId }.
 *
 * Los números "de Connect (AWS)" no se rutean acá: entran como contacto y los
 * atiende el flow de Amazon Connect (colas + agente en vivo), no un bot de ARIA.
 */
interface BotLite {
  botId: string;
  name?: string;
  status?: string;
  kind?: string;
}

export function WaRouting({ onBack }: { onBack: () => void }) {
  const ep = getApiEndpoints();
  const [numbers, setNumbers] = useState<WhatsAppNumberRef[]>([]);
  const [bots, setBots] = useState<BotLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const numbersP: Promise<{ numbers?: WhatsAppNumberRef[] }> = ep?.manageConnections
        ? authedFetch(ep.manageConnections, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "listWaNumbers" }),
          }).then((r) => r.json())
        : Promise.resolve({ numbers: [] });
      const botsP: Promise<{ bots?: BotLite[] }> = ep?.manageBot
        ? fetch(ep.manageBot).then((r) => r.json())
        : Promise.resolve({ bots: [] });
      const [nRes, bRes] = await Promise.all([numbersP, botsP]);
      setNumbers(nRes.numbers || []);
      setBots(
        (bRes.bots || []).filter(
          (b) =>
            b.botId && !String(b.botId).startsWith("conv#") && !String(b.botId).startsWith("sess#"),
        ),
      );
    } catch {
      toast.error("No se pudo cargar el ruteo de WhatsApp");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flujos que realmente responden (publicados/activos). Un borrador no atiende.
  const options = useMemo(
    () => bots.filter((b) => b.status === "published" || b.status === "active"),
    [bots],
  );
  const botName = (id?: string) => bots.find((b) => b.botId === id)?.name;

  const setBot = async (n: WhatsAppNumberRef, botId: string) => {
    if (!ep?.manageConnections) return;
    setSavingId(n.id);
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setWaNumberBot", id: n.metaPhoneNumberId || n.id, botId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "fallo");
      setNumbers((j.numbers as WhatsAppNumberRef[]) || []);
      toast.success(botId ? "Flujo asignado a este número" : "Ruteo quitado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo rutear");
    } finally {
      setSavingId(null);
    }
  };

  const metaNumbers = numbers.filter((n) => (n.mode || "meta") === "meta");
  const awsCount = numbers.filter((n) => n.mode === "aws").length;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Ruteo de WhatsApp</h2>
          <div
            className="muted"
            style={{ fontSize: 13, marginTop: 4, maxWidth: 620, lineHeight: 1.5 }}
          >
            Elegí qué flujo atiende cada número de Meta. <b>1 número = 1 flujo.</b> Las credenciales
            se cargan en Configuración → Integraciones; acá solo el ruteo.
          </div>
        </div>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          ← Volver a Bots
        </Btn>
      </div>

      {loading ? (
        <div className="grid" style={{ gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 70, borderRadius: 12 }} />
          ))}
        </div>
      ) : metaNumbers.length === 0 ? (
        <div className="card" style={{ padding: 44, textAlign: "center", color: "var(--text-3)" }}>
          <Icon name="flow" size={30} style={{ opacity: 0.4 }} />
          <div style={{ marginTop: 10, fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>
            No hay números de WhatsApp de Meta registrados
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6 }}>
            Registrá un número en <b>Configuración → Integraciones → WhatsApp</b> (modo “Número de
            Meta aparte”) y volvé acá para elegir su flujo.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {metaNumbers.map((n, i) => (
            <div
              key={n.id}
              className="row"
              style={{
                gap: 12,
                padding: "14px 16px",
                alignItems: "center",
                borderTop: i ? "1px solid var(--border-1)" : "none",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  display: "grid",
                  placeItems: "center",
                  background: "color-mix(in srgb, #25D366 14%, transparent)",
                  flexShrink: 0,
                }}
              >
                <Icon name="flow" size={16} style={{ color: "#25D366" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {n.label || n.displayNumber || n.metaPhoneNumberId || n.id}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {n.metaPhoneNumberId || n.id}
                  {!n.tokenSet ? " · falta token" : ""}
                </div>
              </div>
              <select
                value={n.botId || ""}
                disabled={savingId === n.id}
                onChange={(e) => void setBot(n, e.target.value)}
                style={{
                  minWidth: 230,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-2)",
                  color: "var(--text-1)",
                  fontSize: 13,
                  cursor: savingId === n.id ? "wait" : "pointer",
                }}
              >
                <option value="">Sin flujo (agente humano)</option>
                {options.map((b) => (
                  <option key={b.botId} value={b.botId}>
                    {b.name || b.botId}
                    {b.kind === "agent" ? " · Agente IA" : ""}
                  </option>
                ))}
                {n.botId && !options.some((b) => b.botId === n.botId) && (
                  <option value={n.botId}>{botName(n.botId) || n.botId} (no publicado)</option>
                )}
              </select>
            </div>
          ))}
        </div>
      )}

      {awsCount > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          {awsCount} número{awsCount > 1 ? "s" : ""} de <b>Connect (AWS)</b> no aparece
          {awsCount > 1 ? "n" : ""} acá: entra{awsCount > 1 ? "n" : ""} como contacto y se rutea
          {awsCount > 1 ? "n" : ""} por el flow de Amazon Connect (colas + agente en vivo), no por
          un bot de ARIA.
        </div>
      )}
    </div>
  );
}
