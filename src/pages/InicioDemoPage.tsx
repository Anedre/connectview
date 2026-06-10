import { useState } from "react";
import { ExecutiveView } from "@/components/dashboard/exec/ExecutiveView";
import {
  EXEC_MOCK,
  scaleExec,
  type ExecPeriod,
} from "@/components/dashboard/exec/execMock";

/**
 * InicioDemoPage — preview auth-free del dashboard ejecutivo (ruta /inicio-demo).
 * Monta `ExecutiveView` con datos mock para verificar el diseño sin login
 * (el shell real está tras Cognito+Connect). Mismo patrón que /monitor-demo,
 * /wrapup-demo, /bot-demo.
 */
export function InicioDemoPage() {
  const [period, setPeriod] = useState<ExecPeriod>("hoy");
  const data = scaleExec(EXEC_MOCK, period);
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)", overflow: "auto" }}>
      <ExecutiveView
        data={data}
        period={period}
        onPeriod={setPeriod}
        lastRefresh={new Date()}
      />
    </div>
  );
}
