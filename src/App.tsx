import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { ConnectAuthProvider, useConnectAuth } from "@/context/ConnectAuthContext";
import { CCPProvider } from "@/context/CCPContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { DebugHUD } from "@/components/debug/DebugHUD";
import { MissedCallNotifier } from "@/components/workspace/MissedCallNotifier";
import { ActiveContactProvider } from "@/hooks/useActiveContact";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentDesktopPage } from "@/pages/AgentDesktopPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RecordingsPage } from "@/pages/RecordingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { CampaignDetailPage } from "@/pages/CampaignDetailPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

function VoxLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        background:
          "linear-gradient(135deg, var(--accent-amber), var(--accent-pink) 70%)",
        display: "grid",
        placeItems: "center",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
      }}
    >
      <div
        style={{
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: "50%",
          background: "var(--bg-1)",
        }}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-0)",
        overflow: "hidden",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <VoxLogo size={48} />
        </motion.div>
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "var(--text-1)",
            }}
          >
            Vox<span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6, fontSize: 14 }}>CRM</span>
          </h1>
          <p
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            Plataforma de contact center
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid var(--border-1)",
            background: "var(--bg-1)",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          <span
            className="pulse"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-amber)",
              color: "var(--accent-amber)",
            }}
          />
          Conectando a Amazon Connect…
        </div>
        <p
          style={{
            maxWidth: 320,
            textAlign: "center",
            fontSize: 11,
            color: "var(--text-3)",
            margin: 0,
          }}
        >
          Es posible que se abra una ventana de inicio de sesión. Permite las
          ventanas emergentes para esta página.
        </p>
      </motion.div>
    </div>
  );
}

function LoginScreen() {
  useEffect(() => {
    const onFocus = () => {
      window.location.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const openLogin = () => {
    window.open(`${CONNECT_INSTANCE_URL}/ccp-v2`, "_blank", "noopener");
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-0)",
        padding: 32,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 12,
          padding: 32,
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <VoxLogo size={44} />
        <h2
          style={{
            marginTop: 18,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text-1)",
          }}
        >
          Inicia sesión en Amazon Connect
        </h2>
        <p
          style={{
            marginTop: 8,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--text-2)",
          }}
        >
          Para usar Vox CRM necesitas una sesión activa en tu instancia de
          Amazon Connect. Haz clic abajo, inicia sesión en la pestaña que se
          abre, y regresa aquí — esta página se recargará automáticamente.
        </p>

        <button
          onClick={openLogin}
          className="btn btn--primary"
          style={{ marginTop: 20, width: "100%", height: 40, justifyContent: "center" }}
        >
          Iniciar sesión en Connect
        </button>

        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "var(--accent-amber-soft)",
            color: "var(--accent-amber)",
            fontSize: 11.5,
            lineHeight: 1.55,
          }}
        >
          <strong>Tip:</strong> mantén esa pestaña abierta mientras usas Vox —
          la sesión se comparte automáticamente.
        </div>

        <button
          onClick={() => window.location.reload()}
          className="btn btn--ghost"
          style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
        >
          Ya inicié sesión · reintentar
        </button>
      </motion.div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-0)",
        padding: 32,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 12,
          padding: 32,
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            display: "grid",
            placeItems: "center",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          !
        </div>
        <h2 style={{ marginTop: 18, fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>
          Error de conexión
        </h2>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="btn btn--primary"
          style={{ marginTop: 16 }}
        >
          Reintentar conexión
        </button>
      </motion.div>
    </div>
  );
}

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
          /* height: 100% so the route wrapper inherits `.app__main`'s
             allocated grid row (viewport - header). Without this,
             pages with their own internal flex layouts (like the
             multi-contact AgentDesktop) grow to fit content and push
             the bottom buttons below the fold. */
          style={{ height: "100%" }}
        >
          <Routes location={location}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agent" element={<AgentDesktopPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/recordings" element={<RecordingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
            <Route path="/queue" element={<MonitoringPage />} />
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
        <CCPProvider>
          {/* Single polling source for the active contact — without
              this, every component that calls useActiveContact() spins
              up its own intervals and they race, producing visible
              parpadeo. */}
          <ActiveContactProvider>
            <BrowserRouter>
              <TooltipProvider>
                <AppLayout>
                  <AnimatedRoutes />
                </AppLayout>
                {/* Headless: fires a toast when a missed contact event
                    is captured. Lives outside <AppLayout> so it can
                    react on any route (dashboard, reports, etc.). */}
                <MissedCallNotifier />
              </TooltipProvider>
            </BrowserRouter>
          </ActiveContactProvider>
        </CCPProvider>
      )}

      <Toaster position="top-right" richColors closeButton />
      {/* Floating debug HUD — only renders when `?debug=1` is in the URL.
          Lets us watch every state change / render in real time to hunt
          the parpadeo bug. No-op in production-normal sessions. */}
      <DebugHUD />
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
