import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

type Country = { code: string; flag: string; dial: string; name: string };

// Short LATAM-first list; "Otro" falls back to manual E.164 entry.
const COUNTRIES: Country[] = [
  { code: "PE", flag: "🇵🇪", dial: "+51", name: "Perú" },
  { code: "MX", flag: "🇲🇽", dial: "+52", name: "México" },
  { code: "CO", flag: "🇨🇴", dial: "+57", name: "Colombia" },
  { code: "AR", flag: "🇦🇷", dial: "+54", name: "Argentina" },
  { code: "CL", flag: "🇨🇱", dial: "+56", name: "Chile" },
  { code: "EC", flag: "🇪🇨", dial: "+593", name: "Ecuador" },
  { code: "BO", flag: "🇧🇴", dial: "+591", name: "Bolivia" },
  { code: "VE", flag: "🇻🇪", dial: "+58", name: "Venezuela" },
  { code: "ES", flag: "🇪🇸", dial: "+34", name: "España" },
  { code: "US", flag: "🇺🇸", dial: "+1", name: "EE.UU." },
];

const RECENTS_KEY = "vox.dialer.recents";

type Recent = { phone: string; at: number };

/**
 * Compact, professional softphone dialer. Country prefix is selectable
 * via a dropdown (no more "agent has to remember the + sign"), the pad
 * is circular with sub-letters like a real phone, and the last 5 dialed
 * numbers are cached in localStorage so the agent can redial without
 * retyping. Drives the streams API via `useCCP().placeCall(phoneNumber)`.
 */
export function SoftphoneDialer({ disabled }: { disabled?: boolean }) {
  const { placeCall, agentState, availableStates, changeAgentState } = useCCP();
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"pad" | "recents">("pad");
  const [recents, setRecents] = useState<Recent[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load cached recents on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Recent[];
        if (Array.isArray(parsed)) setRecents(parsed.slice(0, 5));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Close country dropdown when clicking outside.
  useEffect(() => {
    if (!countryOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setCountryOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [countryOpen]);

  const isMissedBlocked =
    agentState === "MissedCallAgent" ||
    agentState === "MissedCall" ||
    agentState === "Missed Call Agent";
  // Only Available — if the agent is Busy (already in a contact) we don't
  // want them accidentally placing a SECOND outbound call. Conferences /
  // warm transfers use addParticipantByPhone / addParticipantByQueue instead.
  const canDial = agentState === "Available";

  const composedNumber = useMemo(() => {
    const digits = number.replace(/[^\d]/g, "");
    if (!digits) return "";
    return `${country.dial}${digits}`;
  }, [country.dial, number]);

  const friendlyError = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const raw = String(msg);
    if (/BadEndpointException/i.test(raw)) {
      return "Connect rechazó el número. Verifica el código de país y el número.";
    }
    if (/Unauthorized|Permission|denied/i.test(raw)) {
      return "Tu perfil de seguridad no permite llamadas salientes. Contacta al admin.";
    }
    if (/InvalidStateException|state/i.test(raw)) {
      return "No puedes marcar en este estado. Cambia a Disponible primero.";
    }
    if (/Timeout|timed out/i.test(raw)) {
      return "Connect tardó demasiado en responder. Reintenta en unos segundos.";
    }
    return raw || "No se pudo iniciar la llamada";
  };

  const pushRecent = (phone: string) => {
    setRecents((curr) => {
      const next = [{ phone, at: Date.now() }, ...curr.filter((r) => r.phone !== phone)].slice(0, 5);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const dial = async (target?: string) => {
    const final = target || composedNumber;
    if (!final) {
      toast.error("Ingresa un número válido");
      return;
    }
    if (!/^\+\d{7,15}$/.test(final)) {
      toast.error("Número inválido", {
        description: "Debe ser E.164 con código de país (ej. +51953730189).",
      });
      return;
    }
    setSubmitting(true);
    try {
      await placeCall(final);
      pushRecent(final);
      toast.success(`Llamando a ${final}…`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const returnToAvailable = () => {
    const available = availableStates.find((s) => s.name === "Available");
    if (!available) {
      toast.error("Estado 'Available' no disponible en este perfil");
      return;
    }
    try {
      changeAgentState(available);
      toast.success("De vuelta a Disponible");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar de estado");
    }
  };

  const appendDigit = (d: string) => setNumber((curr) => curr + d);
  const backspace = () => setNumber((curr) => curr.slice(0, -1));

  const PAD: Array<{ d: string; sub?: string }> = [
    { d: "1", sub: "" },
    { d: "2", sub: "ABC" },
    { d: "3", sub: "DEF" },
    { d: "4", sub: "GHI" },
    { d: "5", sub: "JKL" },
    { d: "6", sub: "MNO" },
    { d: "7", sub: "PQRS" },
    { d: "8", sub: "TUV" },
    { d: "9", sub: "WXYZ" },
    { d: "*", sub: "" },
    { d: "0", sub: "+" },
    { d: "#", sub: "" },
  ];

  return (
    <div className="vox-dial">
      {/* Tab strip — Pad vs Recientes */}
      <div className="vox-dial__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pad"}
          className={`vox-dial__tab ${tab === "pad" ? "vox-dial__tab--active" : ""}`}
          onClick={() => setTab("pad")}
        >
          Marcador
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "recents"}
          className={`vox-dial__tab ${tab === "recents" ? "vox-dial__tab--active" : ""}`}
          onClick={() => setTab("recents")}
        >
          Recientes {recents.length > 0 && `· ${recents.length}`}
        </button>
      </div>

      {tab === "pad" ? (
        <>
          {/* Country selector + input + backspace */}
          <div className="vox-dial__head">
            <div ref={dropdownRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="vox-dial__country"
                onClick={() => setCountryOpen((v) => !v)}
                title={`${country.name} ${country.dial}`}
              >
                <span className="vox-dial__country-flag">{country.flag}</span>
                <span className="vox-dial__country-code">{country.dial}</span>
                <Icon.ChevDown size={12} style={{ opacity: 0.5 }} />
              </button>
              {countryOpen && (
                <div className="vox-sp__state-menu" style={{ right: "auto", left: 0, top: "calc(100% + 4px)" }}>
                  {COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      className={`vox-sp__state-opt ${c.code === country.code ? "vox-sp__state-opt--active" : ""}`}
                      onClick={() => {
                        setCountry(c);
                        setCountryOpen(false);
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{c.flag}</span>
                      <span style={{ flex: 1 }}>{c.name}</span>
                      <span className="mono" style={{ color: "var(--text-3)", fontSize: 11.5 }}>
                        {c.dial}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="vox-dial__input"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") dial();
                if (e.key === "Backspace" && !number) e.preventDefault();
              }}
              placeholder="número"
              inputMode="tel"
            />
            <button
              type="button"
              className="vox-dial__bksp"
              onClick={backspace}
              disabled={!number}
              title="Borrar dígito"
              aria-label="Borrar dígito"
            >
              <Icon.ArrowLeft size={14} />
            </button>
          </div>

          {/* Circular pad with sub-letters */}
          <div className="vox-dial__pad">
            {PAD.map((k) => (
              <button
                key={k.d}
                type="button"
                className="vox-dial__key"
                onClick={() => appendDigit(k.d)}
              >
                <span>{k.d}</span>
                {k.sub && <span className="vox-dial__key-sub">{k.sub}</span>}
              </button>
            ))}
          </div>

          {/* Big call button */}
          <button
            type="button"
            className="vox-dial__call"
            onClick={() => dial()}
            disabled={disabled || submitting || !canDial || !number}
            title={
              !canDial
                ? "Cambia tu estado a Available para poder llamar"
                : `Llamar a ${composedNumber || "—"}`
            }
          >
            <Icon.PhoneIn size={16} />
            {submitting ? "Marcando…" : "Llamar"}
          </button>
        </>
      ) : (
        <div className="vox-dial__recents">
          {recents.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: "16px 0" }}>
              Aún no hay llamadas recientes
            </div>
          ) : (
            recents.map((r) => (
              <button
                key={r.phone}
                type="button"
                className="vox-dial__recent"
                onClick={() => dial(r.phone)}
                disabled={!canDial}
                title={`Volver a llamar a ${r.phone}`}
              >
                <Icon.PhoneIn size={13} style={{ color: "var(--accent-green)" }} />
                <span>{r.phone}</span>
                <span className="vox-dial__recent-time">
                  {fmtAgo(Date.now() - r.at)}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Blocked-because-missed gate */}
      {isMissedBlocked && (
        <div
          style={{
            padding: "8px 10px",
            background: "var(--accent-red-soft)",
            border: "1px solid var(--accent-red)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--accent-red)", lineHeight: 1.4 }}>
            Connect bloqueó las salientes porque no aceptaste un contacto previo.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={returnToAvailable}
            style={{ height: 28, justifyContent: "center", fontSize: 11.5 }}
          >
            Volver a Disponible
          </button>
        </div>
      )}

      {!canDial && !isMissedBlocked && (
        <div className="muted" style={{ fontSize: 11, textAlign: "center" }}>
          Necesitas estar en estado "Available" para llamar.
        </div>
      )}
    </div>
  );
}

function fmtAgo(deltaMs: number): string {
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return "hace seg.";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}
