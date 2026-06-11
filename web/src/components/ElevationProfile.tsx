import { useEffect, useRef, useState } from 'react';
import type { PublicRouteEndpoint } from '../types';
import { sampleElevationAlongRoute, summarizeElevation } from '../map/elevationProfile';
import { routeEndpointDistanceKm } from '../map/routeArcs';

const DEFAULT_TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

interface Props {
  from: PublicRouteEndpoint;
  to: PublicRouteEndpoint;
  terrainTileUrl?: string;
}

export default function ElevationProfile({ from, to, terrainTileUrl }: Props) {
  const [elevations, setElevations] = useState<number[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const gradientID = useRef(`ep-grad-${Math.random().toString(36).slice(2, 8)}`).current;

  const tileUrl = terrainTileUrl || ((import.meta.env['VITE_TERRAIN_TILE_URL'] as string | undefined)?.trim() || DEFAULT_TERRAIN_TILE_URL);
  const distKm = routeEndpointDistanceKm(from, to);
  const tooShort = distKm < 0.1;

  useEffect(() => {
    if (tooShort || !tileUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const samples = Math.min(120, Math.max(24, Math.round(distKm * 3)));
    sampleElevationAlongRoute(from.lng, from.lat, to.lng, to.lat, samples, tileUrl)
      .then((elevs) => {
        if (cancelled) return;
        setElevations(elevs);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [from.lat, from.lng, to.lat, to.lng, tileUrl, tooShort, distKm]);

  if (tooShort) return null;

  if (loading) {
    return (
      <div className="elevation-profile">
        <div className="elevation-skeleton" style={{ height: 72 }} />
      </div>
    );
  }

  if (error || !elevations || elevations.length < 2) {
    return (
      <div className="elevation-profile">
        <span className="elevation-unavailable">Terrain data unavailable</span>
      </div>
    );
  }

  const stats = summarizeElevation(elevations);
  const { min, max, gain, loss, start, end } = stats;
  const range = max - min || 1;

  const w = 320;
  const h = 76;
  const padT = 6;
  const padB = 14;
  const cw = w;
  const ch = h - padT - padB;

  const pts = elevations
    .map((e, i) => {
      const x = (i / Math.max(1, elevations.length - 1)) * cw;
      const y = padT + ch - ((e - min) / range) * ch;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const area = [
    `0,${padT + ch}`,
    ...elevations.map((e, i) => {
      const x = (i / Math.max(1, elevations.length - 1)) * cw;
      const y = padT + ch - ((e - min) / range) * ch;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }),
    `${cw},${padT + ch}`
  ].join(' ');

  const yMidMax = padT + 3;
  const yMidMin = padT + ch - 1;

  return (
    <div className="elevation-profile">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientID})`} />
        <polyline
          points={pts}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text x={2} y={yMidMax} fill="#8fa2bb" fontSize="9">{max.toFixed(0)}m</text>
        <text x={2} y={yMidMin} fill="#8fa2bb" fontSize="9">{min.toFixed(0)}m</text>
      </svg>
      <div className="elevation-labels">
        <span>{start.toFixed(0)}m</span>
        <span>{end.toFixed(0)}m</span>
      </div>
      <div className="elevation-summary">
        <span className="elevation-gain">+{gain.toFixed(0)}m gain</span>
        <span className="elevation-loss">-{loss.toFixed(0)}m loss</span>
      </div>
    </div>
  );
}
