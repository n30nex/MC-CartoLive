import { CloudSun, LocateFixed, Play, X } from 'lucide-react';
import type { PublicPropagationConditions, PublicPropagationEvent } from '../types';
import { LoadingBlock } from './LoadingPrimitives';

interface PropagationPanelProps {
  conditions: PublicPropagationConditions | null;
  events: PublicPropagationEvent[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onFocus: (event: PublicPropagationEvent) => void;
  onReplay: (event: PublicPropagationEvent) => void;
}

export default function PropagationPanel({ conditions, events, loading, error, onClose, onFocus, onReplay }: PropagationPanelProps) {
  const latest = conditions?.latestEvent ?? events[0];
  return (
    <aside className="propagation-panel workspace-panel workspace-side" aria-label="Propagation insights">
      <header className="propagation-panel-header">
        <div>
          <span className="panel-eyebrow">RF Weather</span>
          <h2>Propagation</h2>
        </div>
        <button type="button" className="icon-button" title="Close propagation insights" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <section className="propagation-summary">
        <CloudSun size={18} />
        <div>
          <strong>{latest ? propagationLabel(latest) : 'No long-distance events'}</strong>
          <span>{conditions ? sourceStatusLabel(conditions.sourceStatus) : loading ? 'Loading model context' : 'Waiting for public routes'}</span>
        </div>
      </section>

      {conditions?.weather && (
        <section className="propagation-condition-grid" aria-label="Weather model conditions">
          <Condition label="Temp" value={`${conditions.weather.temperatureC.toFixed(1)} C`} />
          <Condition label="Dew" value={`${conditions.weather.dewPointC.toFixed(1)} C`} />
          <Condition label="RH" value={`${Math.round(conditions.weather.relativeHumidityPct)}%`} />
          <Condition label="Pressure" value={`${Math.round(conditions.weather.pressureHPa)} hPa`} />
          <Condition label="Cloud" value={`${Math.round(conditions.weather.cloudCoverPct)}%`} />
          <Condition label="Layer" value={conditions.weather.inversionProxy || 'unknown'} />
        </section>
      )}

      {error && <div className="propagation-error" role="alert">{error}</div>}
      {loading && events.length === 0 && (
        <LoadingBlock
          variant="inline"
          title="Loading propagation history"
          message="Checking public long-distance route context."
          className="propagation-loading"
        />
      )}
      {!loading && events.length === 0 && !error && <div className="propagation-empty">No public long-distance route events in this window.</div>}

      {events.length > 0 && (
        <div className="propagation-list" role="list">
          {events.map((event) => (
            <article key={event.id} className={`propagation-row ${event.classification === 'tropo_possible' ? 'tropo' : 'distance'}`} role="listitem">
              <div className="propagation-row-main">
                <div className="propagation-row-top">
                  <strong>{propagationLabel(event)}</strong>
                  <time>{formatEventTime(event.at)}</time>
                </div>
                <div className="propagation-row-meta">
                  <span>{Math.round(event.distanceKm).toLocaleString()} km</span>
                  <span>{event.confidence}</span>
                  <span>{event.score.toFixed(2)}</span>
                  {event.region && <span>{event.region}</span>}
                </div>
                <p>{event.reasons.slice(0, 2).join(' / ') || endpointSummary(event)}</p>
              </div>
              <div className="propagation-row-actions">
                <button type="button" title="Show this event on the map" onClick={() => onFocus(event)}>
                  <LocateFixed size={15} />
                  <span>Show</span>
                </button>
                <button type="button" title="Replay this event path" onClick={() => onReplay(event)}>
                  <Play size={15} />
                  <span>Replay</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

function Condition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function propagationLabel(event: PublicPropagationEvent): string {
  return event.classification === 'tropo_possible' ? 'Tropo possible' : 'Long-distance event';
}

function sourceStatusLabel(status: string): string {
  if (status === 'active') return 'Weather-supported public route context';
  if (status === 'weather_stale') return 'Route history available, weather model stale';
  if (status === 'quiet') return 'No current public long-distance events';
  return status.replace(/_/g, ' ');
}

function endpointSummary(event: PublicPropagationEvent): string {
  return event.endpointLabels.length > 0 ? event.endpointLabels.join(' to ') : `${event.segments.length} segment path`;
}

function formatEventTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return 'unknown';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
