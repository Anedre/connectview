import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentDesktopPage } from "@/pages/AgentDesktopPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RecordingsPage } from "@/pages/RecordingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export default function App() {
  return (
    <Authenticator>
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
    </Authenticator>
  );
}
