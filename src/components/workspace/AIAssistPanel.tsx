import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, ExternalLink } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";

interface QSuggestion {
  id: string;
  type: string;
  title: string;
  excerpts: string[];
  url?: string;
}

interface AIAssistPanelProps {
  contactId: string | null;
  customerPhone: string | null;
  latestCustomerUtterance?: string;
}

export function AIAssistPanel({
  latestCustomerUtterance,
}: AIAssistPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<QSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (!q) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getQSuggestions) return;

    setLoading(true);
    try {
      const r = await fetch(
        `${endpoints.getQSuggestions}?query=${encodeURIComponent(q)}`
      );
      const data = await r.json();
      setSuggestions(data.results || []);
    } finally {
      setLoading(false);
    }
  };

  // Auto-search when customer says something new (debounced)
  useEffect(() => {
    if (!latestCustomerUtterance) return;
    const t = setTimeout(() => {
      setQuery(latestCustomerUtterance);
      search(latestCustomerUtterance);
    }, 1500);
    return () => clearTimeout(t);
  }, [latestCustomerUtterance]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5" />
          AI Assist
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search(query)}
            placeholder="Ask Q in Connect or search knowledge base..."
            className="text-sm"
          />
          <Button
            size="sm"
            onClick={() => search(query)}
            disabled={loading || !query}
          >
            {loading ? "..." : "Search"}
          </Button>
        </div>

        {suggestions.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Search for information or get AI suggestions during the call.
          </p>
        )}

        <div className="space-y-2 max-h-[350px] overflow-y-auto">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border bg-card p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{s.title}</span>
                  </div>
                  {s.excerpts.slice(0, 2).map((excerpt, i) => (
                    <p
                      key={i}
                      className="mt-1 text-xs text-muted-foreground line-clamp-2"
                    >
                      {excerpt}
                    </p>
                  ))}
                </div>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
