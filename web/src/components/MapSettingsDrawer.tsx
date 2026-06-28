import { useState, type CSSProperties } from 'react';
import { Compass, Layers, Mountain, RadioTower, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import {
  applyMapLayerPreset,
  applyMapMode,
  applyMapStyleProfile,
  DEFAULT_MAP_SETTINGS,
  MAP_LAYER_PRESETS,
  MAP_MODES,
  mapLayerPresetIDForSettings,
  mapModeForSettings,
  normalizeMapSettings,
  type MapLayerSettings,
  type MapLayerPresetID,
  type MapModeID,
  type MapSettings,
  type NodeModelStyle,
  type PacketAnimationStyle,
  type RenderQuality
} from '../mapSettings';
import { MAP_STYLE_PROFILES, mapStyleProfileByID, type MapStyleProfileID } from '../map/styles/styleRegistry';
import { activeAssetPack } from '../assets/v3/assetPacks';

interface MapSettingsDrawerProps {
  settings: MapSettings;
  onChange: (settings: MapSettings) => void;
  onClose: () => void;
  onOpenPropagation?: () => void;
}

const WEATHER_CLOUDS_AVAILABLE = Boolean((import.meta.env['VITE_OPENWEATHERMAP_API_KEY'] as string | undefined)?.trim());

type LayerControl = { key: keyof MapLayerSettings; label: string; hint: string; unavailableHint?: string };

export const LAYER_GROUPS: readonly { label: string; controls: readonly LayerControl[] }[] = [
  {
    label: 'Base',
    controls: [
      { key: 'terrainHeightmap', label: 'Terrain relief', hint: 'Optional DEM hillshade and 3D elevation context' },
      { key: 'buildingExtrusions', label: '3D buildings', hint: 'Building extrusions from vector map tiles' },
      { key: 'weatherClouds', label: 'Weather clouds', hint: 'Live cloud cover overlay', unavailableHint: 'API key required' }
    ]
  },
  {
    label: 'Activity',
    controls: [
      { key: 'clusters', label: 'Clusters', hint: 'Grouped low-zoom node bubbles' },
      { key: 'activityHeatmap', label: 'Activity heatmap', hint: 'Recent activity glow' },
      { key: 'nodes', label: 'Nodes', hint: 'Individual public nodes and observers' },
      { key: 'liveComets', label: 'Packet comets', hint: 'Recent packet flight animations' },
      { key: 'packetResidue', label: 'Packet trails', hint: 'Recent route glow residue' },
      { key: 'observerBursts', label: 'Observer bursts', hint: 'Observer-only packet pings' },
      { key: 'messageBubbles', label: 'Message bubbles', hint: 'Public decoded text overlays' }
    ]
  },
  {
    label: 'Routes',
    controls: [
      { key: 'nodeLabels', label: 'Node labels', hint: 'Projected map labels' },
      { key: 'routes', label: 'Known pathways', hint: 'Idle public route lines' },
      { key: 'analysisPaths', label: 'Analysis paths', hint: 'Selected packets and plotted paths' }
    ]
  },
  {
    label: 'Analysis',
    controls: [
      { key: 'terrainLOS', label: 'Terrain line-of-sight', hint: 'RF terrain clearance color on 3D routes' },
      { key: 'propagationInsights', label: 'Propagation insights', hint: 'Long-distance route annotations and replay history' }
    ]
  },
  {
    label: 'Visuals',
    controls: [
      { key: 'nodeModels3D', label: '3D node models', hint: 'OpenFreeMap role models' },
      { key: 'routeArcs3D', label: '3D route arcs', hint: 'Elevated pathway arcs' },
      { key: 'packetComets3D', label: '3D packet comets', hint: 'OpenFreeMap mesh comets and trails' }
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

const NODE_MODEL_STYLES: readonly { value: NodeModelStyle; label: string }[] = [
  { value: 'role-towers', label: 'Role Towers' },
  { value: 'signal-beacons', label: 'Beacons' },
  { value: 'minimal-pins', label: 'Pins' }
];

const COMMON_LAYER_CONTROLS: readonly LayerControl[] = [
  { key: 'routes', label: 'Routes', hint: 'Public route lines' },
  { key: 'nodeLabels', label: 'Labels', hint: 'Node and observer labels' },
  { key: 'liveComets', label: 'Packet motion', hint: 'Recent packet motion' },
  { key: 'activityHeatmap', label: 'Activity heat', hint: 'Recent activity glow' },
  { key: 'terrainHeightmap', label: 'Terrain relief', hint: 'Optional hillshade or topo relief' }
];

const MODE_ICONS: Record<MapModeID, typeof RadioTower> = {
  watch: RadioTower,
  explore: Compass,
  terrain: Mountain,
  studio: Sparkles
};

type AdvancedSection = 'layers' | 'style' | 'packets' | 'rf';

export default function MapSettingsDrawer({ settings, onChange, onClose, onOpenPropagation }: MapSettingsDrawerProps) {
  const [advancedOpen, setAdvancedOpen] = useState<Record<AdvancedSection, boolean>>({
    layers: false,
    style: false,
    packets: false,
    rf: false
  });
  const activePresetID = mapLayerPresetIDForSettings(settings.layers);
  const activeStyleProfile = mapStyleProfileByID(settings.style.profileID);
  const activeMode = mapModeForSettings(settings);
  const enabledLayerCount = Object.values(settings.layers).filter(Boolean).length;
  const activeCommonLayers = COMMON_LAYER_CONTROLS.filter((control) => settings.layers[control.key])
    .map((control) => control.label)
    .slice(0, 2);
  const commonLayerSummary = activeCommonLayers.length > 0 ? activeCommonLayers.join(', ') : 'Minimal';
  const applyStyle = (profileID: MapStyleProfileID) => {
    onChange(applyMapStyleProfile(settings, profileID));
  };
  const applyPreset = (presetID: MapLayerPresetID) => {
    onChange(applyMapLayerPreset(settings, presetID));
  };
  const updateStyle = (key: keyof MapSettings['style'], value: string | number) => {
    onChange(normalizeMapSettings({ ...settings, customized: true, style: { ...settings.style, [key]: value } }));
  };
  const updateLayer = (key: keyof MapLayerSettings, value: boolean) => {
    onChange(normalizeMapSettings({ ...settings, customized: true, layers: { ...settings.layers, [key]: value } }));
  };
  const updatePacket = (key: keyof MapSettings['packets'], value: number | PacketAnimationStyle | RenderQuality) => {
    onChange(normalizeMapSettings({ ...settings, customized: true, packets: { ...settings.packets, [key]: value } }));
  };
  const updatePacketToggle = (key: keyof MapSettings['packets'], value: boolean) => {
    onChange(normalizeMapSettings({ ...settings, customized: true, packets: { ...settings.packets, [key]: value } }));
  };
  const applyModeID = (modeID: MapModeID) => {
    onChange(applyMapMode(settings, modeID));
  };
  const toggleAdvanced = (section: AdvancedSection) => {
    setAdvancedOpen((current) => ({ ...current, [section]: !current[section] }));
  };
  const advancedLayerGroups = LAYER_GROUPS.map((group) => ({
    ...group,
    controls: group.controls.filter((control) => {
      if (COMMON_LAYER_CONTROLS.some((common) => common.key === control.key)) return false;
      if (control.key === 'weatherClouds' && !WEATHER_CLOUDS_AVAILABLE) return false;
      return true;
    })
  })).filter((group) => group.controls.length > 0);
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

      <div className="map-settings-summary" aria-label="Active map setup">
        <span>
          <strong>{activeMode.label}</strong>
          <small>{activeStyleProfile.label}</small>
        </span>
        <span>
          <strong>{enabledLayerCount}</strong>
          <small>{commonLayerSummary}</small>
        </span>
      </div>

      <section className="map-settings-section">
        <h3>Modes</h3>
        <div className="map-settings-preset-grid map-mode-grid" role="group" aria-label="Map modes">
          {MAP_MODES.map((mode) => {
            const Icon = MODE_ICONS[mode.id];
            const selected = activeMode.id === mode.id && !settings.customized;
            return (
              <button
                key={mode.id}
                type="button"
                className={selected ? 'active' : ''}
                aria-pressed={selected}
                onClick={() => applyModeID(mode.id)}
                style={{ '--map-mode-art': `url(${activeAssetPack.maps[mode.profileID] ?? activeAssetPack.maps['classic-dark']})` } as CSSProperties}
              >
                <span className="map-mode-icon"><Icon size={18} /></span>
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </button>
            );
          })}
        </div>
        {settings.customized && (
          <p className="map-settings-mode-note">
            <SlidersHorizontal size={14} />
            <span>Custom view based on {activeMode.label}</span>
          </p>
        )}
      </section>

      <section className="map-settings-section">
        <h3>Common</h3>
        <div className="map-settings-toggle-list">
          {COMMON_LAYER_CONTROLS.map((control) => (
            <LayerToggle key={control.key} control={control} checked={settings.layers[control.key]} onChange={updateLayer} />
          ))}
        </div>
      </section>

      <section className="map-settings-section">
        <h3>Advanced</h3>
        <AdvancedSectionButton label="Layers" open={advancedOpen.layers} onClick={() => toggleAdvanced('layers')} />
        {advancedOpen.layers && (
          <div className="map-settings-layer-groups">
            {advancedLayerGroups.map((group) => (
              <div key={group.label} className="map-settings-layer-group">
                <h4>{group.label}</h4>
                <div className="map-settings-toggle-list">
                  {group.controls.map((control) => (
                    <div key={control.key} className="map-settings-toggle-wrap">
                      <LayerToggle control={control} checked={settings.layers[control.key]} onChange={updateLayer} />
                      {control.key === 'propagationInsights' && onOpenPropagation && (
                        <button type="button" className="map-settings-inline-action" onClick={onOpenPropagation}>
                          Open history
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <AdvancedSectionButton label="Style Library" open={advancedOpen.style} onClick={() => toggleAdvanced('style')} />
        {advancedOpen.style && (
          <>
            <div className="map-style-profile-grid" role="group" aria-label="Map style profiles">
              {MAP_STYLE_PROFILES.map((profile) => {
                const selected = activeStyleProfile.id === profile.id;
                return (
                  <button key={profile.id} type="button" className={selected ? 'active' : ''} aria-pressed={selected} onClick={() => applyStyle(profile.id)} style={{ '--map-profile-art': `url(${activeAssetPack.maps[profile.id] ?? activeAssetPack.maps['classic-dark']})` } as CSSProperties}>
                    <span>
                      <strong>{profile.label}</strong>
                      <small>{profile.sourceLabel}</small>
                    </span>
                    <em>{profile.terrainDefault ? 'terrain' : 'flat'}</em>
                  </button>
                );
              })}
            </div>
            <div className="map-settings-preset-grid" role="group" aria-label="Workflow presets">
              {MAP_LAYER_PRESETS.map((preset) => (
                <button key={preset.id} type="button" className={activePresetID === preset.id ? 'active' : ''} aria-pressed={activePresetID === preset.id} onClick={() => applyPreset(preset.id)}>
                  <strong>{preset.label}</strong>
                  <small>{preset.hint}</small>
                </button>
              ))}
            </div>
            <Slider label="Basemap dim" value={settings.style.basemapDim} min={0} max={0.78} step={0.02} suffix="x" onChange={(value) => updateStyle('basemapDim', value)} />
            <Slider label="Label density" value={settings.style.labelDensity} min={0} max={1.4} step={0.05} suffix="x" onChange={(value) => updateStyle('labelDensity', value)} />
          </>
        )}

        <AdvancedSectionButton label="Packet Motion" open={advancedOpen.packets} onClick={() => toggleAdvanced('packets')} />
        {advancedOpen.packets && (
          <>
            <Slider label="Speed" value={settings.packets.speed} min={0.5} max={3} step={0.1} suffix="x" onChange={(value) => updatePacket('speed', value)} />
            <Slider label="Brightness" value={settings.packets.brightness} min={0.4} max={1.6} step={0.05} suffix="x" onChange={(value) => updatePacket('brightness', value)} />
            <Slider label="Trail" value={settings.packets.trail} min={0} max={2} step={0.05} suffix="x" onChange={(value) => updatePacket('trail', value)} />
            <div className="map-settings-segmented" role="group" aria-label="Packet animation type">
              {ANIMATION_STYLES.map((style) => (
                <button key={style.value} type="button" className={settings.packets.animationStyle === style.value ? 'active' : ''} onClick={() => updatePacket('animationStyle', style.value)}>
                  {style.label}
                </button>
              ))}
            </div>
            <div className="map-settings-segmented" role="group" aria-label="Render quality">
              {RENDER_QUALITIES.map((quality) => (
                <button key={quality.value} type="button" className={settings.packets.renderQuality === quality.value ? 'active' : ''} onClick={() => updatePacket('renderQuality', quality.value)}>
                  {quality.label}
                </button>
              ))}
            </div>
            <label className="map-settings-toggle">
              <span>
                <strong>All-zoom live packets</strong>
                <small>Packet motion below detail zoom</small>
              </span>
              <input type="checkbox" checked={settings.packets.showLiveCometsAtAllZooms} onChange={(event) => updatePacketToggle('showLiveCometsAtAllZooms', event.target.checked)} />
            </label>
          </>
        )}

        <AdvancedSectionButton label="3D And RF" open={advancedOpen.rf} onClick={() => toggleAdvanced('rf')} />
        {advancedOpen.rf && (
          <>
            <div className="map-settings-segmented" role="group" aria-label="3D node model style">
              {NODE_MODEL_STYLES.map((style) => (
                <button key={style.value} type="button" className={settings.style.nodeModelStyle === style.value ? 'active' : ''} onClick={() => updateStyle('nodeModelStyle', style.value)}>
                  {style.label}
                </button>
              ))}
            </div>
            <Slider label="Terrain clarity" value={settings.style.terrainClarity} min={0} max={100} step={1} suffix="%" onChange={(value) => updateStyle('terrainClarity', value)} />
            <Slider label="Building opacity" value={settings.style.buildingOpacity} min={0} max={1} step={0.05} suffix="x" onChange={(value) => updateStyle('buildingOpacity', value)} />
            <Slider label="Node model scale" value={settings.style.nodeModelScale} min={0.55} max={1.8} step={0.05} suffix="x" onChange={(value) => updateStyle('nodeModelScale', value)} />
            <Slider label="Antenna height" value={settings.style.nodeAltitudeMeters} min={0} max={120} step={2} suffix=" m" onChange={(value) => updateStyle('nodeAltitudeMeters', value)} />
            <Slider label="Route arc height" value={settings.style.routeArcAltitudeScale} min={0.35} max={2.4} step={0.05} suffix="x" onChange={(value) => updateStyle('routeArcAltitudeScale', value)} />
            <p className="map-settings-note">
              <RadioTower size={14} />
              <span>{activeStyleProfile.supports3D ? '3D-ready style profile' : 'Flat style profile'}</span>
              <Layers size={14} />
              <span>{activeStyleProfile.supportsOffline ? 'offline-capable' : 'online tiles'}</span>
            </p>
          </>
        )}
      </section>

      <footer className="map-settings-footer">
        <ResetButton onConfirm={() => onChange(DEFAULT_MAP_SETTINGS)} />
        <span><SlidersHorizontal size={14} /> local browser preference</span>
      </footer>
    </aside>
  );
}

function LayerToggle({ control, checked, onChange }: { control: LayerControl; checked: boolean; onChange: (key: keyof MapLayerSettings, value: boolean) => void }) {
  return (
    <label className="map-settings-toggle">
      <span>
        <strong>{control.label}</strong>
        <small>{control.hint}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(control.key, event.target.checked)} />
    </label>
  );
}

function AdvancedSectionButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`map-settings-advanced-toggle ${open ? 'active' : ''}`} aria-expanded={open} onClick={onClick}>
      <span>{label}</span>
      <strong>{open ? 'Hide' : 'Show'}</strong>
    </button>
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
  const displayValue = suffix === '%' ? value.toFixed(0) : value.toFixed(value < 1 ? 2 : 1);
  return (
    <label className="map-settings-slider">
      <span>
        <strong>{label}</strong>
        <em>{displayValue}{suffix}</em>
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
