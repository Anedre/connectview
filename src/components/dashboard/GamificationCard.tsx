import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Award, TrendingUp, Flame } from "lucide-react";
import { motion } from "framer-motion";

const badges = [
  { icon: Flame, label: "On Fire", count: 12, color: "from-orange-400 to-red-500" },
  { icon: Award, label: "Top CSAT", count: 8, color: "from-amber-400 to-yellow-500" },
  { icon: TrendingUp, label: "Rising Star", count: 3, color: "from-emerald-400 to-teal-500" },
];

const leaderboard = [
  { rank: 1, name: "Patricia Fernandez", score: 2450, change: "+12%" },
  { rank: 2, name: "Andre-Alata", score: 2180, change: "+8%" },
  { rank: 3, name: "Willy Luyo", score: 1920, change: "+5%" },
  { rank: 4, name: "Miguel Vega", score: 1750, change: "-2%" },
];

export function GamificationCard() {
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
        {/* Badges row */}
        <div className="flex gap-2">
          {badges.map((badge, i) => (
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
                  {badge.count} earned
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="space-y-1">
          {leaderboard.map((agent, i) => {
            const isUp = agent.change.startsWith("+");
            return (
              <motion.div
                key={agent.name}
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
                    {agent.name}
                  </div>
                </div>
                <div className="text-xs font-semibold tabular-nums">
                  {agent.score.toLocaleString()}
                </div>
                <div
                  className={`text-[10px] font-medium ${
                    isUp ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {agent.change}
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
