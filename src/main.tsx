import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import * as Sentry from "@sentry/react";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { installApiAuthInterceptor } from "./lib/apiAuthInterceptor";
import "./index.css";
// ARIA design system — imported AFTER index.css so its tokens/classes win the
// cascade (Tailwind requires @import at top, which would lose ordering).
import "./styles/aria-base.css";
import "./styles/aria-components.css";

Amplify.configure(outputs);
// Adjunta el ID token de Cognito a todas las llamadas a nuestra API (tenant scoping).
installApiAuthInterceptor();

// Sentry: se activa SOLO si hay DSN (VITE_SENTRY_DSN en .env) y es build de
// producción. En dev no enviamos eventos. Sin DSN, es un no-op (cero impacto).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn && import.meta.env.PROD) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* DevTools de TanStack Query solo en desarrollo (panel flotante). */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
);
