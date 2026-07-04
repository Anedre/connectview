import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Card, CardBody } from "@/components/vox/primitives";
import { Icon } from "@/components/aria";

/**
 * PowerBiFeedPanel — "Datos en vivo (Power BI)". Muestra la URL de conexión + el
 * token por-tenant para que el cliente conecte Power BI (o Excel/Looker/Tableau)
 * a los datos de ARIA con "Obtener datos → Web". Lo alimenta get-analytics-feed
 * (modo meta, autenticado). El token es una credencial de solo lectura.
 */

interface FeedMeta {
  token: string;
  feedUrl: string;
  datasets: string[];
}

const DATASET_LABEL: Record<string, string> = {
  hsm: "Envíos de plantillas (HSM)",
  leads: "Leads",
  conversations: "Conversaciones",
  summary: "Resumen (KPIs)",
};

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar"),
  );
}

export function PowerBiFeedPanel() {
  const endpoint = getApiEndpoints()?.getAnalyticsFeed;
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [loading, setLoading] = useState(!!endpoint);
  const [err, setErr] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    authedFetch(`${endpoint}?meta=1`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) setErr(d.error);
        else setMeta(d as FeedMeta);
      })
      .catch(() => !cancelled && setErr("No se pudo cargar el feed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  if (!endpoint) {
    return (
      <Card>
        <CardBody>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            El <strong>feed de datos para Power BI</strong> se habilita al desplegar el backend{" "}
            <code>get-analytics-feed</code>.
          </div>
        </CardBody>
      </Card>
    );
  }

  const datasetUrl = (d: string) =>
    meta ? `${meta.feedUrl}?token=${encodeURIComponent(meta.token)}&dataset=${d}` : "";

  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>
          Datos en vivo · Power BI
        </div>
        <div
          className="muted"
          style={{ fontSize: 12.5, marginTop: 3, maxWidth: 720, lineHeight: 1.5 }}
        >
          Conectá <strong>Power BI</strong> (o Excel, Looker, Tableau…) a los datos de ARIA para
          armar tus propios tableros, que se <strong>refrescan solos</strong>. En Power BI:{" "}
          <strong>Obtener datos → Web</strong> y pegá una de estas URLs.
        </div>
      </div>

      {loading && !meta && (
        <div className="muted" style={{ fontSize: 13, padding: "12px 2px" }}>
          Cargando datos de conexión…
        </div>
      )}
      {err && (
        <Card>
          <CardBody>
            <div style={{ color: "var(--accent-red)", fontSize: 13 }}>{err}</div>
          </CardBody>
        </Card>
      )}

      {meta && (
        <>
          {/* Token */}
          <Card>
            <CardBody>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  color: "var(--text-3)",
                  marginBottom: 8,
                }}
              >
                Tu token de acceso
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <code
                  style={{
                    flex: 1,
                    minWidth: 220,
                    fontSize: 12.5,
                    padding: "8px 12px",
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                    letterSpacing: reveal ? 0 : "0.15em",
                  }}
                >
                  {reveal ? meta.token : "•".repeat(Math.min(40, meta.token.length))}
                </code>
                <button className="btn btn--sm" onClick={() => setReveal((v) => !v)}>
                  <Icon name="eye" size={13} /> {reveal ? "Ocultar" : "Mostrar"}
                </button>
                <button className="btn btn--sm" onClick={() => copy(meta.token, "Token")}>
                  <Icon name="copy" size={13} /> Copiar
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                Es una <strong>credencial de solo lectura</strong> de tu cuenta. Tratala como una
                contraseña: no la compartas ni la subas a repos. Cualquiera con esta URL puede leer
                estos datos.
              </div>
            </CardBody>
          </Card>

          {/* Datasets */}
          <Card>
            <CardBody flush>
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-1)",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                Datasets disponibles
              </div>
              {meta.datasets.map((d) => (
                <div
                  key={d}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 16px",
                    borderBottom: "1px solid var(--border-1)",
                  }}
                >
                  <div style={{ minWidth: 190, flex: "0 0 auto" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{DATASET_LABEL[d] || d}</div>
                    <div
                      className="muted"
                      style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}
                    >
                      dataset={d}
                    </div>
                  </div>
                  <code
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11.5,
                      color: "var(--text-2)",
                      overflowX: "auto",
                      whiteSpace: "nowrap",
                      padding: "6px 10px",
                      background: "var(--bg-2)",
                      borderRadius: 6,
                    }}
                  >
                    {reveal ? datasetUrl(d) : `${meta.feedUrl}?token=•••&dataset=${d}`}
                  </code>
                  <button
                    className="btn btn--sm"
                    onClick={() => copy(datasetUrl(d), "URL")}
                    style={{ flex: "0 0 auto" }}
                  >
                    <Icon name="copy" size={13} /> Copiar URL
                  </button>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Instrucciones */}
          <Card>
            <CardBody>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                <strong>Cómo conectarlo en Power BI:</strong>
                <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  <li>
                    Power BI Desktop → <strong>Inicio → Obtener datos → Web</strong>.
                  </li>
                  <li>
                    Pegá la URL de un dataset (botón «Copiar URL») y aceptá con acceso{" "}
                    <strong>Anónimo</strong>.
                  </li>
                  <li>
                    Power BI abre el JSON: expandí <code>rows</code> a tabla y listo.
                  </li>
                  <li>
                    Para refrescar: <strong>Actualizar</strong> (o programá el refresco en el
                    servicio).
                  </li>
                </ol>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
