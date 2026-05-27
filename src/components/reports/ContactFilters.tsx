import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import type { ContactFilters as FilterType } from "@/types/monitoring";
import { useQueues } from "@/hooks/useQueues";

interface ContactFiltersProps {
  onSearch: (filters: FilterType) => void;
  loading?: boolean;
}

export function ContactFilters({ onSearch, loading }: ContactFiltersProps) {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .split("T")[0];

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [agent, setAgent] = useState("");
  const [queue, setQueue] = useState("all");
  const [sentiment, setSentiment] = useState("all");

  // Bug #14 — the dropdown used to be hardcoded to the Connect demo
  // queues (BasicQueue/SalesQueue/SupportQueue). Now we pull the real
  // queues from listQueues so Reports matches /queue and /admin.
  const { queues } = useQueues();

  const handleSearch = () => {
    onSearch({
      startDate: `${startDate}T00:00:00Z`,
      endDate: `${endDate}T23:59:59Z`,
      agentUsername: agent || undefined,
      queueName: queue !== "all" ? queue : undefined,
      sentiment: sentiment !== "all" ? sentiment : undefined,
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Inicio
        </label>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Fin
        </label>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Agente
        </label>
        <Input
          placeholder="Username del agente"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Cola
        </label>
        <Select value={queue} onValueChange={(v) => setQueue(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Todas las colas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las colas</SelectItem>
            {queues.map((q) => (
              <SelectItem key={q.id} value={q.name}>
                {q.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Sentiment
        </label>
        <Select value={sentiment} onValueChange={(v) => setSentiment(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="POSITIVE">Positivo</SelectItem>
            <SelectItem value="NEGATIVE">Negativo</SelectItem>
            <SelectItem value="NEUTRAL">Neutral</SelectItem>
            <SelectItem value="MIXED">Mixto</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSearch} disabled={loading}>
        <Search className="mr-2 h-4 w-4" />
        Buscar
      </Button>
    </div>
  );
}
