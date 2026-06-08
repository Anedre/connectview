import { ConnectSetupWizard } from "@/components/admin/ConnectSetupWizard";
import type { ConnectConn } from "@/hooks/useConnections";

/**
 * WizardDemoPage — vista de diseño SIN autenticación del asistente de conexión
 * de Amazon Connect (`ConnectSetupWizard`). Sirve para documentación: capturar
 * el paso a paso del wizard para el manual de usuario. Se monta en `/wizard-demo`
 * (solo en DEV, ver App.tsx) FUERA del portón de Cognito.
 *
 * Los datos de ejemplo dejan cada paso "completo" (campos llenos, verificado) para
 * que las capturas muestren el estado ideal. No hace llamadas reales al backend
 * salvo que se toquen los botones de "Verificar".
 */
const DEMO: ConnectConn = {
  instanceUrl: "https://acme-corp.my.connect.aws",
  region: "us-east-1",
  instanceArn:
    "arn:aws:connect:us-east-1:123456789012:instance/2345d564-4bd4-4318-9cf0-75649bad5197",
  externalId: "vox-7f3a9c12-4b8e-4d6a-9e21-8b5e2c1a",
  roleArn: "arn:aws:iam::123456789012:role/VoxCrmConnectAccess",
  verifiedAt: "2026-06-04T12:00:00Z",
  dataPlaneEnabled: true,
  dataPlaneVerifiedAt: "2026-06-04T12:01:00Z",
};

export function WizardDemoPage() {
  return (
    <ConnectSetupWizard
      initial={DEMO}
      onSave={(c) => console.log("[wizard-demo] save", c)}
      onClose={() => console.log("[wizard-demo] close")}
    />
  );
}
