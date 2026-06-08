import type { ReactNode } from "react";
import { VoxSidebar } from "@/components/vox/VoxSidebar";
import { VoxTopbar } from "@/components/vox/VoxTopbar";
import { IncomingCallOverlay } from "@/components/vox/IncomingCallOverlay";
import { FloatingCallWidget } from "@/components/vox/FloatingCallWidget";
import { OnboardingBanner } from "@/components/vox/OnboardingBanner";
import { SoftphoneBanner } from "@/components/vox/SoftphoneBanner";
import { NavProgress } from "@/components/layout/NavProgress";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="app" data-density="cozy">
      <NavProgress />
      <VoxSidebar />
      <VoxTopbar />
      <main className="app__main">
        {/* Banner visible solo en onboarding (tenant sin Connect/BYO).
            Le indica al Admin qué configurar y que sus datos siguen vacíos. */}
        <OnboardingBanner />
        {/* Prompt no bloqueante para conectar el softphone / confirmar el
            agente de Connect cuando hay Connect configurado pero el CCP aún
            no autenticó. Reemplaza la vieja LoginScreen bloqueante. */}
        <SoftphoneBanner />
        {children}
      </main>
      {/* Inbound-ringing → full-screen overlay (only when off /agent). */}
      <IncomingCallOverlay />
      {/* Already connected → compact floating widget so the agent
          doesn't lose call controls when they navigate to other pages. */}
      <FloatingCallWidget />
    </div>
  );
}
