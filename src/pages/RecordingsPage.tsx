import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Headphones } from "lucide-react";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import type { TranscriptSegment } from "@/types/recordings";
import type { ContactRecord } from "@/types/monitoring";
import { getApiEndpoints } from "@/lib/api";

// Mock data
function generateMockRecording(): {
  contact: ContactRecord;
  transcript: TranscriptSegment[];
} {
  return {
    contact: {
      contactId: "mock-001",
      initiationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      disconnectTimestamp: new Date(Date.now() - 3300000).toISOString(),
      agentUsername: "agent.maria",
      queueName: "SupportQueue",
      channel: "VOICE",
      duration: 300,
      sentiment: "POSITIVE",
      categories: ["Technical Support", "Billing"],
      disconnectReason: "AGENT_DISCONNECT",
      status: "COMPLETED",
    },
    transcript: [
      { content: "Thank you for calling Novasys support, my name is Maria. How can I help you today?", participant: "AGENT", beginOffsetMillis: 0, endOffsetMillis: 5000, sentiment: "POSITIVE" },
      { content: "Hi Maria, I'm having trouble with my account billing. I was charged twice this month.", participant: "CUSTOMER", beginOffsetMillis: 5500, endOffsetMillis: 12000, sentiment: "NEGATIVE" },
      { content: "I'm sorry to hear that. Let me look into your account right away. Can you please provide me with your account number?", participant: "AGENT", beginOffsetMillis: 12500, endOffsetMillis: 19000, sentiment: "POSITIVE" },
      { content: "Sure, it's AC-12345.", participant: "CUSTOMER", beginOffsetMillis: 19500, endOffsetMillis: 22000, sentiment: "NEUTRAL" },
      { content: "Thank you. I can see the duplicate charge here. I'll process a refund for you right now. It should appear in 3-5 business days.", participant: "AGENT", beginOffsetMillis: 22500, endOffsetMillis: 32000, sentiment: "POSITIVE" },
      { content: "Oh that's great! Thank you so much for resolving this so quickly.", participant: "CUSTOMER", beginOffsetMillis: 32500, endOffsetMillis: 37000, sentiment: "POSITIVE" },
      { content: "You're welcome! Is there anything else I can help you with today?", participant: "AGENT", beginOffsetMillis: 37500, endOffsetMillis: 41000, sentiment: "POSITIVE" },
      { content: "No, that's all. Thanks again, Maria!", participant: "CUSTOMER", beginOffsetMillis: 41500, endOffsetMillis: 44000, sentiment: "POSITIVE" },
    ],
  };
}

export function RecordingsPage() {
  const [searchId, setSearchId] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const endpoints = getApiEndpoints();
      if (endpoints?.getRecording && searchId && searchId !== "demo") {
        const response = await fetch(
          `${endpoints.getRecording}?contactId=${encodeURIComponent(searchId)}`
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setSelectedContact({
          contactId: data.contactId,
          initiationTimestamp: new Date().toISOString(),
          agentUsername: "—",
          queueName: "—",
          channel: "VOICE",
          duration: data.duration,
          sentiment: "UNKNOWN",
          categories: [],
          status: "COMPLETED",
        });
        setTranscript(data.transcript || []);
      } else {
        // Demo mode
        const mock = generateMockRecording();
        setSelectedContact(mock.contact);
        setTranscript(mock.transcript);
      }
    } catch {
      const mock = generateMockRecording();
      setSelectedContact(mock.contact);
      setTranscript(mock.transcript);
    } finally {
      setLoading(false);
    }
  };

  const SENTIMENT_STYLES: Record<string, string> = {
    POSITIVE: "bg-green-100 text-green-800",
    NEGATIVE: "bg-red-100 text-red-800",
    NEUTRAL: "bg-gray-100 text-gray-800",
    MIXED: "bg-yellow-100 text-yellow-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-md">
          <Headphones className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Recordings</h2>
          <p className="text-sm text-muted-foreground">
            Search and playback call recordings with AI transcription
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <Input
          placeholder="Enter Contact ID to search..."
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
          className="max-w-md"
        />
        <Button onClick={handleSearch} disabled={loading}>
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSearchId("demo");
            handleSearch();
          }}
        >
          <Headphones className="mr-2 h-4 w-4" />
          Load Demo
        </Button>
      </div>

      {selectedContact && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Recording + Info */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Contact ID</span>
                  <span className="font-mono text-xs">{selectedContact.contactId}</span>
                  <span className="text-muted-foreground">Agent</span>
                  <span>{selectedContact.agentUsername}</span>
                  <span className="text-muted-foreground">Queue</span>
                  <span>{selectedContact.queueName}</span>
                  <span className="text-muted-foreground">Channel</span>
                  <Badge variant="secondary">{selectedContact.channel}</Badge>
                  <span className="text-muted-foreground">Duration</span>
                  <span>{Math.floor((selectedContact.duration || 0) / 60)}m {(selectedContact.duration || 0) % 60}s</span>
                  <span className="text-muted-foreground">Sentiment</span>
                  <Badge className={SENTIMENT_STYLES[selectedContact.sentiment || "NEUTRAL"]}>
                    {selectedContact.sentiment}
                  </Badge>
                  <span className="text-muted-foreground">Categories</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedContact.categories?.map((cat, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{cat}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Audio Playback</CardTitle>
              </CardHeader>
              <CardContent>
                <AudioPlayer
                  src=""
                  onTimeUpdate={setCurrentTimeMs}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Audio playback available when connected to live recordings in S3
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right: Transcript */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <TranscriptViewer
                segments={transcript}
                currentTimeMs={currentTimeMs}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
