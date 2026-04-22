import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { ConnectAuthProvider, useConnectAuth } from "@/context/ConnectAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import { ExternalLink, LogIn } from "lucide-react";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentDesktopPage } from "@/pages/AgentDesktopPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RecordingsPage } from "@/pages/RecordingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { CampaignDetailPage } from "@/pages/CampaignDetailPage";
import { QueueManagerPage } from "@/pages/QueueManagerPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { Sparkles, Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-background to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
      <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-purple-300/30 blur-3xl animate-pulse" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative flex flex-col items-center gap-6"
      >
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/30"
        >
          <Sparkles className="h-8 w-8 text-white" />
        </motion.div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Connectview</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your intelligent contact center workspace
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs font-medium text-muted-foreground">
            Connecting to Amazon Connect...
          </span>
        </div>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          A login popup may appear. Please allow popups for this site to
          authenticate.
        </p>
      </motion.div>
    </div>
  );
}

function LoginScreen() {
  // When the user returns from the Connect login tab, auto-reload so the CCP
  // iframe picks up the fresh session cookies.
  useEffect(() => {
    const onFocus = () => {
      // Only reload if the user has been away for at least a couple of seconds
      // (i.e. they actually left the tab to log in).
      window.location.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const openLogin = () => {
    // Opening in response to a user click — Chrome allows it. The popup variant
    // tends to get blocked by SSO IdPs, so we use a plain new tab.
    window.open(`${CONNECT_INSTANCE_URL}/ccp-v2`, "_blank", "noopener");
  };

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-background to-purple-50 p-8 dark:from-indigo-950/20 dark:to-purple-950/20">
      <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-purple-300/30 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow">
          <LogIn className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">
          Inicia sesión en Amazon Connect
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Para usar Connectview necesitas tener una sesión activa en tu
          instancia de Amazon Connect. Haz clic abajo, inicia sesión en la
          pestaña que se abre, y regresa aquí — esta página se recargará
          automáticamente.
        </p>

        <button
          onClick={openLogin}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg"
        >
          <ExternalLink className="h-4 w-4" />
          Iniciar sesión en Connect
        </button>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Tip:</strong> mantén esa pestaña abierta mientras usas
          Connectview — la sesión se comparte automáticamente.
        </div>

        <button
          onClick={() => window.location.reload()}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Ya inicié sesión · reintentar
        </button>
      </motion.div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/50">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">Connection Error</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Retry Connection
        </button>
      </motion.div>
    </div>
  );
}

// Animated page wrapper
function AnimatedRoutes() {
  const location = useLocation();
  const { showHelp, setShowHelp } = useKeyboardShortcuts();

  return (
    <>
      <CommandPalette />
      <ShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Routes location={location}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agent" element={<AgentDesktopPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/recordings" element={<RecordingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
            <Route path="/queue" element={<QueueManagerPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function AppContent() {
  const { user, loading, error, needsLogin, ccpContainerRef } = useConnectAuth();

  return (
    <>
      <div
        id="global-ccp-host"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          overflow: "hidden",
          zIndex: -1,
        }}
      >
        <div ref={ccpContainerRef} id="ccp-container" />
      </div>

      {!user && needsLogin && <LoginScreen />}
      {!user && !needsLogin && loading && <LoadingScreen />}
      {!user && !needsLogin && !loading && error && <ErrorScreen error={error} />}

      {user && (
        <BrowserRouter>
          <TooltipProvider>
            <SidebarProvider>
              <AppLayout>
                <AnimatedRoutes />
              </AppLayout>
            </SidebarProvider>
          </TooltipProvider>
        </BrowserRouter>
      )}

      <Toaster position="top-right" richColors closeButton />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ConnectAuthProvider>
        <AppContent />
      </ConnectAuthProvider>
    </ThemeProvider>
  );
}
