import type { ReactNode } from "react";
import { VoxSidebar } from "@/components/vox/VoxSidebar";
import { VoxTopbar } from "@/components/vox/VoxTopbar";
import { IncomingCallOverlay } from "@/components/vox/IncomingCallOverlay";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="app" data-density="cozy">
      <VoxSidebar />
      <VoxTopbar />
      <main className="app__main">{children}</main>
      <IncomingCallOverlay />
    </div>
  );
}
