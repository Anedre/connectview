import { useEffect } from "react";
import { useContacts } from "@/hooks/useContacts";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { ContactsTable } from "@/components/reports/ContactsTable";

export function ReportsPage() {
  const { contacts, loading, searchContacts } = useContacts();

  // Load initial data
  useEffect(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const now = new Date().toISOString();
    searchContacts({ startDate: weekAgo, endDate: now });
  }, [searchContacts]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Contact Lens Reports
        </h2>
        <p className="text-muted-foreground">
          Sentiment analysis and contact history
        </p>
      </div>

      <ContactFilters onSearch={searchContacts} loading={loading} />

      <SentimentChart contacts={contacts} />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Contact History</h3>
          <span className="text-sm text-muted-foreground">
            {contacts.length} contacts
          </span>
        </div>
        <ContactsTable contacts={contacts} />
      </div>
    </div>
  );
}
