import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, Coffee, Zap, Brain, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAgentWellness } from "@/hooks/useAgentWellness";

interface WellnessCardProps {
  // Connect agent userId (UUID). Pass from useConnectAuth's user.userId.
  userId?: string | null;
}

function MetricBar({
  label,
  value,
  max,
  color,
  icon: Icon,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  icon: React.ElementType;
  unit?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="h-3 w-3 text-muted-foreground" />
          {label}
        </div>
        <span className="text-xs font-semibold tabular-nums">
          {value}
          {unit ? <span className="text-muted-foreground">{unit}</span> : null}
          <span className="text-muted-foreground">/{max}</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${color}`}
        />
      </div>
    </div>
  );
}

export function WellnessCard({ userId }: WellnessCardProps) {
  const { data, loading, error } = useAgentWellness(userId || null);

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-500/20 blur-2xl" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow">
              <Heart className="h-4 w-4" />
            </div>
            Bienestar del agente
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Hoy {data ? `· ${data.contactsToday} contactos` : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4 min-h-[190px]">
        {loading && !data && (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            Cargando bienestar…
          </div>
        )}
        {error && !data && (
          <p className="py-4 text-center text-xs text-rose-600">{error}</p>
        )}
        {data && (
          <>
            <MetricBar
              label="Nivel de energía"
              value={data.energy}
              max={100}
              color="from-emerald-400 to-teal-500"
              icon={Zap}
            />
            <MetricBar
              label="Tiempo de foco (min)"
              value={data.focusMinutes}
              max={480}
              color="from-blue-400 to-indigo-500"
              icon={Brain}
            />
            <MetricBar
              label="Ánimo"
              value={data.moodScore}
              max={100}
              color="from-pink-400 to-rose-500"
              icon={Heart}
            />

            {data.needsBreak ? (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                  <Coffee className="h-4 w-4" />
                  ¡Hora de un break!
                </div>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/80">
                  Llevas {data.focusMinutes} min en llamadas.
                  {data.negativeContactCount > 0
                    ? ` ${data.negativeContactCount} ${
                        data.negativeContactCount === 1
                          ? "llamada difícil"
                          : "llamadas difíciles"
                      } hoy.`
                    : ""}{" "}
                  Tómate 10 minutos.
                </p>
              </motion.div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  <Zap className="h-4 w-4" />
                  {data.contactsToday === 0
                    ? "Listo para empezar el día"
                    : "¡Estás en racha!"}
                </div>
                <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300/80">
                  {data.contactsToday === 0
                    ? "Sin contactos todavía. Que el primero cuente."
                    : `${data.contactsToday} contactos, ${data.focusMinutes} min de foco. Sigue así.`}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
