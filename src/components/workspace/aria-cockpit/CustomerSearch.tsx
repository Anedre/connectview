/* ============================================================
   ARIA · Cockpit · Buscar cliente (idle) — MODO DEMO
   Réplica en mock del CustomerBrowser real (Connect Customer
   Profiles): input + resultados / atendidos recientemente.
   Se monta dentro del Dialer como la pestaña "Buscar". Reutiliza
   <Av> .btn .chdot INP_STYLE — NO rediseña nada.
   ============================================================ */
import { useState } from "react";
import { Av, Icon } from "@/components/aria";
import { AG_PROFILES, AG_RECENTS } from "./mockData";
import { INP_STYLE } from "./styles";

const CH_ICON: Record<string, string> = { voz: "phone", wa: "wa", email: "mail" };

export function CustomerSearch({ onCall }: { onCall: (phone: string) => void }) {
  const [q, setQ] = useState("");
  const results = q.trim()
    ? AG_PROFILES.filter((p) => {
        const hay = (p.name + " " + p.email + " " + p.phone).toLowerCase();
        return hay.includes(q.trim().toLowerCase());
      })
    : [];
  const showRecents = !q.trim();

  return (
    <div className="col gap12">
      {/* Input de búsqueda */}
      <div>
        <div
          className="row gap8"
          style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: "var(--r-md)", padding: "0 10px", height: 44 }}
        >
          <Icon name="search" size={15} style={{ color: "var(--text-3)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Teléfono, email o nombre completo"
            style={{ ...INP_STYLE, border: 0, background: "transparent", padding: 0, height: "100%" }}
          />
          {q && (
            <button type="button" className="ctab__x" onClick={() => setQ("")}>
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
        <div className="dim" style={{ fontSize: 10.5, marginTop: 5, lineHeight: 1.4 }}>
          Busca en Connect Customer Profiles. Se aceptan teléfonos con o sin +, emails o nombres.
        </div>
      </div>

      {/* Resultados */}
      {q.trim() && (
        <div className="col gap4">
          <div className="dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em" }}>
            {results.length} resultado{results.length === 1 ? "" : "s"}
          </div>
          {results.length === 0 && (
            <div className="dim" style={{ textAlign: "center", padding: 16, fontSize: 12.5 }}>
              Sin resultados para “{q}”.
            </div>
          )}
          {results.map((p) => (
            <div
              key={p.id}
              className="row gap10"
              style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--bg-2)", border: "1px solid var(--border-1)" }}
            >
              <Av name={p.name} size={32} color="var(--cyan)" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="trunc" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {p.name}
                </div>
                <div className="mono dim trunc" style={{ fontSize: 10.5 }}>
                  {p.phone} · {p.email}
                </div>
              </div>
              <span className="pill pill--outline" style={{ height: 22, fontSize: 10 }}>
                {p.matchedBy}
              </span>
              <button
                type="button"
                className="btn btn--soft btn--sm btn--icon"
                aria-label={"Llamar a " + p.name}
                onClick={() => onCall(p.phone)}
              >
                <Icon name="phone" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Atendidos recientemente */}
      {showRecents && (
        <div className="col gap4">
          <div className="dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em" }}>
            Atendidos recientemente
          </div>
          {AG_RECENTS.map((r) => (
            <div
              key={r.phone}
              className="row gap10"
              style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--bg-2)", border: "1px solid var(--border-1)" }}
            >
              <Av name={r.name} size={32} color="var(--accent)" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row gap6">
                  <Icon name={CH_ICON[r.channel]} size={11} style={{ color: "var(--text-3)" }} />
                  <span className="trunc" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {r.name}
                  </span>
                </div>
                <div className="mono dim trunc" style={{ fontSize: 10.5, marginTop: 1 }}>
                  {r.phone} · {r.ago}
                </div>
              </div>
              {r.channel === "voz" && (
                <button type="button" className="btn btn--soft btn--sm btn--icon" aria-label={"Llamar a " + r.name} onClick={() => onCall(r.phone)}>
                  <Icon name="phone" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
