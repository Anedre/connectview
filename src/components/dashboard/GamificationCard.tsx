import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Award, TrendingUp, Flame, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAgentLeaderboard } from "@/hooks/useAgentLeaderboard";

// Badges derived from live leaderboard badge counts (real aggregations, not hard-coded).
const BADGE_META = [
  { key: "onFire" as const, icon: Flame, label: "On Fire", color: "from-orange-400 to-red-500" },
  { key: "topCsat" as const, icon: Award, label: "Top CSAT", color: "from-amber-400 to-yellow-500" },
  { key: "risingStar" as const, icon: TrendingUp, label: "Rising Star", color: "from-emerald-400 to-teal-500" },
];

export function GamificationCard() {
  const { data, loading, error } = useAgentLeaderboard(7, 4);

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-amber-400/20 to-orange-500/20 blur-2xl" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow">
              <Trophy className="h-4 w-4" />
            </div>
            Team Leaderboard
          </CardTitle>
          <span className="text-xs text-muted-foreground">This week</span>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-3">
        {/* Badges row — real counts */}
        <div className="flex gap-2">
          {BADGE_META.map((badge, i) => (
            <motion.div
              key={badge.label}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.1, type: "spring" }}
              className="flex flex-1 items-center gap-2 rounded-lg border bg-card/50 p-2"
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${badge.color} text-white shadow`}
              >
                <badge.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">
                  {badge.label}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {data?.badges?.[badge.key] ?? 0} earned
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="space-y-1 min-h-[88px]">
          {loading && !data && (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading leaderboard...
            </div>
          )}
          {error && !data && (
            <p className="py-4 text-center text-xs text-rose-600">
              {error}
            </p>
          )}
          {data && data.leaderboard.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No contacts in the last {data.rangeDays} days yet.
            </p>
          )}
          {data?.leaderboard.map((agent, i) => {
            const isUp = agent.changePct >= 0;
            const changeLabel =
              agent.changePct === 0
                ? "—"
                : `${agent.changePct >= 0 ? "+" : ""}${agent.changePct}%`;
            return (
              <motion.div
                key={agent.agentId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50 ${
                  agent.rank === 1 ? "bg-gradient-to-r from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20" : ""
                }`}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    agent.rank === 1
                      ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white"
                      : agent.rank === 2
                      ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white"
                      : agent.rank === 3
                      ? "bg-gradient-to-br from-orange-300 to-orange-400 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {agent.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {agent.username}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {agent.contactCount} contacts · {agent.totalMinutes}m
                  </div>
                </div>
                <div className="text-xs font-semibold tabular-nums">
                  {agent.contactCount.toLocaleString()}
                </div>
                <div
                  className={`text-[10px] font-medium ${
                    agent.changePct === 0
                      ? "text-muted-foreground"
                      : isUp
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {changeLabel}
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
