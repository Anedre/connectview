import { test, expect } from "@playwright/test";

// Smoke e2e: la app levanta y muestra la marca ARIA (sea el login sin sesión o
// el shell ya autenticado). Es el "¿prende?" mínimo para CI.
test("la app carga y muestra la marca ARIA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ARIA").first()).toBeVisible({ timeout: 15_000 });
});
