/* ============================================================
   ARIA · Cockpit · Modales del CallBar — MODO DEMO
   Réplica en mock de DTMFKeypadModal / TransferQueueModal /
   ConferenceModal. Overlay .scrim + .card (clases ya existentes).
   Se abren desde los botones Teclado / Transferir / Conferencia
   del CallBar. Todo mock — NO toca el softphone real.
   ============================================================ */
import { useState, type ReactNode } from "react";
import { Av, Btn, Icon } from "@/components/aria";
import { AG_TRANSFER_TARGETS } from "./mockData";
import { INP_STYLE } from "./styles";

export type CallModalKind = "dtmf" | "transfer" | "conference" | null;

/** Shell del modal: scrim + card con header/cierre, estilo ARIA. */
function ModalShell({
  icon,
  title,
  sub,
  onClose,
  width = 380,
  children,
  footer,
}: {
  icon: string;
  title: string;
  sub: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="scrim" onClick={onClose} style={{ display: "grid", placeItems: "center" }}>
      <div
        className="card card--pop"
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "92vw", maxHeight: "84vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div className="row gap10" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-1)", alignItems: "center" }}>
          <div className="tl__ico" style={{ ["--_c" as string]: "var(--accent)", width: 30, height: 30, flex: "0 0 auto" }}>
            <Icon name={icon} size={15} />
          </div>
          <div className="grow">
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
            <div className="dim" style={{ fontSize: 11 }}>
              {sub}
            </div>
          </div>
          <button type="button" className="ctab__x" aria-label="Cerrar" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="card__pad" style={{ overflowY: "auto" }}>
          {children}
        </div>
        {footer && (
          <div className="row gap8" style={{ padding: "10px 14px", borderTop: "1px solid var(--border-1)", justifyContent: "flex-end" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function DtmfModal({ onClose }: { onClose: () => void }) {
  const [hist, setHist] = useState("");
  const press = (k: string) => setHist((h) => (h + k).slice(-24));
  return (
    <ModalShell icon="grid" title="Teclado DTMF" sub="Los tonos llegan en vivo al cliente" onClose={onClose} width={340}>
      <div className="col gap14">
        <div
          className="mono"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--r-md)",
            padding: "12px 14px",
            fontSize: 22,
            fontWeight: 700,
            minHeight: 50,
            letterSpacing: 6,
            textAlign: "right",
            color: hist ? "var(--text-1)" : "var(--text-3)",
          }}
        >
          {hist || "—"}
        </div>
        <div className="dialpad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)}>
              {k}
            </button>
          ))}
        </div>
        <div className="dim" style={{ fontSize: 10.5, textAlign: "center" }}>
          Usa el teclado físico (0-9, *, #) si prefieres.
        </div>
      </div>
    </ModalShell>
  );
}

function TransferModal({ onClose }: { onClose: () => void }) {
  const [warm, setWarm] = useState(false);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const list = AG_TRANSFER_TARGETS.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <ModalShell
      icon="route"
      title="Transferir contacto"
      sub={warm ? "Warm — consultas primero y luego cuelgas" : "Blind — la cola recibe al instante"}
      onClose={onClose}
      width={420}
      footer={
        <Btn variant="ghost" onClick={onClose}>
          Cerrar
        </Btn>
      }
    >
      <div className="col gap10">
        <label
          className="row gap10"
          style={{ padding: "8px 10px", borderRadius: "var(--r-md)", background: warm ? "var(--iris-soft)" : "var(--bg-2)", border: "1px solid var(--border-1)", cursor: "pointer" }}
        >
          <input type="checkbox" checked={warm} onChange={(e) => setWarm(e.target.checked)} style={{ accentColor: "var(--iris)" }} />
          <span className="grow">
            <b style={{ fontSize: 12.5, color: warm ? "var(--iris-2)" : "var(--text-1)" }}>Consultar primero (warm transfer)</b>
            <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
              Conversas con el destino antes de soltar la llamada.
            </div>
          </span>
        </label>

        <div className="row gap8" style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: "var(--r-md)", padding: "0 10px", height: 42 }}>
          <Icon name="search" size={14} style={{ color: "var(--text-3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cola o agente…" style={{ ...INP_STYLE, border: 0, background: "transparent", padding: 0, height: "100%" }} />
        </div>

        {sent ? (
          <div className="tl__note" style={{ margin: 0 }}>
            {warm ? "Conectando con " : "Transferido a "} <b>{sent}</b>
            {warm ? " · tu llamada sigue activa." : " ✓"}
          </div>
        ) : (
          <div className="col gap6">
            {list.map((t) => (
              <button
                key={t.name}
                type="button"
                className="row gap10"
                onClick={() => setSent(t.name)}
                style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--bg-2)", border: "1px solid var(--border-1)", cursor: "pointer", textAlign: "left" }}
              >
                <div className="tl__ico" style={{ ["--_c" as string]: "var(--cyan)", width: 30, height: 30, flex: "0 0 auto" }}>
                  <Icon name={t.type === "Cola" ? "users" : "user"} size={14} />
                </div>
                <div className="grow">
                  <b style={{ fontSize: 13 }}>{t.name}</b>
                  <div className="dim" style={{ fontSize: 11 }}>
                    {t.type} · {t.meta}
                  </div>
                </div>
                <Icon name="route" size={14} style={{ color: "var(--text-3)" }} />
              </button>
            ))}
            {list.length === 0 && (
              <div className="dim" style={{ textAlign: "center", padding: 14, fontSize: 12.5 }}>
                Sin coincidencias.
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function ConferenceModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState("+51");
  const [added, setAdded] = useState(false);
  const valid = /^\+\d{7,15}$/.test(phone.trim());

  return (
    <ModalShell
      icon="users"
      title="Añadir a la llamada"
      sub="Conferencia · cliente + tú + 3er participante"
      onClose={onClose}
      width={380}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn variant="primary" icon="phone" disabled={!valid || added} onClick={() => setAdded(true)}>
            {added ? "Añadiendo…" : "Añadir a la llamada"}
          </Btn>
        </>
      }
    >
      <div className="col gap12">
        <div className="dim" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
          Número del participante
        </div>
        <div className="row gap8" style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: "var(--r-md)", padding: "0 12px", height: 46 }}>
          <Icon name="phone" size={14} style={{ color: "var(--text-3)" }} />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+51953730189"
            className="mono"
            style={{ ...INP_STYLE, border: 0, background: "transparent", padding: 0, height: "100%", fontSize: 16, fontWeight: 600 }}
          />
        </div>
        {added ? (
          <div className="row gap8" style={{ fontSize: 12.5, color: "var(--green)" }}>
            <Av name={phone} size={28} color="var(--green)" />
            <span>Marcando al participante… quedarán los tres en conferencia.</span>
          </div>
        ) : (
          <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Tu llamada queda activa mientras Connect marca al 3er participante. Una vez conectado, los tres están en una conferencia 3-way.
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export function CallModals({ kind, onClose }: { kind: CallModalKind; onClose: () => void }) {
  if (!kind) return null;
  if (kind === "dtmf") return <DtmfModal onClose={onClose} />;
  if (kind === "transfer") return <TransferModal onClose={onClose} />;
  return <ConferenceModal onClose={onClose} />;
}
