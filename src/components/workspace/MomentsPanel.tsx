import { useMemo } from "react";
import type { LiveTranscriptData } from "@/types/live-transcript";
import { Card } from "@/components/aria";

/**
 * "Momentos clave" — hitos de Contact Lens durante una llamada de VOZ.
 *
 * Contact Lens marca dos tipos de eventos no-transcripción en el mismo
 * stream que usamos para la transcripción en vivo:
 *   • type: "category" → una categoría de reglas coincidió (p.ej. "Objeción",
 *     "Competidor mencionado", "Escalamiento").
 *   • type: "issue"    → detectó un "issue" (problema/motivo) en el habla.
 *
 * Este panel los extrae del MISMO `liveData` real (no hay data mock). Si no
 * hay ningún momento aún, el componente devuelve null y el llamador NO lo
 * renderiza — nada de placeholders inventados.
 */

function fmtOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Moment {
  key: string;
  t: string;
  label: string;
  tone: string;
  begin: number;
}

export function MomentsPanel({
  liveData,
}: {
  liveData: LiveTranscriptData | null | undefined;
}) {
  const moments = useMemo<Moment[]>(() => {
    const segs = liveData?.segments ?? [];
    const out: Moment[] = [];
    segs.forEach((s, i) => {
      if (s.type === "category" && s.categoryName) {
        out.push({
          key: `cat-${i}`,
          t: fmtOffset(s.beginOffsetMs),
          label: s.categoryName,
          tone: "var(--iris)",
          begin: s.beginOffsetMs,
        });
      } else if (s.type === "issue" && s.issueText) {
        out.push({
          key: `iss-${i}`,
          t: fmtOffset(s.beginOffsetMs),
          label: s.issueText,
          tone: "var(--gold)",
          begin: s.beginOffsetMs,
        });
      }
    });
    // Orden cronológico por offset dentro de la llamada.
    return out.sort((a, b) => a.begin - b.begin);
  }, [liveData?.segments]);

  if (moments.length === 0) return null;

  return (
    <Card title="Momentos clave" icon="target">
      <div className="col" style={{ gap: 2 }}>
        {moments.map((m) => (
          <div key={m.key} className="moment">
            <span
              className="mono muted"
              style={{ fontSize: 12, width: 34, flex: "0 0 auto" }}
            >
              {m.t}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: m.tone,
                flex: "0 0 auto",
                marginTop: 5,
              }}
            />
            <span style={{ fontSize: 12.5, flex: 1, lineHeight: 1.4 }}>
              {m.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
