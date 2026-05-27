import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookOpen, Search, ExternalLink } from "lucide-react";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";

export function WisdomPanel() {
  const [query, setQuery] = useState("");

  const openInConnect = () => {
    const url = query
      ? `${CONNECT_INSTANCE_URL}/connect/wisdom-v2/search?query=${encodeURIComponent(query)}`
      : `${CONNECT_INSTANCE_URL}/connect/wisdom-v2`;
    window.open(url, "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5" />
          Base de conocimiento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Buscar en Amazon Q…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openInConnect()}
          />
          <Button onClick={openInConnect} size="sm">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={openInConnect}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Abrir base de conocimiento
        </Button>

        <p className="text-xs text-muted-foreground">
          Amazon Q en Connect, alimentado por tus bases de conocimiento y
          respuestas rápidas.
        </p>
      </CardContent>
    </Card>
  );
}
