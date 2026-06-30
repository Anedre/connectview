import { QueryClient } from "@tanstack/react-query";

/**
 * Cliente único de TanStack Query para toda la app. Defaults pensados para un
 * dashboard de contact center:
 * - staleTime 30s: evita refetch en cada montaje al navegar entre secciones.
 * - sin refetchOnWindowFocus: las métricas "en vivo" usan su propio interval;
 *   no queremos un refetch masivo cada vez que el agente vuelve a la pestaña.
 * - retry 1: un reintento ante fallo transitorio, sin martillar la API.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
