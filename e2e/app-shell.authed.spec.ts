import { test, expect, type Page } from "@playwright/test";

/**
 * Flujos críticos (smoke autenticado): con una sesión de Vox (Cognito) real, cada
 * sección principal debe MONTAR sin crashear, renderizar su UI esperada, y NO caer
 * en la pantalla de login. Es la red que atrapa las peores regresiones (imports
 * rotos, render que explota, endpoint faltante) sin verificar a mano.
 *
 * Read-only: solo navega y verifica render (no crea/borra datos → no ensucia el
 * tenant). Los flujos de mutación (alta de lead, etc.) son follow-up con cleanup.
 */
const ROUTES: { path: string; expect: RegExp }[] = [
  { path: "/leads", expect: /Leads/i },
  { path: "/campaigns", expect: /Campañas/i },
  { path: "/journeys", expect: /Journeys/i },
  { path: "/inbox", expect: /Conversaciones|Todas/i },
  { path: "/reports", expect: /Reportes|Reporte/i },
  { path: "/automations", expect: /Automatizaciones|Automatización/i },
  { path: "/programs", expect: /Programas|programa/i },
  { path: "/bot", expect: /Bots?|Agente/i },
  { path: "/admin", expect: /Configuración|Usuarios/i },
];

/** Falla la spec si la página lanza una excepción no atrapada. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("la sesión está activa (no vuelve al login)", async ({ page }) => {
  await page.goto("/leads");
  // El form de login de Cognito NO debe aparecer (sesión reusada del storageState).
  await expect(page.locator('input[name="username"]')).toHaveCount(0);
  // La marca ARIA del shell sí.
  await expect(page.getByText("ARIA").first()).toBeVisible({ timeout: 15_000 });
});

for (const r of ROUTES) {
  test(`monta ${r.path} sin crashear`, async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(r.path);
    // No cae en la pantalla de login de Connect (takeover) ni en el gate de Cognito.
    await expect(page.getByText(/Iniciar sesión en Connect/i)).toHaveCount(0);
    await expect(page.locator('input[name="username"]')).toHaveCount(0);
    // Renderiza su UI esperada.
    await expect(page.getByText(r.expect).first()).toBeVisible({ timeout: 15_000 });
    expect(errors, `errores de página en ${r.path}: ${errors.join(" | ")}`).toHaveLength(0);
  });
}
