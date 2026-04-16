import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConnectAuthProvider, useConnectAuth } from "@/context/ConnectAuthContext";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentDesktopPage } from "@/pages/AgentDesktopPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RecordingsPage } from "@/pages/RecordingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { Sparkles, Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-background to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
      {/* Decorative blobs */}
      <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-purple-300/30 blur-3xl animate-pulse" />

      <div className="relative flex flex-col items-center gap-6 animate-fade-in-up">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/30">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
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
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl animate-fade-in-up">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
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
      </div>
    </div>
  );
}

// The CCP iframe is mounted once at the app level to maintain the agent's session
// across route changes. On `/agent` route it's visible; otherwise hidden.
function AppContent() {
  const { user, loading, error, ccpContainerRef } = useConnectAuth();

  return (
    <>
      {/* Global CCP container - always mounted, visibility controlled by Agent Desktop page */}
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

      {!user && loading && <LoadingScreen />}
      {!user && !loading && error && <ErrorScreen error={error} />}

      {user && (
        <BrowserRouter>
          <TooltipProvider>
            <SidebarProvider>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/agent" element={<AgentDesktopPage />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/recordings" element={<RecordingsPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
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
    <ConnectAuthProvider>
      <AppContent />
    </ConnectAuthProvider>
  );
}
