import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h2 className="text-4xl font-bold">404</h2>
      <p className="text-muted-foreground">Page not found</p>
      <Button onClick={() => navigate("/")}>Back to Dashboard</Button>
    </div>
  );
}
