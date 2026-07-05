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
    rollupOptions: {
      output: {
        // PERF-M3 · separa los vendors pesados en chunks propios para que:
        //  - se cacheen aparte del código de app (cambian con menos frecuencia),
        //  - no inflen el chunk inicial de entrada.
        // Usamos la forma-función para poder agrupar TODO el árbol de AWS
        // (aws-amplify arrastra @aws-sdk/* y @smithy/* transitivamente) en un
        // solo chunk. react/react-dom/react-router van JUNTOS a propósito
        // (comparten runtime; el router depende de react) para no romper el
        // orden de inicialización entre chunks.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Normalizamos separadores de Windows para el match.
          const p = id.replace(/\\/g, "/");
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(p)) {
            return "vendor-react";
          }
          if (/node_modules\/(aws-amplify|@aws-amplify|@aws-sdk|@smithy|aws-crt)\//.test(p)) {
            return "vendor-amplify";
          }
          if (/node_modules\/(echarts|echarts-for-react|zrender)\//.test(p)) {
            return "vendor-echarts";
          }
          if (/node_modules\/@xyflow\//.test(p)) {
            return "vendor-flow";
          }
          if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(p)) {
            return "vendor-motion";
          }
          return undefined;
        },
      },
    },
  },
}));
