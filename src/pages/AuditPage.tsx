import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Btn, Card, Stat, Pill, Icon, HeroBand, Num } from "@/components/aria";

/**
 * AuditPage (/audit) — panel del AUDITOR de frontend para la prueba en vivo con
 * agentes. Hace GET al endpoint de auditoría cada 3s (auto-refresh con toggle de
 * pausa) y muestra los eventos capturados por `lib/auditLogger` (errores JS,
 * promesas colgadas, console.error/warn, HTTP >=400 y eventos del softphone).
 *
 * Solo lectura: no muta nada. Si el endpoint aún no está cableado en el backend
 * (`getApiEndpoints().auditLog` undefined), muestra un estado "sin conectar".
 */

interface AuditRow {
  sessionId?: string;
  seq?: number;
  ts: string;
  source?: string;
  level?: string;
  kind?: string;
  message?: string;
  detail?: unknown;
}

/** Acceso tolerante: no depende de que `auditLog` ya esté en ApiEndpoints (el
 *  backend lo agrega en paralelo). undefined = endpoint aún no cableado. */
function auditEndpoint(): string | undefined {
  const ep = getApiEndpoints();
  if (!ep) return undefined;
  return (ep as { auditLog?: string }).auditLog;
}

const LEVEL_TONE: Record<string, "red" | "gold" | "outline"> = {
  error: "red",
  warn: "gold",
  info: "outline",
};
const LEVEL_LABEL: Record<string, string> = {
  error: "Error",
  warn: "Alerta",
  info: "Info",
};

const selectStyle: CSSProperties = {
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--border-1)",
  background: "var(--bg-2)",
  color: "var(--text-1)",
  fontSize: 12.5,
  padding: "0 8px",
  cursor: "pointer",
};

const kindChipStyle: CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--cyan) 14%, transparent)",
  color: "var(--cyan)",
  fontSize: 10.5,
  fontWeight: 650,
  border: "1px solid color-mix(in srgb, var(--cyan) 30%, transparent)",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const GRID = "94px 150px 92px 118px minmax(0,1fr) 32px";

function fmtTime(ts?: string): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function rowKey(r: AuditRow, i: number): string {
  return `${r.sessionId ?? ""}#${r.seq ?? ""}#${r.ts ?? ""}#${i}`;
}

function safeJson(r: AuditRow): string {
  try {
    return JSON.stringify(r, null, 2);
  } catch {
    return String(r?.message ?? "");
  }
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notWired, setNotWired] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const [levelF, setLevelF] = useState<string>("all");
  const [kindF, setKindF] = useState<string>("all");
  const [sourceF, setSourceF] = useState<string>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const ep = auditEndpoint();
    if (!ep) {
      setNotWired(true);
      setLoading(false);
      return;
    }
    setNotWired(false);
    try {
      const url = ep + (ep.includes("?") ? "&" : "?") + "limit=500";
      const r = await authedFetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = (await r.json()) as { events?: AuditRow[] };
      setRows(Array.isArray(j?.events) ? j.events : []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar la auditoría");
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial.
  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh cada 3s salvo que esté pausado.
  useEffect(() => {
    if (paused) return;
    const iv = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(iv);
  }, [load, paused]);

  const counts = useMemo(() => {
    let error = 0;
    let warn = 0;
    let info = 0;
    for (const r of rows) {
      if (r.level === "error") error++;
      else if (r.level === "warn") warn++;
      else if (r.level === "info") info++;
    }
    return { total: rows.length, error, warn, info };
  }, [rows]);

  const kinds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.kind).filter((x): x is string => !!x))).sort(),
    [rows],
  );
  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source).filter((x): x is string => !!x))).sort(),
    [rows],
  );

  const ordered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (levelF !== "all" && r.level !== levelF) return false;
      if (kindF !== "all" && r.kind !== kindF) return false;
      if (sourceF !== "all" && r.source !== sourceF) return false;
      if (needle && !(r.message || "").toLowerCase().includes(needle)) return false;
      return true;
    });
    // Más recientes primero (los ISO ordenan cronológicamente como texto).
    return filtered.sort((a, b) => {
      const ax = a.ts || "";
      const bx = b.ts || "";
      if (ax !== bx) return ax < bx ? 1 : -1;
      return (b.seq ?? 0) - (a.seq ?? 0);
    });
  }, [rows, levelF, kindF, sourceF, q]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const downloadJson = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(ordered, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      /* noop */
    }
  }, [ordered]);

  const levelTabs = [
    { id: "all", label: "Todos", n: counts.total },
    { id: "error", label: "Errores", n: counts.error },
    { id: "warn", label: "Alertas", n: counts.warn },
    { id: "info", label: "Info", n: counts.info },
  ];

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <HeroBand
        title="Auditoría en vivo"
        chip={
          paused ? (
            <>Pausado · {counts.total.toLocaleString()} eventos</>
          ) : (
            <>
              <span className="dot dot--live" /> En vivo · {counts.total.toLocaleString()} eventos
            </>
          )
        }
        chipIcon={paused ? "pause" : "live"}
        chipTone={paused ? "var(--text-3)" : "var(--green)"}
        right={
          <div className="row gap10">
            <Btn
              variant="ghost"
              size="sm"
              icon={paused ? "play" : "pause"}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Reanudar" : "Pausar"}
            </Btn>
            <Btn variant="ghost" size="sm" icon="refresh" onClick={() => void load()}>
              Actualizar
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="download"
              onClick={downloadJson}
              disabled={ordered.length === 0}
            >
              Descargar JSON
            </Btn>
          </div>
        }
      />

      {/* KPIs por nivel. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}
      >
        <Stat
          icon="gauge"
          color="var(--accent)"
          label="Eventos"
          value={<Num value={counts.total} />}
          sub="cargados"
        />
        <Stat
          icon="flame"
          color="var(--red)"
          label="Errores"
          value={<Num value={counts.error} />}
          sub={counts.error > 0 ? "requieren atención" : "sin errores"}
        />
        <Stat
          icon="bell"
          color="var(--gold)"
          label="Alertas"
          value={<Num value={counts.warn} />}
          sub="advertencias"
        />
        <Stat
          icon="checkCircle"
          color="var(--cyan)"
          label="Info"
          value={<Num value={counts.info} />}
          sub="informativos"
        />
      </div>

      <Card
        title={
          <div className="row gap6">
            {levelTabs.map((t) => (
              <button
                key={t.id}
                className={`btn btn--sm ${levelF === t.id ? "btn--soft" : "btn--ghost"}`}
                onClick={() => setLevelF(t.id)}
              >
                {t.label}
                <span className="tnum" style={{ fontSize: 10.5, marginLeft: 4, opacity: 0.7 }}>
                  {t.n}
                </span>
              </button>
            ))}
          </div>
        }
        extra={
          <div className="row gap8" style={{ flexWrap: "wrap" }}>
            <select
              style={selectStyle}
              value={kindF}
              onChange={(e) => setKindF(e.target.value)}
              aria-label="Filtrar por tipo"
            >
              <option value="all">Todos los tipos</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              style={selectStyle}
              value={sourceF}
              onChange={(e) => setSourceF(e.target.value)}
              aria-label="Filtrar por origen"
            >
              <option value="all">Todos los orígenes</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="tb__search" style={{ maxWidth: 240, height: 30 }}>
              <Icon name="search" size={13} />
              <input
                placeholder="Buscar en mensaje…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        }
        pad={false}
      >
        {/* Banner de error no bloqueante (si ya había filas, seguimos mostrándolas). */}
        {err && rows.length > 0 && (
          <div
            style={{
              margin: 16,
              marginBottom: 0,
              padding: "8px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--red) 10%, var(--bg-1))",
              color: "var(--red)",
              fontSize: 12,
            }}
          >
            Último refresco falló: {err}
          </div>
        )}

        {/* Estado: endpoint no cableado todavía. */}
        {notWired && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="shield" size={32} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 12, fontSize: 14, color: "var(--text-2)", fontWeight: 650 }}>
              El auditor aún no está conectado
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, maxWidth: 460, marginInline: "auto" }}>
              La captura ya está activa en este navegador. En cuanto el backend publique la Function
              URL de auditoría, los eventos aparecerán aquí automáticamente.
            </div>
          </div>
        )}

        {/* Cargando (primera vez). */}
        {!notWired && loading && rows.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
            Cargando eventos…
          </div>
        )}

        {/* Error total (sin filas). */}
        {!notWired && !loading && err && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="missed" size={30} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>{err}</div>
            <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
              <Btn variant="soft" size="sm" icon="refresh" onClick={() => void load()}>
                Reintentar
              </Btn>
            </div>
          </div>
        )}

        {/* Vacío elegante. */}
        {!notWired && !loading && !err && ordered.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="checkCircle" size={32} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {rows.length === 0
                ? "Sin eventos todavía. Todo tranquilo por ahora."
                : "Ningún evento coincide con los filtros."}
            </div>
          </div>
        )}

        {/* Tabla. */}
        {ordered.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 720 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border-1)",
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  color: "var(--text-3)",
                  fontWeight: 700,
                }}
              >
                <span>Hora</span>
                <span>Origen</span>
                <span>Nivel</span>
                <span>Tipo</span>
                <span>Mensaje</span>
                <span />
              </div>

              <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                {ordered.map((r, i) => {
                  const key = rowKey(r, i);
                  const open = !!expanded[key];
                  const lvl = r.level || "info";
                  return (
                    <div
                      key={key}
                      style={{
                        borderBottom:
                          "1px solid color-mix(in srgb, var(--border-1) 55%, transparent)",
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggle(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(key);
                          }
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: GRID,
                          gap: 10,
                          padding: "9px 14px",
                          alignItems: "center",
                          cursor: "pointer",
                          fontSize: 12.5,
                        }}
                      >
                        <span
                          className="tnum"
                          style={{ color: "var(--text-3)", fontSize: 11.5 }}
                          title={r.ts}
                        >
                          {fmtTime(r.ts)}
                        </span>
                        <span
                          className="trunc"
                          style={{ color: "var(--text-2)" }}
                          title={r.source || ""}
                        >
                          {r.source || "—"}
                        </span>
                        <span>
                          <Pill tone={LEVEL_TONE[lvl] || "outline"}>{LEVEL_LABEL[lvl] || lvl}</Pill>
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={kindChipStyle} title={r.kind || ""}>
                            {r.kind || "—"}
                          </span>
                        </span>
                        <span
                          className="trunc"
                          style={{ color: "var(--text-1)" }}
                          title={r.message || ""}
                        >
                          {r.message || "—"}
                        </span>
                        <span
                          style={{ display: "grid", placeItems: "center", color: "var(--text-3)" }}
                        >
                          <Icon name={open ? "chevU" : "chevD"} size={14} />
                        </span>
                      </div>
                      {open && (
                        <div style={{ padding: "0 14px 12px 14px" }}>
                          <pre
                            style={{
                              margin: 0,
                              padding: 12,
                              borderRadius: 10,
                              background: "var(--bg-2)",
                              border: "1px solid var(--border-1)",
                              color: "var(--text-2)",
                              fontSize: 11.5,
                              lineHeight: 1.5,
                              overflowX: "auto",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {safeJson(r)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
