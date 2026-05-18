import { useState } from "react";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import type { TranscriptSegment } from "@/types/recordings";
import type { ContactRecord } from "@/types/monitoring";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";

const SENTIMENT_CHIP: Record<string, string> = {
  POSITIVE: "chip--green",
  NEGATIVE: "chip--red",
  NEUTRAL: "",
  MIXED: "chip--amber",
};

export function RecordingsPage() {
  const [searchId, setSearchId] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchId.trim()) {
      setSearchError("Ingresa un Contact ID para buscar.");
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.getRecording) {
        throw new Error("La API de grabaciones no está configurada.");
      }
      const response = await fetch(
        `${endpoints.getRecording}?contactId=${encodeURIComponent(searchId)}`
      );
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "No se encontró ninguna grabación para este Contact ID."
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
      setSearchError(err instanceof Error ? err.message : "Error al cargar la grabación.");
      setSelectedContact(null);
      setTranscript([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Crecimiento</span>
          </div>
          <h1 className="view__title">Grabaciones</h1>
          <div className="view__sub">
            Búsqueda y reproducción de llamadas con transcripción Contact Lens
          </div>
        </div>
        <div className="view__actions">
          <button className="btn">
            <Icon.Filter size={14} /> Filtros avanzados
          </button>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Buscar por Contact ID" />
        <CardBody>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <div className="tb__search" style={{ maxWidth: 480, height: 36 }}>
              <Icon.Search size={14} />
              <input
                placeholder="Contact ID…"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
            </div>
            <button
              className="btn btn--primary"
              onClick={handleSearch}
              disabled={loading}
            >
              <Icon.Search size={14} />
              {loading ? "Buscando…" : "Buscar"}
            </button>
          </div>
          {searchError && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 8,
                background: "var(--accent-red-soft)",
                color: "var(--accent-red)",
                fontSize: 12.5,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Icon.Close size={14} /> {searchError}
            </div>
          )}
        </CardBody>
      </Card>

      {selectedContact && (
        <div className="grid-2">
          <div className="col" style={{ gap: 16 }}>
            <Card>
              <CardHead title="Info del contacto" />
              <CardBody>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    gap: "10px 14px",
                    fontSize: 12.5,
                  }}
                >
                  <span className="muted">Contact ID</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {selectedContact.contactId}
                  </span>
                  <span className="muted">Agente</span>
                  <span>{selectedContact.agentUsername}</span>
                  <span className="muted">Cola</span>
                  <span>{selectedContact.queueName}</span>
                  <span className="muted">Canal</span>
                  <span>
                    <span className="chip">{selectedContact.channel}</span>
                  </span>
                  <span className="muted">Duración</span>
                  <span className="mono">
                    {Math.floor((selectedContact.duration || 0) / 60)}m{" "}
                    {(selectedContact.duration || 0) % 60}s
                  </span>
                  <span className="muted">Sentiment</span>
                  <span>
                    <span
                      className={`chip ${
                        SENTIMENT_CHIP[selectedContact.sentiment || "NEUTRAL"] ?? ""
                      }`}
                    >
                      <span className="dot" />
                      {selectedContact.sentiment}
                    </span>
                  </span>
                  <span className="muted">Categorías</span>
                  <span className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {selectedContact.categories?.map((cat, i) => (
                      <span key={i} className="chip">
                        {cat}
                      </span>
                    ))}
                  </span>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Reproducción de audio" />
              <CardBody>
                <AudioPlayer src="" onTimeUpdate={setCurrentTimeMs} />
                <p
                  className="muted"
                  style={{ marginTop: 8, fontSize: 11.5 }}
                >
                  La reproducción está disponible cuando hay grabaciones en S3.
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHead title="Transcripción" />
            <CardBody>
              <TranscriptViewer segments={transcript} currentTimeMs={currentTimeMs} />
            </CardBody>
          </Card>
        </div>
      )}

      {!selectedContact && !searchError && (
        <Card>
          <CardBody
            style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}
          >
            <Icon.Disc size={32} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 12, fontSize: 13 }}>
              Busca un Contact ID para revisar audio, transcripción y sentiment.
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
