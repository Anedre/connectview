import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContactRecord } from "@/types/monitoring";

interface SentimentChartProps {
  contacts: ContactRecord[];
}

export function SentimentChart({ contacts }: SentimentChartProps) {
  // Group contacts by date and sentiment
  const dateMap = new Map<
    string,
    { date: string; POSITIVE: number; NEGATIVE: number; NEUTRAL: number; MIXED: number }
  >();

  contacts.forEach((contact) => {
    const date = contact.initiationTimestamp.split("T")[0];
    if (!dateMap.has(date)) {
      dateMap.set(date, { date, POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, MIXED: 0 });
    }
    const entry = dateMap.get(date)!;
    const sentiment = contact.sentiment as keyof typeof entry;
    if (sentiment && sentiment in entry && sentiment !== "date") {
      (entry[sentiment] as number)++;
    }
  });

  const chartData = Array.from(dateMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7); // Last 7 days

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sentiment Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No data available. Run a search to see sentiment trends.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sentiment Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="POSITIVE" fill="#22c55e" stackId="sentiment" />
            <Bar dataKey="NEUTRAL" fill="#94a3b8" stackId="sentiment" />
            <Bar dataKey="MIXED" fill="#f59e0b" stackId="sentiment" />
            <Bar dataKey="NEGATIVE" fill="#ef4444" stackId="sentiment" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
