import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e. Los tests viven en ./e2e (separados de los unit tests de
 * Vitest, que están en src/). El webServer arranca `npm run dev` y reusa el
 * server si ya está corriendo.
 *
 * Primera vez: instala el navegador con `npx playwright install chromium`.
 * Correr: `npm run e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  // Con TEST_EMAIL/TEST_PASSWORD corre el flujo autenticado (setup loguea y guarda
  // la sesión; las `*.authed.spec.ts` la reusan). Sin ellos, solo el smoke sin-auth.
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    ...(process.env.TEST_EMAIL
      ? [
          {
            name: "setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            name: "authed",
            testMatch: /\.authed\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
          },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
