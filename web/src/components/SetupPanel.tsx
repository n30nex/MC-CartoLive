import { Copy, ExternalLink, Globe2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PublicMapConfig } from '../types';

type SetupPreset = 'world' | 'canada' | 'custom';

interface SetupPanelProps {
  mapConfig?: PublicMapConfig | null;
  onClose: () => void;
}

interface SetupForm {
  preset: SetupPreset;
  publicBaseURL: string;
  regions: string;
  bounds: string;
  brandName: string;
  brandURL: string;
}

interface Validity {
  valid: boolean;
  message: string;
}

function validateBounds(value: string): Validity {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: '' };
  const parts = trimmed.split(',').map((s) => s.trim());
  if (parts.length !== 4) return { valid: false, message: 'Expected 4 comma-separated numbers' };
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return { valid: false, message: 'All values must be numbers' };
  const [minLat, minLng, maxLat, maxLng] = nums;
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) return { valid: false, message: 'Latitude must be between -90 and 90' };
  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180) return { valid: false, message: 'Longitude must be between -180 and 180' };
  if (minLat >= maxLat) return { valid: false, message: 'minLat must be less than maxLat' };
  if (minLng >= maxLng) return { valid: false, message: 'minLng must be less than maxLng' };
  return { valid: true, message: 'Valid bounds' };
}

function validateURL(value: string): Validity {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: '' };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { valid: false, message: 'URL must start with http:// or https://' };
    return { valid: true, message: 'Valid URL' };
  } catch {
    return { valid: false, message: 'Invalid URL format' };
  }
}

const DEFAULT_BOUNDS = {
  world: '-85,-180,85,180',
  canada: '41,-142,84,-52',
  custom: '-85,-180,85,180'
} as const;

export default function SetupPanel({ mapConfig, onClose }: SetupPanelProps) {
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<SetupForm>(() => ({
    preset: setupPresetFromConfig(mapConfig),
    publicBaseURL: 'https://your-hostname.example',
    regions: setupPresetFromConfig(mapConfig) === 'canada' ? 'YYZ,YOW,YKF,YUL,YVR' : '',
    bounds: boundsFromConfig(mapConfig) ?? DEFAULT_BOUNDS[setupPresetFromConfig(mapConfig)],
    brandName: 'MC-CartoLive',
    brandURL: 'https://github.com/n30nex/MC-CartoLive'
  }));
  const envSnippet = useMemo(() => buildSetupEnvSnippet(form), [form]);
  const boundsValidity = useMemo(() => validateBounds(form.bounds), [form.bounds]);
  const urlValidity = useMemo(() => validateURL(form.publicBaseURL), [form.publicBaseURL]);

  const updatePreset = (preset: SetupPreset) => {
    setForm((current) => ({
      ...current,
      preset,
      regions: preset === 'canada' ? 'YYZ,YOW,YKF,YUL,YVR' : current.regions,
      bounds: DEFAULT_BOUNDS[preset]
    }));
    setCopied(false);
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(envSnippet);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="setup-panel" role="dialog" aria-label="First-run setup">
      <header className="setup-panel-header">
        <div>
          <span className="panel-eyebrow">Setup</span>
          <h2>First-run deployment setup</h2>
          <p>Generate a public-safe starting `.env` for worldwide, Canada, or custom private broker installs.</p>
        </div>
        <button type="button" className="panel-close-button" title="Close setup" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="setup-grid">
        <section className="setup-card setup-card-primary">
          <h3><Globe2 size={17} /> Deployment scope</h3>
          <div className="setup-presets" role="group" aria-label="Map region preset">
            {(['world', 'canada', 'custom'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                className={form.preset === preset ? 'active' : ''}
                onClick={() => updatePreset(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <label>
            <span>Public URL</span>
            <input
              value={form.publicBaseURL}
              onChange={(event) => setForm((current) => ({ ...current, publicBaseURL: event.currentTarget.value }))}
              placeholder="https://your-hostname.example"
            />
            {form.publicBaseURL && urlValidity.message && (
              <span className={`setup-validation ${urlValidity.valid ? 'valid' : 'invalid'}`}>
                {urlValidity.valid ? <>&#10003;</> : <>&#10007;</>} {urlValidity.message}
              </span>
            )}
          </label>
          <label>
            <span>Public regions</span>
            <input
              value={form.regions}
              onChange={(event) => setForm((current) => ({ ...current, regions: event.currentTarget.value }))}
              placeholder="Empty allows all safe region labels"
            />
          </label>
          <label>
            <span>Map bounds</span>
            <input
              value={form.bounds}
              onChange={(event) => setForm((current) => ({ ...current, bounds: event.currentTarget.value }))}
              placeholder="minLat,minLng,maxLat,maxLng"
            />
            {form.bounds && boundsValidity.message && (
              <span className={`setup-validation ${boundsValidity.valid ? 'valid' : 'invalid'}`}>
                {boundsValidity.valid ? <>&#10003;</> : <>&#10007;</>} {boundsValidity.message}
              </span>
            )}
          </label>
          <div className="setup-note">
            <strong>True routes stay resolver-backed.</strong>
            <span>MC-CartoLive does not invent RF links from coordinates, names, or map distance.</span>
          </div>
        </section>

        <section className="setup-card">
          <h3>Branding</h3>
          <label>
            <span>Instance name</span>
            <input
              value={form.brandName}
              onChange={(event) => setForm((current) => ({ ...current, brandName: event.currentTarget.value }))}
              placeholder="MC-CartoLive"
            />
          </label>
          <label>
            <span>Instance link</span>
            <input
              value={form.brandURL}
              onChange={(event) => setForm((current) => ({ ...current, brandURL: event.currentTarget.value }))}
              placeholder="https://github.com/n30nex/MC-CartoLive"
            />
          </label>
          <div className="setup-note">
            <strong>Secrets stay private.</strong>
            <span>Add MQTT credentials and channel secrets only in your private `.env` or host secret store.</span>
          </div>
        </section>

        <section className="setup-card setup-output">
          <h3>Generated `.env` starter</h3>
          <pre>{envSnippet}</pre>
          <div className="setup-actions">
            <button type="button" onClick={copySnippet}>
              <Copy size={15} />
              <span>{copied ? 'Copied' : 'Copy snippet'}</span>
            </button>
            <a href="https://github.com/n30nex/MC-CartoLive/blob/main/docs/production.md" target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              <span>Production docs</span>
            </a>
          </div>
        </section>
      </div>
    </section>
  );
}

export function buildSetupEnvSnippet(form: SetupForm): string {
  const lines = [
    'PUBLIC_MODE=true',
    `PUBLIC_BASE_URL=${form.publicBaseURL.trim() || 'https://your-hostname.example'}`,
    'MQTT_ENABLED=true',
    'MQTT_TOPIC=meshcore/#',
    `MAP_REGION_PRESET=${form.preset}`,
    `PUBLIC_REGIONS=${form.regions.trim()}`,
    `MAP_BOUNDS=${form.preset === 'custom' ? form.bounds.trim() : ''}`,
    `VITE_APP_BRAND_NAME=${form.brandName.trim() || 'MC-CartoLive'}`,
    `VITE_APP_BRAND_URL=${form.brandURL.trim() || 'https://github.com/n30nex/MC-CartoLive'}`,
    'VITE_APP_BRAND_LOGO='
  ];
  return lines.join('\n');
}

function setupPresetFromConfig(config?: PublicMapConfig | null): SetupPreset {
  const preset = config?.regionPreset?.toLowerCase();
  if (preset === 'canada' || preset === 'custom') return preset;
  return 'world';
}

function boundsFromConfig(config?: PublicMapConfig | null): string | null {
  if (!config?.bounds) return null;
  const { minLat, minLng, maxLat, maxLng } = config.bounds;
  return [minLat, minLng, maxLat, maxLng].map((value) => Number.isFinite(value) ? String(value) : '').join(',');
}
