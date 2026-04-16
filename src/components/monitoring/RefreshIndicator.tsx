import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

interface RefreshIndicatorProps {
  lastRefresh: Date;
  onRefresh: () => void;
  loading?: boolean;
}

export function RefreshIndicator({
  lastRefresh,
  onRefresh,
  loading,
}: RefreshIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
      </span>
      <span className="text-xs">(auto-refresh 15s)</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
