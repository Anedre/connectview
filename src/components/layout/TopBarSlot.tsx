import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";

/**
 * TopBarSlot — permite que cada página "suba" sus acciones (Nuevo lead,
 * Compartir, Exportar…) al `AppTopBar` (el chrome conectado al sidebar), como
 * en el mockup. El `PageHeader` lo usa automáticamente, así que cualquier
 * página que pase `actions` las verá arriba a la derecha sin tocar nada.
 *
 * Dos contextos separados: el SETTER es estable (los productores NO se
 * re-renderizan al setear), y el NODE solo lo consume el top bar. Cada llamada
 * tiene un token único: al desmontar, limpia SOLO si sigue siendo la dueña
 * (evita que la página saliente borre las acciones de la entrante en una
 * transición).
 */

const NodeCtx = createContext<ReactNode>(null);
type SetFn = (token: number, node: ReactNode | undefined) => void;
const SetCtx = createContext<SetFn>(() => {});

let TOKENS = 0;

export function TopBarSlotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ token: number; node: ReactNode }>({ token: 0, node: null });
  const set = useRef<SetFn>((token, node) => {
    setState((cur) => {
      if (node === undefined) {
        // pedido de limpieza: solo si sigo siendo la dueña
        return cur.token === token ? { token: 0, node: null } : cur;
      }
      return { token, node };
    });
  }).current;

  return (
    <SetCtx.Provider value={set}>
      <NodeCtx.Provider value={state.node}>{children}</NodeCtx.Provider>
    </SetCtx.Provider>
  );
}

/** Lo consume el AppTopBar para renderizar las acciones de la página activa. */
export function useTopBarSlot(): ReactNode {
  return useContext(NodeCtx);
}

/** Lo llama una página (o el PageHeader) para publicar sus acciones arriba. */
export function useTopBarActions(node: ReactNode, deps: DependencyList) {
  const set = useContext(SetCtx);
  const tokenRef = useRef(0);
  if (tokenRef.current === 0) tokenRef.current = ++TOKENS;
  const token = tokenRef.current;
  useEffect(() => {
    set(token, node ?? null);
    return () => set(token, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
