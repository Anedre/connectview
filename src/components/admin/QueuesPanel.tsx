import { useQueues } from "@/hooks/useQueues";
import * as Icon from "@/components/vox/primitives";

/**
 * QueuesPanel — "Configuración → Colas". Lista las colas del Amazon Connect del
 * tenant (read-only, vía el endpoint list-queues / rol cross-account). Las colas
 * se crean y editan en Connect; acá se ven para asignarlas a campañas, rutear
 * contactos y verificar el onboarding (el flow ARIA-Outbound rutea a una de estas).
 *
 * Antes esta sección mostraba "Próximamente" aunque ya leíamos las colas — esto
 * cierra esa incoherencia.
 */
export function QueuesPanel() {
  const { queues, loading, error } = useQueues();

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>Colas de Amazon Connect</div>
        {queues.length > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--accent-cyan)",
              background: "var(--accent-cyan-soft)",
              borderRadius: 999,
              padding: "2px 10px",
            }}
          >
            {queues.length}
          </span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
        Se leen en vivo desde tu instancia de Connect. Las usás para rutear campañas
        y transferencias. Para crear o editar colas, andá a tu consola de Amazon Connect.
      </div>

      {loading && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          Cargando colas…
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 12.5,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
          }}
        >
          No se pudieron leer las colas: {error}
        </div>
      )}

      {!loading && !error && queues.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No encontramos colas. Verificá que tu Amazon Connect esté conectado
          (Integraciones) y que tenga al menos una cola.
        </div>
      )}

      {queues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queues.map((q) => (
            <div
              key={q.id}
              className="row"
              style={{
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: "var(--accent-cyan-soft)",
                  color: "var(--accent-cyan)",
                }}
              >
                <Icon.Queue size={14} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>
                {q.name}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--text-3)",
                  background: "var(--bg-1)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {q.type === "STANDARD" ? "Estándar" : q.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
