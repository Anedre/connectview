/* ============================================================
   ARIA · Cockpit · PhonePad — marcador moderno (estilo teléfono)
   Bolitas con letras (ABC/DEF…), selector de prefijo por país con
   BANDERA real (country-flag-icons), display EDITABLE (mouse +
   teclado físico), chips de recientes/frecuentes y botón de llamar
   verde circular. Reemplaza al dialpad cuadrado del tab "Marcador".

   GENERALIZADO — sirve a DOS consumidores con el MISMO markup:
     • MODO DEMO: sin `recents` → usa AG_RECENTS (mock).
     • IDLE REAL: AgentIdleCockpit inyecta `recents` reales (números
       marcados recientemente, persistidos en localStorage).

   `onCall` recibe SIEMPRE el número listo para marcar (E.164-ish):
   el prefijo del país seleccionado ya viene antepuesto salvo que el
   agente teclee su propio "+".
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/aria";
import { AG_RECENTS } from "./mockData";
import PE from "country-flag-icons/react/3x2/PE";
import MX from "country-flag-icons/react/3x2/MX";
import CO from "country-flag-icons/react/3x2/CO";
import CL from "country-flag-icons/react/3x2/CL";
import AR from "country-flag-icons/react/3x2/AR";
import EC from "country-flag-icons/react/3x2/EC";
import BO from "country-flag-icons/react/3x2/BO";
import BR from "country-flag-icons/react/3x2/BR";
import VE from "country-flag-icons/react/3x2/VE";
import UY from "country-flag-icons/react/3x2/UY";
import US from "country-flag-icons/react/3x2/US";
import ES from "country-flag-icons/react/3x2/ES";

/** Número reciente/frecuente para el acceso rápido del marcador. */
export interface RecentNumber {
  id: string;
  /** Nombre del contacto (si se conoce). */
  name?: string;
  /** Teléfono a marcar — ya en formato completo. */
  phone: string;
  channel?: "voz" | "wa" | "email";
  /** "hace 5 min" (opcional). */
  ago?: string;
}

interface Country {
  iso: string;
  name: string;
  code: string;
}

/** Banderas SVG reales (no dependen del emoji del sistema). */
const FLAGS = { PE, MX, CO, CL, AR, EC, BO, BR, VE, UY, US, ES };
type FlagIso = keyof typeof FLAGS;

/** Prefijos frecuentes — Perú por defecto (tenant UDEP). */
const COUNTRIES: Country[] = [
  { iso: "PE", name: "Perú", code: "+51" },
  { iso: "MX", name: "México", code: "+52" },
  { iso: "CO", name: "Colombia", code: "+57" },
  { iso: "CL", name: "Chile", code: "+56" },
  { iso: "AR", name: "Argentina", code: "+54" },
  { iso: "EC", name: "Ecuador", code: "+593" },
  { iso: "BO", name: "Bolivia", code: "+591" },
  { iso: "BR", name: "Brasil", code: "+55" },
  { iso: "VE", name: "Venezuela", code: "+58" },
  { iso: "UY", name: "Uruguay", code: "+598" },
  { iso: "US", name: "EE. UU.", code: "+1" },
  { iso: "ES", name: "España", code: "+34" },
];

/** Teclas del marcador con sus letras (estilo teléfono). */
const KEYS: { k: string; sub?: string }[] = [
  { k: "1" },
  { k: "2", sub: "ABC" },
  { k: "3", sub: "DEF" },
  { k: "4", sub: "GHI" },
  { k: "5", sub: "JKL" },
  { k: "6", sub: "MNO" },
  { k: "7", sub: "PQRS" },
  { k: "8", sub: "TUV" },
  { k: "9", sub: "WXYZ" },
  { k: "*" },
  { k: "0", sub: "+" },
  { k: "#" },
];

const CH_DOT: Record<string, string> = {
  voz: "var(--ch-voz, var(--cyan))",
  wa: "var(--ch-wa, var(--green))",
  email: "var(--ch-email, var(--gold))",
};

/** Bandera del país (SVG real, redondeada). */
function Flag({ iso, size = 20 }: { iso: string; size?: number }) {
  const F = FLAGS[iso as FlagIso];
  if (!F) return null;
  return (
    <F
      title={iso}
      style={{
        width: size,
        height: size * 0.75,
        borderRadius: 3,
        display: "block",
        objectFit: "cover",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)",
      }}
    />
  );
}

export function PhonePad({
  num,
  setNum,
  onCall,
  recents,
}: {
  num: string;
  setNum: (updater: (n: string) => string) => void;
  onCall: (fullNumber: string) => void;
  /** Recientes reales. undefined = mock (AG_RECENTS). */
  recents?: RecentNumber[];
}) {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [pickOpen, setPickOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  // Cerrar el selector de país al hacer click afuera.
  useEffect(() => {
    if (!pickOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) {
        setPickOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickOpen]);

  const press = (k: string) => setNum((n) => (n + k).slice(0, 18));
  const back = () => setNum((n) => n.slice(0, -1));

  // Si el agente teclea su propio "+", se respeta; si no, se antepone el
  // prefijo del país seleccionado. Se limpian espacios para el marcado.
  const dialTarget = num.startsWith("+")
    ? num.replace(/\s+/g, "")
    : (country.code + num).replace(/\s+/g, "");
  const canCall = num.replace(/\D/g, "").length >= 6;

  const list: RecentNumber[] =
    recents ??
    // Mock: solo números marcables (voz / WhatsApp); el email no se marca.
    AG_RECENTS.filter((r) => r.channel !== "email").map((r, i) => ({
      id: `mock-${i}`,
      name: r.name,
      phone: r.phone,
      channel: r.channel,
      ago: r.ago,
    }));

  return (
    <div className="phonepad">
      {/* Display: prefijo país + número EDITABLE + borrar */}
      <div className="phonepad__disp">
        <div ref={pickRef} style={{ position: "relative", flex: "0 0 auto" }}>
          <button
            type="button"
            className="ccpick"
            aria-haspopup="listbox"
            aria-expanded={pickOpen}
            onClick={() => setPickOpen((o) => !o)}
          >
            <Flag iso={country.iso} size={20} />
            <span className="mono" style={{ fontSize: 13.5 }}>
              {country.code}
            </span>
            <Icon name="chevD" size={13} style={{ color: "var(--text-3)" }} />
          </button>
          {pickOpen && (
            <div className="ccpick__menu" role="listbox">
              {COUNTRIES.map((c) => (
                <button
                  key={c.iso}
                  type="button"
                  role="option"
                  aria-selected={c.iso === country.iso}
                  className={"ccpick__opt" + (c.iso === country.iso ? " is-sel" : "")}
                  onClick={() => {
                    setCountry(c);
                    setPickOpen(false);
                  }}
                >
                  <Flag iso={c.iso} size={22} />
                  <span className="grow" style={{ textAlign: "left" }}>
                    {c.name}
                  </span>
                  <span className="mono dim" style={{ fontSize: 12 }}>
                    {c.code}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          className="phonepad__num"
          type="tel"
          inputMode="tel"
          value={num}
          placeholder="Número"
          aria-label="Número a marcar"
          onChange={(e) =>
            setNum(() => e.target.value.replace(/[^\d*#+ ]/g, "").slice(0, 18))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCall) onCall(dialTarget);
          }}
        />
        <button
          type="button"
          className="phonepad__del"
          onClick={back}
          aria-label="Borrar"
          style={{ opacity: num ? 1 : 0, pointerEvents: num ? "auto" : "none" }}
        >
          <Icon name="backspace" size={20} />
        </button>
      </div>

      {/* Recientes / frecuentes (acceso rápido) */}
      {list.length > 0 && (
        <div className="drecent" role="list">
          {list.slice(0, 8).map((r) => (
            <button
              key={r.id}
              type="button"
              className="drecent__chip"
              onClick={() => onCall(r.phone)}
              title={`Marcar a ${r.name || r.phone}`}
            >
              <span
                className="drecent__dot"
                style={{ background: CH_DOT[r.channel || "voz"] }}
              />
              <span style={{ minWidth: 0, textAlign: "left", lineHeight: 1.15 }}>
                <span className="drecent__name">{r.name || r.phone}</span>
                {r.name && <span className="drecent__num mono">{r.phone}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Teclado en bolitas */}
      <div className="dpad">
        {KEYS.map(({ k, sub }) => (
          <button
            key={k}
            type="button"
            className={"dkey" + (k === "*" || k === "#" ? " dkey--sym" : "")}
            onClick={() => press(k)}
          >
            <span className="dkey__n">{k}</span>
            <span className="dkey__l">{sub || " "}</span>
          </button>
        ))}
      </div>

      {/* Botón de llamar verde */}
      <div className="dcall">
        <button
          type="button"
          className="dcall__btn"
          disabled={!canCall}
          onClick={() => onCall(dialTarget)}
          aria-label="Llamar"
        >
          <Icon name="phone" size={26} />
        </button>
      </div>
    </div>
  );
}
