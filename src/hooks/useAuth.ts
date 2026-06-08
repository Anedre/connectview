import { useConnectAuth } from "@/context/ConnectAuthContext";

// useAuth now wraps useConnectAuth so existing components keep working
export function useAuth() {
  const { user, loading, signOut, isOnboarding } = useConnectAuth();
  return {
    user,
    loading,
    signOut,
    isOnboarding,
    refreshSession: () => {
      // No-op: CCP handles refresh automatically
    },
  };
}
