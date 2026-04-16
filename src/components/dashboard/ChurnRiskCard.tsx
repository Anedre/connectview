import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Phone, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

const atRisk = [
  {
    name: "Juan Perez",
    phone: "+51 987 654 321",
    lastSentiment: "NEGATIVE",
    daysSinceContact: 3,
    riskScore: 92,
  },
  {
    name: "Maria Torres",
    phone: "+51 912 345 678",
    lastSentiment: "NEGATIVE",
    daysSinceContact: 7,
    riskScore: 78,
  },
  {
    name: "Carlos Mendez",
    phone: "+51 998 877 665",
    lastSentiment: "MIXED",
    daysSinceContact: 14,
    riskScore: 65,
  },
];

export function ChurnRiskCard() {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-rose-400/20 to-red-500/20 blur-2xl" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white shadow">
              <AlertTriangle className="h-4 w-4" />
            </div>
            Churn Risk
          </CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {atRisk.length} customers
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-2">
        {atRisk.map((customer, i) => (
          <motion.div
            key={customer.phone}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="group flex items-center gap-3 rounded-lg border p-2.5 transition-all hover:border-rose-300 hover:shadow-sm dark:hover:border-rose-800"
          >
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-xs font-semibold text-slate-700 dark:from-slate-700 dark:to-slate-800 dark:text-slate-200">
                {customer.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-background">
                !
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {customer.name}
                </span>
                <span className="rounded-full bg-rose-100 px-1.5 py-0 text-[9px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  {customer.riskScore}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {customer.daysSinceContact}d ago · {customer.lastSentiment}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Phone className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        ))}
        <Button variant="ghost" size="sm" className="mt-2 w-full text-xs">
          View all at-risk customers
          <ArrowUpRight className="ml-1 h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}
