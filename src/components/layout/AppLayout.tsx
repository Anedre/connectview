import type { ReactNode } from "react";
import { VoxSidebar } from "@/components/vox/VoxSidebar";
import { VoxTopbar } from "@/components/vox/VoxTopbar";
import { IncomingCallOverlay } from "@/components/vox/IncomingCallOverlay";
import { FloatingCallWidget } from "@/components/vox/FloatingCallWidget";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="app" data-density="cozy">
      <VoxSidebar />
      <VoxTopbar />
      <main className="app__main">{children}</main>
      {/* Inbound-ringing → full-screen overlay (only when off /agent). */}
      <IncomingCallOverlay />
      {/* Already connected → compact floating widget so the agent
          doesn't lose call controls when they navigate to other pages. */}
      <FloatingCallWidget />
    </div>
  );
}
