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
          Start Date
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
          End Date
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
          Agent
        </label>
        <Input
          placeholder="Agent username"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Queue
        </label>
        <Select value={queue} onValueChange={(v) => setQueue(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All queues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Queues</SelectItem>
            <SelectItem value="BasicQueue">BasicQueue</SelectItem>
            <SelectItem value="SalesQueue">SalesQueue</SelectItem>
            <SelectItem value="SupportQueue">SupportQueue</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Sentiment
        </label>
        <Select value={sentiment} onValueChange={(v) => setSentiment(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="POSITIVE">Positive</SelectItem>
            <SelectItem value="NEGATIVE">Negative</SelectItem>
            <SelectItem value="NEUTRAL">Neutral</SelectItem>
            <SelectItem value="MIXED">Mixed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSearch} disabled={loading}>
        <Search className="mr-2 h-4 w-4" />
        Search
      </Button>
    </div>
  );
}
