import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Phone, ArrowUpRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useChurnRisk } from "@/hooks/useChurnRisk";

function formatInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ChurnRiskCard() {
  const { data, loading, error } = useChurnRisk(30, 5, 40);

  const count = data?.atRisk.length ?? 0;

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-[var(--accent-red)] to-[var(--accent-red-soft)] blur-2xl" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent-red)] to-[var(--accent-red-soft)] text-white shadow">
              <AlertTriangle className="h-4 w-4" />
            </div>
            Churn Risk
          </CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-red-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-red)]">
            {count} customer{count === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-2 min-h-[160px]">
        {loading && !data && (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            Analyzing customers...
          </div>
        )}
        {error && !data && (
          <p className="py-4 text-center text-xs text-[var(--accent-red)]">{error}</p>
        )}
        {data && data.atRisk.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No at-risk customers detected in the last {data.rangeDays} days.
            <br />
            <span className="opacity-70">
              {data.totalCustomersAnalyzed} customer
              {data.totalCustomersAnalyzed === 1 ? "" : "s"} analyzed.
            </span>
          </p>
        )}
        {data?.atRisk.map((customer, i) => (
          <motion.div
            key={customer.customerPhone}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="group flex items-center gap-3 rounded-lg border p-2.5 transition-all hover:border-[var(--accent-red)] hover:shadow-sm"
          >
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-3)] text-xs font-semibold text-[var(--text-2)]">
                {formatInitials(customer.name) || "?"}
              </div>
              <div className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-red)] text-[9px] font-bold text-white ring-2 ring-background">
                !
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {customer.name}
                </span>
                <span className="rounded-full bg-[var(--accent-red-soft)] px-1.5 py-0 text-[9px] font-bold text-[var(--accent-red)]">
                  {customer.riskScore}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {customer.daysSinceContact === 0
                  ? "today"
                  : `${customer.daysSinceContact}d ago`}{" "}
                · {customer.lastSentiment} · {customer.contactCount} call
                {customer.contactCount === 1 ? "" : "s"}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => {
                window.location.href = `tel:${customer.customerPhone}`;
              }}
            >
              <Phone className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        ))}
        {data && data.atRisk.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 w-full text-xs">
            View all at-risk customers
            <ArrowUpRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
