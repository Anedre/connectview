import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Headphones, AlertTriangle } from "lucide-react";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import type { TranscriptSegment } from "@/types/recordings";
import type { ContactRecord } from "@/types/monitoring";
import { getApiEndpoints } from "@/lib/api";

export function RecordingsPage() {
  const [searchId, setSearchId] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchId.trim()) {
      setSearchError("Enter a Contact ID to search.");
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.getRecording) {
        throw new Error("Recordings API endpoint is not configured.");
      }
      const response = await fetch(
        `${endpoints.getRecording}?contactId=${encodeURIComponent(searchId)}`
      );
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "No recording found for this Contact ID."
            : `HTTP ${response.status}`
        );
      }
      const data = await response.json();
      setSelectedContact({
        contactId: data.contactId,
        initiationTimestamp: data.initiationTimestamp || new Date().toISOString(),
        agentUsername: data.agentUsername || "—",
        queueName: data.queueName || "—",
        channel: data.channel || "VOICE",
        duration: data.duration || 0,
        sentiment: data.sentiment || "UNKNOWN",
        categories: data.categories || [],
        status: "COMPLETED",
      });
      setTranscript(data.transcript || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Failed to load recording.");
      setSelectedContact(null);
      setTranscript([]);
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
      <div className="space-y-2">
        <div className="flex gap-3">
          <Input
            placeholder="Enter Contact ID to search..."
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            className="max-w-md"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <Button onClick={handleSearch} disabled={loading}>
            <Search className="mr-2 h-4 w-4" />
            {loading ? "Searching..." : "Search"}
          </Button>
        </div>
        {searchError && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            {searchError}
          </div>
        )}
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
