import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import App from "./App";
import { installApiAuthInterceptor } from "./lib/apiAuthInterceptor";
import "./index.css";

Amplify.configure(outputs);
// Adjunta el ID token de Cognito a todas las llamadas a nuestra API (tenant scoping).
installApiAuthInterceptor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
