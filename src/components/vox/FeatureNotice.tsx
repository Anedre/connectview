import { useFeature, type FeatureId } from "@/hooks/useFeatureStatus";
import * as Icon from "@/components/vox/primitives";

/**
 * FeatureNotice — aviso inline que aparece EN una sección cuando la feature de
 * Amazon Connect que esa sección necesita está apagada o sin verificar.
 * Ej.: en Reportes <FeatureNotice feature="contactLens" /> avisa si no hay
 * Contact Lens (sin él no hay transcripciones ni sentiment). Si la feature
 * está OK (o no se pudo diagnosticar) no renderiza nada.
 */
export function FeatureNotice({
  feature,
  className,
  style,
}: {
  feature: FeatureId;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { status, check } = useFeature(feature);
  if (status === "ok" || status === "unknown" || !check) return null;

  const color = status === "error" ? "var(--accent-red)" : "var(--accent-amber)";
  return (
    <div
      className={className}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 14,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        fontSize: 12.5,
        lineHeight: 1.5,
        ...style,
      }}
    >
      <Icon.Lightning size={15} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: "var(--text-1)" }}>{check.label}: </span>
        <span style={{ color: "var(--text-2)" }}>
          {check.detail}
          {check.remediation ? ` ${check.remediation}` : ""}
        </span>
        {check.link && (
          <a
            href={check.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-cyan)", fontWeight: 600, marginLeft: 6, whiteSpace: "nowrap" }}
          >
            Activar en mi consola →
          </a>
        )}
      </div>
    </div>
  );
}
