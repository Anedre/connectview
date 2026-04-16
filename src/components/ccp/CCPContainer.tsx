import { useEffect, useRef } from "react";
import { useCCP } from "@/hooks/useCCP";
import { CCPStatusBar } from "./CCPStatusBar";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";

interface CCPContainerProps {
  className?: string;
}

export function CCPContainer({ className = "" }: CCPContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { agentState, agentName, isInitialized, error, initialize } = useCCP();

  useEffect(() => {
    if (containerRef.current) {
      initialize(containerRef.current);
    }
  }, [initialize]);

  if (!CONNECT_INSTANCE_URL) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 rounded-lg border bg-muted/50 p-8 ${className}`}>
        <p className="text-sm text-muted-foreground">
          Amazon Connect instance URL not configured.
        </p>
        <p className="text-xs text-muted-foreground">
          Set <code className="rounded bg-muted px-1">VITE_CONNECT_INSTANCE_URL</code> in your{" "}
          <code className="rounded bg-muted px-1">.env.local</code> file.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <CCPStatusBar agentState={agentState} agentName={agentName} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        className="rounded-lg border bg-white"
        style={{ width: 320, height: 465 }}
      />

      {!isInitialized && !error && (
        <p className="text-center text-xs text-muted-foreground">
          Loading CCP... A login popup may appear.
        </p>
      )}
    </div>
  );
}
