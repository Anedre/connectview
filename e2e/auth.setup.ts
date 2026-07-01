import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * auth.setup — login de identidad (Cognito) vía el Authenticator de Amplify, y
 * guarda la sesión (storageState) para que las specs `*.authed.spec.ts` la reusen
 * sin re-loguear. Gateado por env: sin TEST_EMAIL/TEST_PASSWORD se salta (así el
 * smoke sin-auth sigue corriendo en cualquier máquina/CI sin credenciales).
 *
 * En CI: setear TEST_EMAIL/TEST_PASSWORD como secretos (un usuario Cognito de prueba).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(__dirname, ".auth/user.json");

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

setup("authenticate (Cognito)", async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, "TEST_EMAIL/TEST_PASSWORD no configurados");

  await page.goto("/");
  // Form del Authenticator de Amplify (email = name="username").
  const email = page.locator('input[name="username"]');
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(EMAIL!);
  await page.locator('input[name="password"]').fill(PASSWORD!);
  await page.locator('button[type="submit"]').click();

  // Login OK cuando el form de Cognito desaparece (pasa al post-login: la
  // pantalla de conexión a Connect o el shell si ya hay sesión de Connect).
  await expect(email).toBeHidden({ timeout: 25_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
