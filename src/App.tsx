import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConnectAuthProvider, useConnectAuth } from "@/context/ConnectAuthContext";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentDesktopPage } from "@/pages/AgentDesktopPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RecordingsPage } from "@/pages/RecordingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

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

      {!user && (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 p-8">
          <h1 className="text-2xl font-semibold">Connectview</h1>
          {loading && (
            <>
              <p className="text-muted-foreground">
                Connecting to Amazon Connect...
              </p>
              <p className="text-sm text-muted-foreground">
                A login popup may appear. Please allow popups for this site.
              </p>
            </>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

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
