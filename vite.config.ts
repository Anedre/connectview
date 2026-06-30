import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // `npm run analyze` (vite build --mode analyze) → genera dist/stats.html con
    // el treemap del bundle (útil con tantos @aws-sdk/* para ver qué pesa).
    mode === "analyze" &&
      visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true,
        filename: "dist/stats.html",
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single React instance — @xyflow/react (flow builder #16) was
    // pulling a second copy, triggering "Invalid hook call".
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@xyflow/react"],
  },
  define: {
    global: "globalThis", // Required for amazon-connect-streams
  },
  server: {
    port: 5173,
    strictPort: true, // Fail instead of jumping to another port — origin must match Connect Approved Origins
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
}));
