import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Btn } from "@/components/aria";
import { DateRangePicker, type DateRange } from "@/components/reports/DateRangePicker";
import { Autocomplete, type AutoOption } from "@/components/reports/Autocomplete";
import type { ContactFilters as FilterType } from "@/types/monitoring";
import { useQueues } from "@/hooks/useQueues";
import { useUsers } from "@/hooks/useUsers";

/**
 * ContactFilters — la barra de control ÚNICA de Reportes (premium, lenguaje ARIA).
 * Fusiona el rango de fechas (DateRangePicker con presets + calendario, antes un
 * control aparte y duplicado) con los filtros finos (agente / cola / sentimiento).
 * Antes eran inputs de fecha nativos + selects shadcn crudos que se veían planos y
 * chocaban con el resto de la página.
 */

interface ContactFiltersProps {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  onSearch: (filters: FilterType) => void;
  loading?: boolean;
}

const fieldStyle: CSSProperties = {
  height: 38,
  padding: "0 11px",
  borderRadius: 10,
  border: "1px solid var(--border-2)",
  background: "var(--bg-1)",
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
  minWidth: 0,
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function ContactFilters({ range, onRangeChange, onSearch, loading }: ContactFiltersProps) {
  const [agent, setAgent] = useState("");
  const [queue, setQueue] = useState("all");
  const [sentiment, setSentiment] = useState("all");

  // Bug #14 — colas reales de listQueues (antes hardcodeadas a las demo de Connect).
  const { queues } = useQueues();
  // Agentes reales de Connect → sugerencias del autocomplete de "Agente".
  const { users } = useUsers();
  const agentOptions = useMemo<AutoOption[]>(
    () =>
      users
        .map((u) => ({
          value: u.username,
          label: u.username,
          sub: [u.firstName, u.lastName].filter(Boolean).join(" ") || undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users],
  );

  const handleSearch = () => {
    onSearch({
      startDate: range.start.toISOString(),
      endDate: range.end.toISOString(),
      agentUsername: agent || undefined,
      queueName: queue !== "all" ? queue : undefined,
      sentiment: sentiment !== "all" ? sentiment : undefined,
    });
  };

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 14,
        padding: "14px 16px",
        background:
          "radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--cyan) 5%, var(--bg-1)) 0%, var(--bg-1) 60%)",
      }}
    >
      <Field label="Período">
        <DateRangePicker value={range} onChange={onRangeChange} />
      </Field>

      <div style={{ width: 190 }}>
        <Autocomplete
          label="Agente"
          value={agent}
          onChange={setAgent}
          options={agentOptions}
          placeholder="Username del agente"
          flex="1 1 auto"
          height={38}
          onEnter={handleSearch}
        />
      </div>

      <Field label="Cola">
        <select
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
          style={{ ...fieldStyle, width: 160, cursor: "pointer" }}
          aria-label="Filtrar por cola"
        >
          <option value="all">Todas las colas</option>
          {queues.map((q) => (
            <option key={q.id} value={q.name}>
              {q.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Sentimiento">
        <select
          value={sentiment}
          onChange={(e) => setSentiment(e.target.value)}
          style={{ ...fieldStyle, width: 150, cursor: "pointer" }}
          aria-label="Filtrar por sentimiento"
        >
          <option value="all">Todos</option>
          <option value="POSITIVE">Positivo</option>
          <option value="NEGATIVE">Negativo</option>
          <option value="NEUTRAL">Neutral</option>
          <option value="MIXED">Mixto</option>
        </select>
      </Field>

      <Btn variant="primary" icon="search" onClick={handleSearch} disabled={loading}>
        Buscar
      </Btn>
    </div>
  );
}
