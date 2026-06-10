import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      className="view"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "calc(100vh - var(--header-h))",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          className="mono"
          style={{
            fontSize: 96,
            fontWeight: 500,
            letterSpacing: "-0.04em",
            color: "var(--text-3)",
            lineHeight: 1,
          }}
        >
          404
        </div>
        <h2
          style={{
            marginTop: 12,
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-1)",
          }}
        >
          Página no encontrada
        </h2>
        <p
          style={{
            marginTop: 6,
            fontSize: 13,
            color: "var(--text-2)",
            maxWidth: 320,
          }}
        >
          La ruta que intentaste abrir no existe en AIRA.
        </p>
        <button
          className="btn btn--primary"
          style={{ marginTop: 18 }}
          onClick={() => navigate("/")}
        >
          Volver al inicio
        </button>
      </div>
    </div>
  );
}
