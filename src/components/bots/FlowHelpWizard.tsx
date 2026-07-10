import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  X,
  MousePointerClick,
  Workflow,
  Variable,
  Eye,
  Rocket,
  Keyboard,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/**
 * FlowHelpWizard — reemplaza el banner plano «Primeros pasos» del constructor
 * de bots por un wizard modal: guía paso a paso (con progreso) + referencia de
 * atajos, animado y con estilo premium. Se abre desde el botón «Ayuda» (o la
 * tecla «?»).
 */

interface Step {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  tip?: ReactNode;
}

const STEPS: Step[] = [
  {
    icon: MousePointerClick,
    title: "Agrega pasos al lienzo",
    body: (
      <>
        Arrastra un paso desde el panel de la izquierda hacia el lienzo — o haz <b>clic</b> en él
        para agregarlo al centro.
      </>
    ),
    tip: "Cada paso es una acción del bot: enviar un mensaje, preguntar algo, derivar a un agente…",
  },
  {
    icon: Workflow,
    title: "Conecta el flujo",
    body: (
      <>
        Traza una línea desde el punto de salida de un paso hasta el siguiente. O suelta un paso{" "}
        <b>cerca de la salida</b> de otro y se conecta solo.
      </>
    ),
    tip: "Arrastra una conexión al vacío para crear y enlazar un paso nuevo de una sola vez.",
  },
  {
    icon: Variable,
    title: "Guarda y reutiliza datos",
    body: (
      <>
        Con <b>«Preguntar y guardar»</b> capturas lo que responde el cliente, y con{" "}
        <b>«Insertar variable»</b> lo reutilizas en cualquier mensaje.
      </>
    ),
    tip: "Ej.: guardas el nombre y luego saludas con «Hola, {{nombre}} 👋».",
  },
  {
    icon: Eye,
    title: "Previsualiza el mensaje",
    body: (
      <>
        Abre la <b>«Vista previa»</b> del inspector (panel derecho) para ver exactamente cómo le
        llega el mensaje al cliente, con botones y variables.
      </>
    ),
  },
  {
    icon: Rocket,
    title: "Ordena y prueba",
    body: (
      <>
        <b>«Ordenar»</b> acomoda el flujo de izquierda a derecha, y <b>«Probar»</b> abre un chat
        para conversar con el bot antes de publicarlo.
      </>
    ),
    tip: "Recuerda «Guardar» cuando termines: mientras tanto el bot queda en borrador.",
  },
];

interface Shortcut {
  keys: string[];
  desc: string;
  sep?: string;
}
const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "Z"], desc: "Deshacer" },
  { keys: ["Ctrl", "Shift", "Z"], desc: "Rehacer" },
  { keys: ["Ctrl", "Y"], desc: "Rehacer (alternativo)" },
  { keys: ["Ctrl", "C"], desc: "Copiar el paso" },
  { keys: ["Ctrl", "V"], desc: "Pegar el paso" },
  { keys: ["Ctrl", "D"], desc: "Duplicar el paso" },
  { keys: ["Supr", "Backspace"], desc: "Borrar lo seleccionado", sep: "/" },
  { keys: ["arrastrar", "vacío"], desc: "Conectar y crear un paso", sep: "→" },
  { keys: ["+"], desc: "Insertar un paso en la conexión" },
  { keys: ["?"], desc: "Abrir / cerrar esta ayuda" },
];

type Tab = "guide" | "shortcuts";

export function FlowHelpWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("guide");
  const [step, setStep] = useState(0);

  // Esc cierra. El estado (tab/step) se reinicia solo al reabrir porque el padre
  // re-monta el wizard con una `key` distinta — así evitamos setState en effect.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const s = STEPS[step];
  const StepIcon = s.icon;
  const last = step === STEPS.length - 1;
  const first = step === 0;

  return createPortal(
    <div className="fhw-overlay" onClick={onClose} role="presentation">
      <div
        className="fhw"
        role="dialog"
        aria-modal="true"
        aria-label="Cómo funciona el constructor de bots"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="fhw__head">
          <div className="fhw__head-icon">
            <BookOpen size={18} />
          </div>
          <div className="fhw__head-txt">
            <div className="fhw__head-title">Cómo funciona el constructor</div>
            <div className="fhw__head-sub">Arma tu bot en 5 pasos</div>
          </div>
          <button className="fhw__x" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="fhw__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "guide"}
            className={`fhw__tab ${tab === "guide" ? "fhw__tab--on" : ""}`}
            onClick={() => setTab("guide")}
          >
            <BookOpen size={14} /> Primeros pasos
          </button>
          <button
            role="tab"
            aria-selected={tab === "shortcuts"}
            className={`fhw__tab ${tab === "shortcuts" ? "fhw__tab--on" : ""}`}
            onClick={() => setTab("shortcuts")}
          >
            <Keyboard size={14} /> Atajos
          </button>
        </div>

        {tab === "guide" ? (
          <div className="fhw__body">
            {/* Rail de pasos */}
            <ol className="fhw__rail">
              {STEPS.map((st, i) => {
                const Ic = st.icon;
                return (
                  <li key={i}>
                    <button
                      className={`fhw__railitem ${i === step ? "fhw__railitem--on" : ""} ${
                        i < step ? "fhw__railitem--done" : ""
                      }`}
                      onClick={() => setStep(i)}
                    >
                      <span className="fhw__railnum">
                        <Ic size={14} />
                      </span>
                      <span className="fhw__railtxt">{st.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Contenido del paso */}
            <div className="fhw__stage" key={step}>
              <div className="fhw__stage-icon">
                <StepIcon size={26} />
              </div>
              <div className="fhw__stage-step">
                Paso {step + 1} de {STEPS.length}
              </div>
              <div className="fhw__stage-title">{s.title}</div>
              <div className="fhw__stage-body">{s.body}</div>
              {s.tip && (
                <div className="fhw__tip">
                  <span className="fhw__tip-dot" />
                  {s.tip}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="fhw__shortcuts">
            {SHORTCUTS.map((sc, i) => (
              <div className="fhw__sc" key={i}>
                <span className="fhw__sc-keys">
                  {sc.keys.map((k, j) => (
                    <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {j > 0 && <span className="fhw__sc-or">{sc.sep || "+"}</span>}
                      <kbd className="fhw__kbd">{k}</kbd>
                    </span>
                  ))}
                </span>
                <span className="fhw__sc-desc">{sc.desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {tab === "guide" && (
          <div className="fhw__foot">
            <div className="fhw__dots">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  className={`fhw__dot ${i === step ? "fhw__dot--on" : ""}`}
                  onClick={() => setStep(i)}
                  aria-label={`Ir al paso ${i + 1}`}
                />
              ))}
            </div>
            <div className="fhw__foot-btns">
              <button
                className="btn btn--sm"
                onClick={() => setStep((n) => Math.max(0, n - 1))}
                disabled={first}
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              {last ? (
                <button className="btn btn--primary btn--sm" onClick={onClose}>
                  <Rocket size={13} /> Empezar
                </button>
              ) : (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))}
                >
                  Siguiente <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
