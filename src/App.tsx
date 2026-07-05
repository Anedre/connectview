import { useEffect, useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { ConnectAuthProvider, useConnectAuth } from "@/context/ConnectAuthContext";
import { VoxAuthGate } from "@/context/VoxAuthContext";
import { CCPProvider } from "@/context/CCPContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { DebugHUD } from "@/components/debug/DebugHUD";
import { MissedCallNotifier } from "@/components/workspace/MissedCallNotifier";
import { MonitorControlBar } from "@/components/workspace/MonitorControlBar";
import { CopilotPanel } from "@/components/vox/CopilotPanel";
import { TasksLauncher } from "@/components/vox/TasksLauncher";
import { ActiveContactProvider } from "@/hooks/useActiveContact";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
// Páginas livianas / críticas para el primer render → import estático.
import { DashboardPage } from "@/pages/DashboardPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { InboxPage } from "@/pages/InboxPage";
import { ProgramsHubPage } from "@/pages/ProgramsHubPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

// Páginas pesadas → code-splitting perezoso (echarts, react-flow, editores…).
// Todas exportan NAMED exports, así que envolvemos con .then(m => ({ default })).
const AgentDesktopPage = lazy(() =>
  import("@/pages/AgentDesktopPage").then((m) => ({ default: m.AgentDesktopPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const RecordingsPage = lazy(() =>
  import("@/pages/RecordingsPage").then((m) => ({ default: m.RecordingsPage })),
);
const AdminPage = lazy(() => import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const CampaignsPage = lazy(() =>
  import("@/pages/CampaignsPage").then((m) => ({ default: m.CampaignsPage })),
);
const CampaignCreatePage = lazy(() =>
  import("@/pages/CampaignCreatePage").then((m) => ({ default: m.CampaignCreatePage })),
);
const CampaignDetailPage = lazy(() =>
  import("@/pages/CampaignDetailPage").then((m) => ({ default: m.CampaignDetailPage })),
);
const AppointmentsPage = lazy(() =>
  import("@/pages/AppointmentsPage").then((m) => ({ default: m.AppointmentsPage })),
);
const FlowBuilderPage = lazy(() =>
  import("@/pages/FlowBuilderPage").then((m) => ({ default: m.FlowBuilderPage })),
);
const JourneysPage = lazy(() =>
  import("@/pages/JourneysPage").then((m) => ({ default: m.JourneysPage })),
);
const AutomationsPage = lazy(() =>
  import("@/pages/AutomationsPage").then((m) => ({ default: m.AutomationsPage })),
);
const AgentePage = lazy(() =>
  import("@/pages/AgentePage").then((m) => ({ default: m.AgentePage })),
);
const ChartsLabPage = lazy(() =>
  import("@/pages/ChartsLabPage").then((m) => ({ default: m.ChartsLabPage })),
);

// Demos (solo se sirven en DEV o rutas puntuales) → siempre perezosas para que
// nunca pesen en el bundle de producción.
const CoachDemoPage = lazy(() =>
  import("@/pages/CoachDemoPage").then((m) => ({ default: m.CoachDemoPage })),
);
const WrapUpDemoPage = lazy(() =>
  import("@/pages/WrapUpDemoPage").then((m) => ({ default: m.WrapUpDemoPage })),
);
const MonitorDemoPage = lazy(() =>
  import("@/pages/MonitorDemoPage").then((m) => ({ default: m.MonitorDemoPage })),
);
const FlowBuilderDemoPage = lazy(() =>
  import("@/pages/FlowBuilderDemoPage").then((m) => ({ default: m.FlowBuilderDemoPage })),
);
const WizardDemoPage = lazy(() =>
  import("@/pages/WizardDemoPage").then((m) => ({ default: m.WizardDemoPage })),
);
const GrabacionesDemoPage = lazy(() =>
  import("@/pages/GrabacionesDemoPage").then((m) => ({ default: m.GrabacionesDemoPage })),
);
const ConversationCanvasDemoPage = lazy(() =>
  import("@/pages/ConversationCanvasDemoPage").then((m) => ({
    default: m.ConversationCanvasDemoPage,
  })),
);
const AgenteDemoPage = lazy(() =>
  import("@/pages/AgenteDemoPage").then((m) => ({ default: m.AgenteDemoPage })),
);
const LeadsDemoPage = lazy(() =>
  import("@/pages/LeadsDemoPage").then((m) => ({ default: m.LeadsDemoPage })),
);
const BotsDemoPage = lazy(() =>
  import("@/pages/BotsDemoPage").then((m) => ({ default: m.BotsDemoPage })),
);
const InicioDemoPage = lazy(() =>
  import("@/pages/InicioDemoPage").then((m) => ({ default: m.InicioDemoPage })),
);
const BotTemplateGallery = lazy(() =>
  import("@/components/bots/BotTemplateGallery").then((m) => ({ default: m.BotTemplateGallery })),
);
const RecordingsWorkspace = lazy(() =>
  import("@/components/recordings/RecordingsWorkspace").then((m) => ({
    default: m.RecordingsWorkspace,
  })),
);
const RecordingsShowcasePage = lazy(() =>
  import("@/components/recordings/RecordingsShowcase").then((m) => ({
    default: m.RecordingsShowcasePage,
  })),
);

function VoxLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        background: "linear-gradient(135deg, #2c5698, #158a8c)",
        display: "grid",
        placeItems: "center",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.10) inset, 0 6px 18px -8px rgba(44,86,152,0.6)",
      }}
    >
      <img
        src="/brand/aria-mark-white.png"
        alt="ARIA"
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        style={{ objectFit: "contain" }}
        draggable={false}
      />
    </div>
  );
}

/**
 * LoadingScreen — pantalla de carga inicial. Context-aware:
 *  - El mensaje cambia según en qué etapa estamos (sesión, org, workspace).
 *  - Cycle de 3 mensajes para sensación de progreso aunque el lifecycle
 *    real no exponga sub-etapas determinísticas.
 *  - Background con aurora suave (3 blobs animados) — coherente con el
 *    LoginScreen del Authenticator.
 *  - Sin mensaje hardcodeado a "Amazon Connect" (era engañoso cuando el
 *    tenant todavía no conectó su CCP).
 */
function LoadingScreen() {
  const STAGES = [
    "Verificando tu sesión…",
    "Cargando tu organización…",
    "Preparando tu workspace…",
  ];
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    // Avanzamos cada 900ms y al llegar al último mantenemos hasta que la
    // app realmente termine de cargar (cuando esto desmonta).
    const id = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
    }, 900);
    return () => clearInterval(id);
    // STAGES es constante en este scope → safe sin deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        height: "100vh",
        width: "100%",
        background: "var(--bg-0)",
        overflow: "hidden",
      }}
    >
      {/* Aurora: 3 blobs blurred animados, mismo lenguaje visual que el
          hero del login del Authenticator. */}
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      >
        <motion.span
          animate={{ x: [-40, 40, -20, -40], y: [-30, 10, 30, -30], scale: [1, 1.08, 0.95, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: "18%",
            left: "30%",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, #2c5698 40%, transparent), transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <motion.span
          animate={{ x: [30, -20, 40, 30], y: [20, -30, 10, 20], scale: [1, 0.9, 1.05, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: "40%",
            left: "55%",
            width: 380,
            height: 380,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, #158a8c 36%, transparent), transparent 70%)",
            filter: "blur(70px)",
          }}
        />
        <motion.span
          animate={{ x: [-20, 30, -10, -20], y: [10, -20, 30, 10], scale: [1.05, 1, 0.95, 1.05] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: "55%",
            left: "35%",
            width: 360,
            height: 360,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent-cyan) 28%, transparent), transparent 70%)",
            filter: "blur(75px)",
          }}
        />
      </div>

      {/* Sutil grano (textura) para que el aurora no se vea "plástico". */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.4,
          background: "radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.04) 100%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          padding: "32px 40px",
          borderRadius: 20,
          background: "color-mix(in srgb, var(--bg-1) 70%, transparent)",
          backdropFilter: "blur(20px)",
          border: "1px solid color-mix(in srgb, var(--border-1) 50%, transparent)",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Logo con float gentil + halo */}
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "relative" }}
        >
          <motion.div
            aria-hidden
            animate={{ opacity: [0.35, 0.65, 0.35], scale: [1, 1.25, 1] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: -22,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--accent-cyan) 60%, transparent), transparent 70%)",
              filter: "blur(20px)",
              pointerEvents: "none",
            }}
          />
          <VoxLogo size={56} />
        </motion.div>

        {/* Brand lockup */}
        <div style={{ textAlign: "center" }}>
          <h1
            className="aria-wordmark"
            style={{
              fontSize: 26,
              margin: 0,
              color: "var(--text-1)",
              lineHeight: 1,
            }}
          >
            AR<b>IA</b>
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
            Plataforma de contact center
          </p>
        </div>

        {/* Stage pill con fade-cross entre mensajes */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 16px",
            borderRadius: 999,
            border: "1px solid color-mix(in srgb, var(--accent-cyan) 35%, transparent)",
            background: "color-mix(in srgb, var(--accent-cyan-soft) 60%, transparent)",
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--text-1)",
            minHeight: 36,
            minWidth: 220,
            justifyContent: "center",
          }}
        >
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--accent-cyan)",
            }}
          />
          <AnimatePresence mode="wait">
            <motion.span
              key={stageIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {STAGES[stageIdx]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Progress dots — uno por stage, se llena a medida que avanza. */}
        <div style={{ display: "flex", gap: 6 }}>
          {STAGES.map((_, i) => (
            <motion.span
              key={i}
              animate={{
                width: i <= stageIdx ? 22 : 6,
                background:
                  i <= stageIdx
                    ? "var(--accent-cyan)"
                    : "color-mix(in srgb, var(--text-3) 35%, transparent)",
              }}
              transition={{ duration: 0.3 }}
              style={{ height: 6, borderRadius: 999 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * LoginScreen — pantalla de "sesión de Connect requerida". Se muestra
 * cuando hay sesión de Vox (Cognito) pero NO hay sesión de Amazon Connect.
 *
 * Visual: mismo split-screen del Login.html de Claude Design — brand
 * hero a la izquierda (oscuro con aurora animada), card claro a la
 * derecha con CTA para abrir la pestaña de CCP.
 */
function LoginScreen() {
  // URL del CCP del context (tenant-aware).
  const { instanceUrl } = useConnectAuth();
  useEffect(() => {
    const onFocus = () => {
      window.location.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const openLogin = () => {
    window.open(`${instanceUrl}/ccp-v2`, "_blank", "noopener");
  };

  return (
    <div className="vox-login">
      {/* LEFT — brand hero (same as the Amplify gate) */}
      <section className="vox-auth__hero">
        <div aria-hidden className="vox-auth__aurora">
          <span className="a1" />
          <span className="a2" />
          <span className="a3" />
        </div>
        <div aria-hidden className="vox-auth__grain" />

        <div className="vox-auth__brand">
          <div className="vox-auth__brand-tile">
            <img src="/brand/aria-mark-white.png" alt="" />
          </div>
          <div className="vox-auth__brand-lockup">
            <span className="vox-auth__brand-name">ARIA</span>
            <span className="vox-auth__brand-tag">BY NOVASYS</span>
          </div>
        </div>

        <div className="vox-auth__pitch">
          <span className="vox-auth__pill">
            <span aria-hidden className="vox-auth__pill-dot" />
            Plataforma de contact center
          </span>
          <h1 className="vox-auth__title">
            El espacio de trabajo del <span className="vox-auth__title-grad">agente moderno</span>.
          </h1>
          <p className="vox-auth__sub">
            Llamadas, WhatsApp, leads y campañas — todo en una sola pantalla, potenciado por Amazon
            Connect.
          </p>

          <div className="vox-auth__trust">
            <div className="vox-auth__avs">
              <div aria-hidden className="vox-auth__avs-stack">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span>+2,400 agentes activos hoy</span>
            </div>
            <span aria-hidden className="vox-auth__trust-sep" />
            <span>99.98% uptime</span>
          </div>
        </div>

        <div className="vox-auth__copyright">
          © {new Date().getFullYear()} Novasys · Construido sobre Amazon Connect
        </div>
      </section>

      {/* RIGHT — Connect-login card */}
      <motion.section
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="vox-login__form"
      >
        <div className="vox-login__card">
          <span className="vox-login__eyebrow">Conectar a Amazon Connect</span>
          <h2 className="vox-login__head">Casi listo para empezar</h2>
          <p className="vox-login__sub">
            ARIA usa tu sesión de Amazon Connect para voz y chats. Te abriremos una pestaña; este
            panel se conectará solo.
          </p>

          <ol className="vox-login__steps">
            {[
              "Haz click en el botón de abajo.",
              "Inicia sesión en la pestaña que se abre.",
              "Vuelve aquí — se conecta automáticamente.",
            ].map((step, i) => (
              <li key={step} className="vox-login__step">
                <span className="vox-login__step-num">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <button onClick={openLogin} className="vox-login__cta" type="button">
            Iniciar sesión en Connect
            <span aria-hidden className="vox-login__cta-arrow">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>

          <div className="vox-login__sep">o</div>

          <button
            onClick={() => window.location.reload()}
            className="vox-login__ghost"
            type="button"
          >
            Ya inicié sesión · recargar
          </button>

          <div className="vox-login__tip">
            <span aria-hidden className="vox-login__tip-icon">
              i
            </span>
            <span className="vox-login__tip-text">
              Mantén la pestaña de Amazon Connect abierta mientras usas ARIA — la sesión se comparte
              automáticamente.
            </span>
          </div>
        </div>
      </motion.section>

      <div className="vox-login__protect">Protegido con cifrado AES-256 · SSO SAML 2.0 · MFA</div>
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

/**
 * RouteFallback — fallback liviano para <Suspense> mientras se descarga el
 * chunk de una ruta perezosa (PERF-A1). Un spinner minimalista centrado; sin
 * framer-motion ni aurora para no bloquear el propio split (a diferencia del
 * LoadingScreen de arranque). Hereda la fila de grid de `.app__main`.
 */
function RouteFallback() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        width: "100%",
        background: "var(--bg-0)",
      }}
    >
      <motion.div
        aria-label="Cargando…"
        role="status"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "3px solid color-mix(in srgb, var(--accent-cyan) 22%, transparent)",
          borderTopColor: "var(--accent-cyan)",
        }}
      />
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
          <Suspense fallback={<RouteFallback />}>
            <Routes location={location}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/agent" element={<AgentDesktopPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/recordings" element={<RecordingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/leads" element={<LeadsPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/programs" element={<ProgramsHubPage />} />
              <Route path="/charts-lab" element={<ChartsLabPage />} />
              <Route path="/appointments" element={<AppointmentsPage />} />
              <Route path="/bot" element={<FlowBuilderPage />} />
              <Route path="/journeys" element={<JourneysPage />} />
              <Route path="/automations" element={<AutomationsPage />} />
              <Route path="/agente" element={<AgentePage />} />
              <Route path="/campaigns" element={<CampaignsPage />} />
              <Route path="/campaigns/nueva" element={<CampaignCreatePage />} />
              <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
              <Route path="/queue" element={<MonitoringPage />} />
              <Route path="/coach-demo" element={<CoachDemoPage />} />
              <Route path="/wrapup-demo" element={<WrapUpDemoPage />} />
              <Route path="/monitor-demo" element={<MonitorDemoPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function AppContent() {
  const { user, loading, error, needsLogin, ccpContainerRef } = useConnectAuth();

  // Dev-only preview hatch: ?previewConnectLogin=1 forces the
  // Connect login screen to render, even when there is already a
  // valid Connect session. Used to validate the LoginScreen design
  // without signing out.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("previewConnectLogin") === "1"
  ) {
    return <LoginScreen />;
  }

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
                {/* Floating control bar for an active supervisor monitor
                    session — the CCP is headless so this is the only UI
                    to switch listen↔intervene and leave. */}
                <MonitorControlBar />
                {/* Global ARIA Copilot — floating assistant on every route. */}
                <CopilotPanel />
                {/* Global Tareas — launcher debajo de Copilot; único punto de
                    entrada a las tareas/follow-ups del agente (reemplaza el
                    bubble flotante que vivía solo en Agent Desktop). */}
                <TasksLauncher />
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
  // Standalone, auth-free design preview of the flow builder (#16). Bypasses
  // ConnectAuthProvider entirely so /bot-demo renders without a CCP session.
  if (typeof window !== "undefined" && window.location.pathname === "/bot-demo") {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <FlowBuilderDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the Agentes IA hub (CRUD via manage-bot + live
  // playground via bot-runtime, both public Function URLs → works gate-free).
  if (typeof window !== "undefined" && window.location.pathname === "/agente-demo") {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
            <AgentePage />
          </div>
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview del dashboard ejecutivo (Inicio) con datos mock — para
  // verificar el diseño sin login (el shell real está tras Cognito+Connect).
  if (typeof window !== "undefined" && window.location.pathname === "/inicio-demo") {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <InicioDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free design preview of the Connect setup wizard, para documentación /
  // screenshots del manual. Solo DEV → nunca se sirve en producción.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/wizard-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <WizardDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free design preview of the premium recording experience (waveform +
  // sentiment + click-to-seek transcript). DEV only — for screenshots / QA.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/grabaciones-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <GrabacionesDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the omnichannel ConversationCanvas. DEV only.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/canvas-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <ConversationCanvasDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the premium agent HOME / Inicio (AgentDayHero). DEV
  // only. Nombre con prefijo distinto de /agente-demo (ese es el hub de bots).
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/inicio-agente-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <AgenteDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the premium Leads board (PipelineSummary + board). DEV only.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/leads-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <LeadsDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the premium Bots list (accent-per-bot). DEV only.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/bots-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <BotsDemoPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the premium template gallery ("Crear un bot"). DEV only.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/plantillas-demo"
  ) {
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          <div style={{ height: "100vh", background: "var(--bg-0)" }}>
            <BotTemplateGallery
              onPick={(b) => console.log("[plantillas-demo] pick", b.name)}
              onBack={() => window.history.back()}
            />
          </div>
        </Suspense>
      </ThemeProvider>
    );
  }

  // Auth-free preview of the redesigned Recordings workspace. DEV only.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.location.pathname === "/recordings-demo"
  ) {
    // Permite apuntar a un contacto real para probar con datos reales en dev:
    // /recordings-demo?phone=%2B51953730189&name=Andre
    const sp = new URLSearchParams(window.location.search);
    // ?real=1 → workspace REAL con datos reales (para QA); por defecto el SHOWCASE
    // con datos de ejemplo, idéntico al mockup de Claude Design.
    const real = sp.get("real") === "1";
    const demoPhone = sp.get("phone") || "+51999000111";
    const demoName = sp.get("name") || "Juan Pérez";
    return (
      <ThemeProvider>
        <Suspense fallback={<RouteFallback />}>
          {real ? (
            <div
              style={{
                height: "100vh",
                padding: 16,
                boxSizing: "border-box",
                background: "var(--bg-0)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  border: "1px solid var(--border-1)",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "var(--bg-1)",
                }}
              >
                <RecordingsWorkspace
                  initialLead={{
                    leadId: "demo",
                    name: demoName,
                    phone: demoPhone,
                    company: "Cobranzas SAC",
                    source: "phone",
                  }}
                />
              </div>
            </div>
          ) : (
            <RecordingsShowcasePage />
          )}
        </Suspense>
      </ThemeProvider>
    );
  }

  // Dev-only LoginScreen preview hatch. Wraps in ConnectAuthProvider
  // because LoginScreen reads `instanceUrl` via useConnectAuth().
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("previewConnectLogin") === "1"
  ) {
    return (
      <ThemeProvider>
        <ConnectAuthProvider>
          <LoginScreen />
        </ConnectAuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <VoxAuthGate>
        <ConnectAuthProvider>
          <AppContent />
        </ConnectAuthProvider>
      </VoxAuthGate>
    </ThemeProvider>
  );
}
