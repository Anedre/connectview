import { useState, useCallback } from "react";
import type { ContactRecord, ContactFilters } from "@/types/monitoring";

// Mock contacts for development
function generateMockContacts(): ContactRecord[] {
  const agents = ["agent.maria", "agent.carlos", "agent.ana", "agent.pedro", "agent.lucia"];
  const queues = ["BasicQueue", "SalesQueue", "SupportQueue"];
  const sentiments = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];
  const channels = ["VOICE", "CHAT"];
  const categories = ["Complaint", "General Inquiry", "Billing", "Technical Support", "Sales"];

  const contacts: ContactRecord[] = [];
  const now = Date.now();

  for (let i = 0; i < 30; i++) {
    const timestamp = new Date(now - i * 3600000 - Math.random() * 3600000);
    const duration = 60 + Math.floor(Math.random() * 540);
    const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
    const numCategories = 1 + Math.floor(Math.random() * 2);
    const contactCategories = Array.from({ length: numCategories }, () =>
      categories[Math.floor(Math.random() * categories.length)]
    );

    contacts.push({
      contactId: `contact-${Date.now()}-${i}`,
      initiationTimestamp: timestamp.toISOString(),
      disconnectTimestamp: new Date(timestamp.getTime() + duration * 1000).toISOString(),
      agentUsername: agents[Math.floor(Math.random() * agents.length)],
      queueName: queues[Math.floor(Math.random() * queues.length)],
      channel: channels[Math.floor(Math.random() * channels.length)],
      duration,
      sentiment,
      sentimentScore: { overall: sentiment },
      categories: contactCategories,
      disconnectReason: "AGENT_DISCONNECT",
      status: "COMPLETED",
    });
  }

  return contacts.sort(
    (a, b) =>
      new Date(b.initiationTimestamp).getTime() -
      new Date(a.initiationTimestamp).getTime()
  );
}

export function useContacts() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchContacts = useCallback(async (_filters: ContactFilters) => {
    setLoading(true);
    setError(null);

    try {
      // TODO: Replace with real API call when backend is deployed
      // const params = new URLSearchParams(filters as Record<string, string>);
      // const response = await fetch(`${apiUrl}?${params}`);
      // const data = await response.json();
      // setContacts(data.contacts);

      // Mock data for now
      await new Promise((resolve) => setTimeout(resolve, 500));
      const allContacts = generateMockContacts();

      // Apply client-side filters to mock data
      let filtered = allContacts;
      if (_filters.sentiment) {
        filtered = filtered.filter((c) => c.sentiment === _filters.sentiment);
      }
      if (_filters.agentUsername) {
        filtered = filtered.filter((c) =>
          c.agentUsername.includes(_filters.agentUsername!)
        );
      }
      if (_filters.queueName) {
        filtered = filtered.filter((c) => c.queueName === _filters.queueName);
      }

      setContacts(filtered);
    } catch {
      setError("Failed to fetch contacts");
      setContacts(generateMockContacts());
    } finally {
      setLoading(false);
    }
  }, []);

  return { contacts, loading, error, searchContacts };
}
