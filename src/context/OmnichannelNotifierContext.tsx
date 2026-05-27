import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useOmnichannelNotifier } from "@/hooks/useOmnichannelNotifier";
import { useContactFocus } from "@/hooks/useActiveContact";

interface NotifierContextValue {
  unreadCount: Record<string, number>;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
}

const NotifierContext = createContext<NotifierContextValue | null>(null);

/**
 * Mounts the omnichannel notifier (browser notifications + sound +
 * unread tracking) at the agent-desktop root, then exposes the unread
 * count + permission state to descendants via context so the tab strip
 * can render badges without re-running the notifier logic.
 *
 * Also wires a global "vox:focus-contact" CustomEvent handler so the
 * notification click can re-focus the contact (the notifier hook can't
 * call useContactFocus from inside a one-off event listener).
 */
export function OmnichannelNotifierProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useOmnichannelNotifier();
  const { focus } = useContactFocus();

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ contactId: string }>;
      const id = ce.detail?.contactId;
      if (id) focus(id);
    };
    window.addEventListener("vox:focus-contact", handler);
    return () => window.removeEventListener("vox:focus-contact", handler);
  }, [focus]);

  return (
    <NotifierContext.Provider value={value}>
      {children}
    </NotifierContext.Provider>
  );
}

export function useOmnichannelNotifierContext(): NotifierContextValue {
  const ctx = useContext(NotifierContext);
  if (!ctx) {
    // Tolerant default — components outside the provider get zero
    // unread counts instead of crashing. Lets the tab strip render
    // safely from anywhere.
    return {
      unreadCount: {},
      permission:
        typeof Notification !== "undefined" ? Notification.permission : "denied",
      requestPermission: async () => "denied" as const,
    };
  }
  return ctx;
}
