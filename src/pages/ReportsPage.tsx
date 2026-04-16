import { useEffect } from "react";
import { BarChart3 } from "lucide-react";
import { useContacts } from "@/hooks/useContacts";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { ContactsTable } from "@/components/reports/ContactsTable";

export function ReportsPage() {
  const { contacts, loading, searchContacts } = useContacts();

  useEffect(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const now = new Date().toISOString();
    searchContacts({ startDate: weekAgo, endDate: now });
  }, [searchContacts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-md">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Contact Lens Reports
            </h2>
            <p className="text-sm text-muted-foreground">
              Sentiment analysis and historical insights
            </p>
          </div>
        </div>
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: "0ms" }}>
        <ContactFilters onSearch={searchContacts} loading={loading} />
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
        <SentimentChart contacts={contacts} />
      </div>

      <div
        className="animate-fade-in-up"
        style={{ animationDelay: "160ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">
            Contact History
          </h3>
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {contacts.length} contacts
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <ContactsTable contacts={contacts} />
        </div>
      </div>
    </div>
  );
}
