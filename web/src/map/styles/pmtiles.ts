import { Protocol } from 'pmtiles';

type MapLibreProtocolHost = {
  addProtocol?: (scheme: string, handler: any) => void;
  removeProtocol?: (scheme: string) => void;
};

export interface PMTilesProtocolStatus {
  installed: boolean;
  reason?: 'disabled' | 'missing-package' | 'api-unavailable';
}

let installed = false;

export function installPMTilesProtocol(maplibregl: MapLibreProtocolHost, enabled: boolean): PMTilesProtocolStatus {
  if (!enabled) return { installed: false, reason: 'disabled' };
  if (installed) return { installed: true };
  if (typeof maplibregl.addProtocol !== 'function') {
    return { installed: false, reason: 'api-unavailable' };
  }
  try {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    installed = true;
    return { installed: true };
  } catch {
    return { installed: false, reason: 'missing-package' };
  }
}

export function removePMTilesProtocol(maplibregl: MapLibreProtocolHost): void {
  if (typeof maplibregl.removeProtocol === 'function') {
    maplibregl.removeProtocol('pmtiles');
    installed = false;
  }
}
