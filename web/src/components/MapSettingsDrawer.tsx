import { useState } from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import {
  DEFAULT_MAP_SETTINGS,
  normalizeMapSettings,
  type MapLayerSettings,
  type MapSettings,
  type PacketAnimationStyle,
  type RenderQuality
} from '../mapSettings';

interface MapSettingsDrawerProps {
  settings: MapSettings;
  onChange: (settings: MapSettings) => void;
  onClose: () => void;
}

const WEATHER_CLOUDS_AVAILABLE = Boolean((import.meta.env['VITE_OPENWEATHERMAP_API_KEY'] as string | undefined)?.trim());

type LayerControl = { key: keyof MapLayerSettings; label: string; hint: string; unavailableHint?: string };

export const LAYER_GROUPS: readonly { label: string; controls: readonly LayerControl[] }[] = [
  {
    label: 'Base',
    controls: [
      { key: 'terrainHeightmap', label: 'Terrain heightmap', hint: 'DEM elevation hillshade and 3D terrain' },
      { key: 'buildingExtrusions', label: '3D buildings', hint: 'Building extrusions from vector map tiles' },
      { key: 'weatherClouds', label: 'Weather clouds', hint: 'Live cloud cover overlay', unavailableHint: 'API key required' }
    ]
  },
  {
    label: 'Mesh',
    controls: [
      { key: 'clusters', label: 'Clusters', hint: 'Grouped low-zoom node bubbles' },
      { key: 'activityHeatmap', label: 'Activity heatmap', hint: 'Recent activity glow' },
      { key: 'nodes', label: 'Nodes', hint: 'Individual public nodes and observers' },
      { key: 'nodeLabels', label: 'Node labels', hint: 'Projected map labels' },
      { key: 'routes', label: 'Known pathways', hint: 'Idle public route lines' }
    ]
  },
  {
    label: 'Live Motion',
    controls: [
      { key: 'liveComets', label: 'Live packet comets', hint: 'Live packet flight animations' },
      { key: 'packetResidue', label: 'Packet trails', hint: 'Recent route glow residue' },
      { key: 'observerBursts', label: 'Observer bursts', hint: 'Observer-only packet pings' },
      { key: 'messageBubbles', label: 'Message bubbles', hint: 'Public decoded text overlays' }
    ]
  },
  {
    label: '3D',
    controls: [
      { key: 'nodeModels3D', label: '3D node models', hint: 'OpenFreeMap role models' },
      { key: 'routeArcs3D', label: '3D route arcs', hint: 'Elevated pathway arcs' },
      { key: 'packetComets3D', label: '3D packet comets', hint: 'OpenFreeMap mesh comets and trails' }
    ]
  },
  {
    label: 'Analysis',
    controls: [
      { key: 'analysisPaths', label: 'Analysis paths', hint: 'Selected packets and plotted paths' },
      { key: 'terrainLOS', label: 'Terrain line-of-sight', hint: 'RF terrain clearance color on 3D routes' },
      { key: 'propagationInsights', label: 'Propagation insights', hint: 'Long-distance route annotations and replay history' }
    ]
  }
];

const ANIMATION_STYLES: readonly { value: PacketAnimationStyle; label: string }[] = [
  { value: 'comet', label: 'Comet' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'minimal', label: 'Minimal' }
];

const RENDER_QUALITIES: readonly { value: RenderQuality; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High' }
];

export default function MapSettingsDrawer({ settings, onChange, onClose }: MapSettingsDrawerProps) {
  const updateLayer = (key: keyof MapLayerSettings, value: boolean) => {
    onChange(normalizeMapSettings({ ...settings, layers: { ...settings.layers, [key]: value } }));
  };
  const updatePacket = (key: keyof MapSettings['packets'], value: number | PacketAnimationStyle | RenderQuality) => {
    onChange(normalizeMapSettings({ ...settings, packets: { ...settings.packets, [key]: value } }));
  };
  const updatePacketToggle = (key: keyof MapSettings['packets'], value: boolean) => {
    onChange(normalizeMapSettings({ ...settings, packets: { ...settings.packets, [key]: value } }));
  };
  return (
    <aside className="map-settings-drawer" aria-label="Map settings">
      <header className="map-settings-header">
        <div>
          <span className="panel-eyebrow">Map</span>
          <h2>Settings</h2>
        </div>
        <button type="button" className="icon-button" title="Close map settings" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <section className="map-settings-section">
        <h3>Layers</h3>
        <div className="map-settings-layer-groups">
          {LAYER_GROUPS.map((group) => (
            <div key={group.label} className="map-settings-layer-group">
              <h4>{group.label}</h4>
              <div className="map-settings-toggle-list">
                {group.controls.map((control) => {
                  const unavailable = control.key === 'weatherClouds' && !WEATHER_CLOUDS_AVAILABLE;
                  const hint = unavailable ? control.unavailableHint ?? control.hint : control.hint;
                  return (
                    <label key={control.key} className={`map-settings-toggle${unavailable ? ' unavailable' : ''}`}>
                      <span>
                        <strong>{control.label}</strong>
                        <small>{hint}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={unavailable ? false : settings.layers[control.key]}
                        disabled={unavailable}
                        onChange={(event) => updateLayer(control.key, event.target.checked)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="map-settings-section">
        <h3>Live Packet Style</h3>
        <Slider label="Speed" value={settings.packets.speed} min={0.5} max={3} step={0.1} suffix="x" onChange={(value) => updatePacket('speed', value)} />
        <Slider label="Brightness" value={settings.packets.brightness} min={0.4} max={1.6} step={0.05} suffix="x" onChange={(value) => updatePacket('brightness', value)} />
        <Slider label="Trail" value={settings.packets.trail} min={0} max={2} step={0.05} suffix="x" onChange={(value) => updatePacket('trail', value)} />
        <div className="map-settings-segmented" role="group" aria-label="Packet animation type">
          {ANIMATION_STYLES.map((style) => (
            <button
              key={style.value}
              type="button"
              className={settings.packets.animationStyle === style.value ? 'active' : ''}
              onClick={() => updatePacket('animationStyle', style.value)}
            >
              {style.label}
            </button>
          ))}
        </div>
        <div className="map-settings-segmented" role="group" aria-label="Render quality">
          {RENDER_QUALITIES.map((quality) => (
            <button
              key={quality.value}
              type="button"
              className={settings.packets.renderQuality === quality.value ? 'active' : ''}
              onClick={() => updatePacket('renderQuality', quality.value)}
            >
              {quality.label}
            </button>
          ))}
        </div>
        <label className="map-settings-toggle">
          <span>
            <strong>All-zoom live comets</strong>
            <small>Show live packet comets while zoomed out. Replay always bypasses the zoom gate.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.packets.showLiveCometsAtAllZooms}
            onChange={(event) => updatePacketToggle('showLiveCometsAtAllZooms', event.target.checked)}
          />
        </label>
      </section>

      <footer className="map-settings-footer">
        <ResetButton onConfirm={() => onChange(DEFAULT_MAP_SETTINGS)} />
        <span><SlidersHorizontal size={14} /> local browser preference</span>
      </footer>
    </aside>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="map-settings-slider">
      <span>
        <strong>{label}</strong>
        <em>{value.toFixed(value < 1 ? 2 : 1)}{suffix}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ResetButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}>
        <RotateCcw size={15} />
        Reset visual settings
      </button>
    );
  }
  return (
    <span className="reset-confirm">
      <span>Reset all?</span>
      <button type="button" className="danger" onClick={() => { onConfirm(); setConfirming(false); }}>Yes, reset</button>
      <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
