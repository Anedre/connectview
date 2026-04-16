import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { RoleGate } from "@/components/layout/RoleGate";
import {
  Headset,
  Activity,
  BarChart3,
  Settings,
  Disc,
  TrendingUp,
  Phone,
  Users,
  Clock,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { GamificationCard } from "@/components/dashboard/GamificationCard";
import { WellnessCard } from "@/components/dashboard/WellnessCard";
import { ChurnRiskCard } from "@/components/dashboard/ChurnRiskCard";

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  path: string;
  delay: number;
}

function QuickActionCard({
  title,
  description,
  icon: Icon,
  color,
  path,
  delay,
}: QuickActionProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className="group relative overflow-hidden rounded-xl border bg-card p-6 text-left transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`absolute -right-6 -top-6 h-24 w-24 rounded-full ${color} opacity-10 transition-all duration-500 group-hover:scale-150 group-hover:opacity-20`}
      />
      <div className="relative">
        <div
          className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${color} text-white shadow-lg transition-transform duration-300 group-hover:scale-110`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="mb-1 font-semibold tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-4 flex items-center text-sm font-medium text-primary transition-all group-hover:gap-1">
          <span>Open</span>
          <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: "up" | "down" | "neutral";
  icon: React.ElementType;
  gradient: string;
  delay: number;
}

function StatCard({
  label,
  value,
  change,
  changeType,
  icon: Icon,
  gradient,
  delay,
}: StatCardProps) {
  const changeColor =
    changeType === "up"
      ? "text-emerald-600"
      : changeType === "down"
      ? "text-rose-600"
      : "text-muted-foreground";

  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-card p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-lg animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`absolute right-0 top-0 h-full w-24 bg-gradient-to-l ${gradient} opacity-5 transition-opacity group-hover:opacity-10`}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          {change && (
            <div className={`mt-1 flex items-center gap-1 text-xs ${changeColor}`}>
              <TrendingUp className="h-3 w-3" />
              <span className="font-medium">{change}</span>
            </div>
          )}
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} text-white shadow-sm`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { metrics } = useRealtimeMetrics();

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 p-8 text-white shadow-xl shadow-indigo-600/20">
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-purple-400/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-white/80">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">{greeting}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Welcome back, {user?.username || "Agent"}
          </h1>
          <p className="mt-2 max-w-xl text-white/80">
            Here's what's happening in your contact center today. Everything
            running smoothly.
          </p>
        </div>
      </div>

      {/* Stats row - visible to supervisors+ */}
      <RoleGate minRole="Supervisors">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="In Queue"
            value={metrics?.summary.totalContactsInQueue ?? 0}
            change="Live"
            changeType="neutral"
            icon={Phone}
            gradient="from-blue-500 to-indigo-600"
            delay={0}
          />
          <StatCard
            label="Agents Available"
            value={metrics?.summary.totalAgentsAvailable ?? 0}
            change={`of ${metrics?.summary.totalAgentsOnline ?? 0} online`}
            changeType="neutral"
            icon={Users}
            gradient="from-emerald-500 to-teal-600"
            delay={80}
          />
          <StatCard
            label="Agents Online"
            value={metrics?.summary.totalAgentsOnline ?? 0}
            change="Active now"
            changeType="up"
            icon={Activity}
            gradient="from-amber-500 to-orange-600"
            delay={160}
          />
          <StatCard
            label="Longest Wait"
            value={`${metrics?.summary.longestWaitSeconds ?? 0}s`}
            icon={Clock}
            gradient="from-rose-500 to-pink-600"
            delay={240}
          />
        </div>
      </RoleGate>

      {/* Premium insights cards */}
      <RoleGate minRole="Agents">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="animate-fade-in-up" style={{ animationDelay: "280ms" }}>
            <GamificationCard />
          </div>
          <div className="animate-fade-in-up" style={{ animationDelay: "360ms" }}>
            <WellnessCard />
          </div>
          <RoleGate minRole="Supervisors">
            <div className="animate-fade-in-up" style={{ animationDelay: "440ms" }}>
              <ChurnRiskCard />
            </div>
          </RoleGate>
        </div>
      </RoleGate>

      {/* Quick actions */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Quick Actions
          </h2>
          <p className="text-sm text-muted-foreground">
            Jump to your most-used tools
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <QuickActionCard
            title="Agent Desktop"
            description="Handle calls, chats, and emails with full agent workspace"
            icon={Headset}
            color="bg-gradient-to-br from-emerald-500 to-teal-600"
            path="/agent"
            delay={0}
          />

          <RoleGate minRole="Supervisors">
            <QuickActionCard
              title="Real-time Monitoring"
              description="Live queue metrics, agent status, and SLA tracking"
              icon={Activity}
              color="bg-gradient-to-br from-amber-500 to-orange-600"
              path="/monitoring"
              delay={80}
            />
          </RoleGate>

          <RoleGate minRole="Supervisors">
            <QuickActionCard
              title="Reports & Analytics"
              description="Contact Lens insights, sentiment trends, and history"
              icon={BarChart3}
              color="bg-gradient-to-br from-purple-500 to-pink-600"
              path="/reports"
              delay={160}
            />
          </RoleGate>

          <RoleGate minRole="Supervisors">
            <QuickActionCard
              title="Call Recordings"
              description="Search, playback, and review with AI transcription"
              icon={Disc}
              color="bg-gradient-to-br from-pink-500 to-rose-600"
              path="/recordings"
              delay={240}
            />
          </RoleGate>

          <RoleGate minRole="Admins">
            <QuickActionCard
              title="Administration"
              description="Manage users, security profiles, and system settings"
              icon={Settings}
              color="bg-gradient-to-br from-rose-500 to-red-600"
              path="/admin"
              delay={320}
            />
          </RoleGate>
        </div>
      </div>

      {/* Info card */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-Powered Features
          </CardTitle>
          <CardDescription>
            Connectview includes built-in AI assistance powered by Amazon
            Bedrock and Amazon Q in Connect
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="font-medium">Live Contact Lens</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Real-time transcript with sentiment analysis during calls
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="font-medium">AI Call Summaries</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Auto-generated summaries and wrap-up codes with Claude
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="font-medium">Unified History</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Multi-channel customer timeline across voice, chat, email, task
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
