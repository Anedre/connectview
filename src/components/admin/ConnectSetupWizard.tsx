import { useState, type ReactNode, type CSSProperties } from "react";
import { toast } from "sonner";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import type { ConnectConn } from "@/hooks/useConnections";
import {
  connectAccessCfnTemplate,
  connectRoleLaunchUrl,
  dataPlaneCfnTemplate,
  dataPlaneLaunchUrl,
  dataPlanePermissionsLaunchUrl,
} from "./cfnTemplates";

/**
 * ConnectSetupWizard — asistente guiado a pantalla completa para conectar
 * Amazon Connect. Didáctico: poco texto por pantalla, un paso a la vez, lo
 * técnico escondido detrás de "Ver detalles". El paso del rol usa el 1-clic
 * "Launch Stack" (abre CloudFormation con todo pre-cargado).
 */

const CONNECT_REGIONS = [
  "us-east-1", "us-west-2", "af-south-1", "ap-northeast-1", "ap-northeast-2",
  "ap-southeast-1", "ap-southeast-2", "ca-central-1", "eu-central-1", "eu-west-2",
];

const STEPS = [
  { key: "intro", title: "Cómo funciona" },
  { key: "instance", title: "Tu instancia" },
  { key: "origins", title: "Permitir el visor" },
  { key: "role", title: "Crear el acceso" },
  { key: "dataplane", title: "Tus datos" },
  { key: "done", title: "Listo" },
];

const inputStyle: CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--border-1)",
  borderRadius: 8, background: "var(--bg-1)", color: "var(--text-1)",
};
const labelStyle: CSSProperties = {
  fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginBottom: 4, display: "block",
};

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar")
  );
}

/** Tarjeta visual de "qué accede Vox / qué no" para el paso intro. */
function AccessRow({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "flex-start", padding: "6px 0" }}>
      <span
        aria-hidden
        style={{
          flex: "0 0 auto", display: "grid", placeItems: "center", width: 22, height: 22,
          borderRadius: "50%", marginTop: 1,
          background: ok ? "var(--accent-green-soft)" : "var(--accent-red-soft)",
          color: ok ? "var(--accent-green)" : "var(--accent-red)",
        }}
      >
        {ok ? <Icon.Check size={13} /> : <Icon.Close size={13} />}
      </span>
      <span style={{ fontSize: 13.5, color: "var(--text-1)", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function Details({ children }: { children: ReactNode }) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent-cyan)", fontWeight: 600 }}>
        Ver detalles técnicos
      </summary>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>{children}</div>
    </details>
  );
}

export function ConnectSetupWizard({
  initial,
  onSave,
  onClose,
}: {
  initial: ConnectConn;
  voxAccountId?: string;
  onSave: (c: ConnectConn) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ConnectConn>(() => ({
    region: "us-east-1",
    externalId: initial.externalId || `vox-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    ...initial,
  }));
  const [verifying, setVerifying] = useState(false);
  const [verifyingDp, setVerifyingDp] = useState(false);
  const ep = getApiEndpoints();
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const set = (patch: Partial<ConnectConn>) => setDraft((d) => ({ ...d, ...patch }));

  const canNext = (): boolean => {
    if (STEPS[step].key === "instance") return !!draft.instanceUrl?.trim();
    if (STEPS[step].key === "role") return !!draft.roleArn?.trim();
    // El Data Plane es OBLIGATORIO: no se avanza sin las tablas verificadas.
    if (STEPS[step].key === "dataplane") return !!draft.dataPlaneEnabled;
    return true;
  };

  const onVerifyDataPlane = async () => {
    if (!ep?.verifyConnectConnection) { toast.message("Backend pendiente."); return; }
    if (!draft.roleArn?.trim()) { toast.error("Primero creá el rol (paso anterior)"); return; }
    setVerifyingDp(true);
    try {
      const r = await authedFetch(ep.verifyConnectConnection, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleArn: draft.roleArn.trim(), externalId: draft.externalId, instanceArn: draft.instanceArn, region: draft.region, checkDataPlane: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        const missing = Array.isArray(j.missingTables) && j.missingTables.length
          ? ` Faltan: ${j.missingTables.slice(0, 4).join(", ")}${j.missingTables.length > 4 ? "…" : ""}` : "";
        throw new Error((j.error || "No se pudieron verificar las tablas") + missing);
      }
      set({ dataPlaneEnabled: true, dataPlaneVerifiedAt: new Date().toISOString() });
      toast.success("¡Las 14 tablas existen! Tus datos van a tu cuenta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la verificación de tablas");
    } finally {
      setVerifyingDp(false);
    }
  };

  const onVerify = async () => {
    if (!ep?.verifyConnectConnection) { toast.message("Backend de verificación pendiente."); return; }
    if (!draft.roleArn?.trim()) { toast.error("Pegá primero el ARN del rol"); return; }
    setVerifying(true);
    try {
      const r = await authedFetch(ep.verifyConnectConnection, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleArn: draft.roleArn.trim(), externalId: draft.externalId, instanceArn: draft.instanceArn, region: draft.region }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo verificar");
      set({ verifiedAt: new Date().toISOString() });
      toast.success("¡Conexión verificada!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la verificación");
    } finally {
      setVerifying(false);
    }
  };

  const finish = () => {
    if (!draft.instanceUrl?.trim()) { toast.error("Falta la URL de tu instancia"); setStep(1); return; }
    onSave({ ...draft, instanceUrl: draft.instanceUrl.trim(), roleArn: draft.roleArn?.trim() });
    toast.success("Integración guardada");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "var(--bg-0)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Header con progreso */}
      <header style={{ padding: "18px 28px", borderBottom: "1px solid var(--border-1)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <Icon.Headset size={20} style={{ color: "#FF9900" }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Conectar Amazon Connect</span>
          </div>
          <button className="btn btn--sm" onClick={onClose}><Icon.Close size={13} /> Cerrar</button>
        </div>
        {/* Barra de pasos */}
        <div className="row" style={{ gap: 6, marginTop: 14 }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ flex: 1 }}>
              <div
                style={{
                  height: 4, borderRadius: 999,
                  background: i <= step ? "var(--accent-amber)" : "var(--border-1)",
                  transition: "background 0.3s",
                }}
              />
              <div style={{ fontSize: 10.5, marginTop: 5, color: i === step ? "var(--text-1)" : "var(--text-3)", fontWeight: i === step ? 700 : 400 }}>
                {i + 1}. {s.title}
              </div>
            </div>
          ))}
        </div>
      </header>

      {/* Body — un paso a la vez, centrado, máx 640px */}
      <div style={{ flex: 1, overflow: "auto", padding: "32px 28px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {STEPS[step].key === "intro" && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                Conectá tu Amazon Connect en 4 pasos
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
                ARIA se conecta a TU cuenta AWS mediante un rol que vos creás y controlás.
                Te lleva ~3 minutos y no necesitás ser técnico.
              </p>
              <div style={{ marginTop: 20, padding: 18, borderRadius: 12, background: "var(--bg-1)", border: "1px solid var(--border-1)" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Qué accede ARIA</div>
                <AccessRow ok>Lee tus métricas, colas y agentes en tiempo real</AccessRow>
                <AccessRow ok>Lee las grabaciones para que las escuches acá</AccessRow>
                <AccessRow ok>Origina llamadas salientes para tus campañas</AccessRow>
                <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 10px" }}>Qué ARIA NUNCA hace</div>
                <AccessRow ok={false}>No guarda tus credenciales — solo "pide permiso" cuando lo necesita</AccessRow>
                <AccessRow ok={false}>No borra ni modifica la configuración de tu Connect</AccessRow>
                <AccessRow ok={false}>No accede a nada fuera de lo que el rol permite</AccessRow>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 14, lineHeight: 1.5 }}>
                Podés revocar el acceso en cualquier momento borrando el rol — sin pedirnos permiso.
              </p>
            </div>
          )}

          {STEPS[step].key === "instance" && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>¿Dónde está tu Amazon Connect?</h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
                Pegá la URL de tu instancia (la que usás para entrar a Connect) y elegí su región.
              </p>
              <div style={{ marginTop: 20 }}>
                <label style={labelStyle}>URL de tu instancia</label>
                <input style={inputStyle} placeholder="https://tu-empresa.my.connect.aws"
                  value={draft.instanceUrl || ""} onChange={(e) => set({ instanceUrl: e.target.value })} />
              </div>
              <div className="row" style={{ gap: 14, marginTop: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Región</label>
                  <select style={inputStyle} value={draft.region || "us-east-1"} onChange={(e) => set({ region: e.target.value })}>
                    {CONNECT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>ARN de la instancia (recomendado)</label>
                <input style={inputStyle} placeholder="arn:aws:connect:us-east-1:123456789012:instance/…"
                  value={draft.instanceArn || ""} onChange={(e) => set({ instanceArn: e.target.value })} />
              </div>
              <Details>
                El ARN lo encontrás en tu consola de Connect → Información de la cuenta. Con él, ARIA
                restringe las acciones sensibles (originar llamadas, escuchar) SOLO a esta instancia.
              </Details>
            </div>
          )}

          {STEPS[step].key === "origins" && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Permití que ARIA muestre tu visor</h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
                Para que el softphone de Connect funcione dentro de ARIA, agregá este dominio en tu consola
                de Connect → <b>Configuración de la aplicación → Orígenes aprobados</b>.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 16 }}>
                <code style={{ flex: 1, padding: "10px 12px", background: "var(--bg-2)", borderRadius: 8, fontSize: 13, border: "1px solid var(--border-1)" }}>{appOrigin}</code>
                <button className="btn" onClick={() => copy(appOrigin, "Dominio")}><Icon.Copy size={13} /> Copiar</button>
              </div>
              <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "var(--accent-cyan-soft)", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                Tip: si te saltás este paso, todo funciona menos el softphone embebido (el resto de ARIA anda igual).
              </div>
            </div>
          )}

          {STEPS[step].key === "role" && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Creá el acceso seguro</h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
                Un clic abre CloudFormation en TU cuenta con todo pre-cargado. Revisás y das "Crear". Cuando
                termine, copiá el <b>RoleArn</b> que aparece en la pestaña "Salidas" y pegalo abajo.
              </p>
              <a
                href={connectRoleLaunchUrl({ externalId: draft.externalId || "", instanceArn: draft.instanceArn, region: draft.region })}
                target="_blank" rel="noopener noreferrer"
                className="btn btn--primary"
                style={{ marginTop: 16, fontSize: 14, padding: "12px 18px", display: "inline-flex", textDecoration: "none" }}
              >
                <Icon.Cloud size={15} /> Crear rol en mi cuenta AWS (1 clic)
              </a>
              <div style={{ marginTop: 20 }}>
                <label style={labelStyle}>ARN del rol creado</label>
                <input style={inputStyle} placeholder="arn:aws:iam::123456789012:role/VoxCrmConnectAccess"
                  value={draft.roleArn || ""} onChange={(e) => set({ roleArn: e.target.value, verifiedAt: undefined })} />
              </div>
              {draft.roleArn && (
                <button className="btn" style={{ marginTop: 12 }} onClick={onVerify} disabled={verifying}>
                  {verifying ? "Verificando…" : draft.verifiedAt ? <><Icon.Check size={13} style={{ color: "var(--accent-green)" }} /> Verificado</> : <><Icon.Check size={13} /> Verificar conexión</>}
                </button>
              )}
              <Details>
                ¿Preferís revisar el YAML o aplicarlo a mano? Copiá la plantilla:
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn--sm" onClick={() => copy(connectAccessCfnTemplate(draft.externalId || "", draft.instanceArn || ""), "Plantilla")}>
                    <Icon.Copy size={12} /> Copiar plantilla CloudFormation
                  </button>
                </div>
                Tu External ID es <code>{draft.externalId}</code> — el código anti-suplantación que solo vos y ARIA conocen.
              </Details>
            </div>
          )}

          {STEPS[step].key === "dataplane" && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tus datos viven en TU cuenta</h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
                ARIA <b>no guarda datos de empresas en su cuenta</b>. Tus leads, campañas, contactos y
                tipificaciones viven en TU cuenta AWS. Creá las 14 tablas con un clic — es un paso
                necesario para usar ARIA.
              </p>
              <ol style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 14, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Tocá "Crear mis 14 tablas" (abre CloudFormation en tu cuenta).</li>
                <li>Esperá ~1 min a que el stack termine (estado CREATE_COMPLETE).</li>
                <li>Volvé acá y tocá "Verificar tablas".</li>
              </ol>
              <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <a
                  href={dataPlaneLaunchUrl(draft.region)}
                  target="_blank" rel="noopener noreferrer"
                  className="btn btn--primary"
                  style={{ display: "inline-flex", textDecoration: "none" }}
                >
                  <Icon.Cloud size={14} /> Crear mis 14 tablas (1 clic)
                </a>
                <button className="btn" onClick={onVerifyDataPlane} disabled={verifyingDp || !draft.roleArn}>
                  {verifyingDp ? "Verificando…" : draft.dataPlaneEnabled
                    ? <><Icon.Check size={13} style={{ color: "var(--accent-green)" }} /> Tablas verificadas</>
                    : <><Icon.Check size={13} /> Verificar tablas</>}
                </button>
              </div>
              {draft.dataPlaneEnabled ? (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "var(--accent-green-soft)", color: "var(--accent-green)", fontSize: 12.5, fontWeight: 600 }}>
                  ✓ Tus tablas existen. ARIA va a leer y escribir en TU cuenta.
                </div>
              ) : (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "var(--accent-amber-soft)", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.5 }}>
                  Para continuar, creá las tablas y verificalas. Sin esto, ARIA no tiene dónde guardar tus datos.
                </div>
              )}
              <Details>
                <div style={{ marginBottom: 10 }}>
                  <b>¿Las tablas ya existen</b> (las creaste antes o un intento previo)? No re-crees:
                  usá la plantilla de SOLO permisos, que extiende el rol sin tocar las tablas (segura
                  de re-aplicar, no toca datos):
                  <div style={{ marginTop: 6 }}>
                    <a href={dataPlanePermissionsLaunchUrl(draft.region)} target="_blank" rel="noopener noreferrer"
                      className="btn btn--sm" style={{ display: "inline-flex", textDecoration: "none" }}>
                      <Icon.Cloud size={12} /> Solo permisos (1 clic)
                    </a>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  Tus tablas tienen protección anti-borrado (DeletionPolicy: Retain): si borrás o
                  re-aplicás el stack, los datos NO se pierden.
                </div>
                <div style={{ marginTop: 8 }}>
                  Copiar la plantilla completa:
                  <button className="btn btn--sm" style={{ marginLeft: 8 }} onClick={() => copy(dataPlaneCfnTemplate(), "Plantilla Data Plane")}>
                    <Icon.Copy size={12} /> Copiar
                  </button>
                </div>
              </Details>
            </div>
          )}

          {STEPS[step].key === "done" && (
            <div style={{ textAlign: "center", paddingTop: 20 }}>
              <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", background: "var(--accent-green-soft)", color: "var(--accent-green)", margin: "0 auto" }}>
                <Icon.Check size={32} />
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: "18px 0 0" }}>¡Todo listo!</h2>
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6, maxWidth: 440, marginInline: "auto" }}>
                Guardá para terminar. En "Estado de la integración" vas a ver el diagnóstico de tu Connect y
                qué features te conviene activar (Contact Lens, grabaciones, etc.).
              </p>
              <div style={{ marginTop: 20, padding: 16, borderRadius: 10, background: "var(--bg-1)", border: "1px solid var(--border-1)", textAlign: "left", maxWidth: 440, marginInline: "auto" }}>
                <AccessRow ok={!!draft.instanceUrl}>Instancia: {draft.instanceUrl || "—"}</AccessRow>
                <AccessRow ok={!!draft.roleArn}>Rol de acceso {draft.verifiedAt ? "(verificado)" : "(sin verificar)"}</AccessRow>
                <AccessRow ok={!!draft.dataPlaneEnabled}>BYO Data Plane {draft.dataPlaneEnabled ? "activado" : "(no activado)"}</AccessRow>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer navegación */}
      <footer style={{ padding: "16px 28px", borderTop: "1px solid var(--border-1)", display: "flex", justifyContent: "space-between" }}>
        <button className="btn" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
          {step === 0 ? "Cancelar" : <><Icon.ChevDown size={13} style={{ transform: "rotate(90deg)" }} /> Atrás</>}
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn btn--primary" onClick={() => setStep(step + 1)} disabled={!canNext()}>
            Siguiente <Icon.ChevRight size={13} />
          </button>
        ) : (
          <button className="btn btn--primary" onClick={finish}>
            <Icon.Check size={13} /> Guardar y terminar
          </button>
        )}
      </footer>
    </div>
  );
}
