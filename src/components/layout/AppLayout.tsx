import { useCallback, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SectionColorContext, sectionColorFor } from "@/components/aria";
import { VoxSidebar } from "@/components/vox/VoxSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { IncomingCallOverlay } from "@/components/vox/IncomingCallOverlay";
import { FloatingCallWidget } from "@/components/vox/FloatingCallWidget";
import { ChatQueueAlert } from "@/components/inbox/ChatQueueAlert";
import { OnboardingBanner } from "@/components/vox/OnboardingBanner";
import { SoftphoneBanner } from "@/components/vox/SoftphoneBanner";
import { NavProgress } from "@/components/layout/NavProgress";
import { TopBarSlotProvider } from "@/components/layout/TopBarSlot";
import { ProgramProvider } from "@/context/ProgramContext";

interface AppLayoutProps {
  children: ReactNode;
}

const COLLAPSE_KEY = "aria_collapsed";

export function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const location = useLocation();
  const sectionColor = sectionColorFor(location.pathname);

  return (
    <ProgramProvider>
    <TopBarSlotProvider>
    <SectionColorContext.Provider value={sectionColor}>
    {/* ARIA shell: .app (flex) → .sb + .main(.tb + .content). */}
    <div className="app" data-density="cozy" data-collapsed={collapsed ? "1" : "0"}>
      <NavProgress />
      <VoxSidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <div className="main">
        <AppTopBar />
        <div className="content">
          {/* Banner visible solo en onboarding (tenant sin Connect/BYO).
              Le indica al Admin qué configurar y que sus datos siguen vacíos. */}
          <OnboardingBanner />
          {/* Prompt no bloqueante para conectar el softphone / confirmar el
              agente de Connect cuando hay Connect configurado pero el CCP aún
              no autenticó. Reemplaza la vieja LoginScreen bloqueante. */}
          <SoftphoneBanner />
          {children}
        </div>
      </div>
      {/* Inbound-ringing → full-screen overlay (only when off /agent). */}
      <IncomingCallOverlay />
      {/* Chat derivado por el bot / en cola → pop-up de alerta al agente
          (global, como el ring de una llamada). */}
      <ChatQueueAlert />
      {/* Already connected → compact floating widget so the agent
          doesn't lose call controls when they navigate to other pages. */}
      <FloatingCallWidget />
    </div>
    </SectionColorContext.Provider>
    </TopBarSlotProvider>
    </ProgramProvider>
  );
}
