import { useConnectAuth } from "@/context/ConnectAuthContext";

// useAuth now wraps useConnectAuth so existing components keep working
export function useAuth() {
  const { user, loading, signOut } = useConnectAuth();
  return {
    user,
    loading,
    signOut,
    refreshSession: () => {
      // No-op: CCP handles refresh automatically
    },
  };
}
