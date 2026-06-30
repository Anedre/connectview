import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Config separada de vite.config para no arrastrar plugins de build (tailwind,
// visualizer) ni el server a los tests. Reusa el alias "@" del proyecto.
//
// Nota: Storybook init quiso integrar sus stories como tests vía vitest
// "browser mode" (requiere lanzar un navegador por test). Lo dejamos fuera a
// propósito: los unit tests corren rápido en jsdom y Storybook va standalone
// (`npm run storybook`). Si más adelante queremos correr las stories como
// tests, se reactiva el addon-vitest en un proyecto aparte.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".amplify", "amplify", "e2e", ".storybook"],
  },
});
