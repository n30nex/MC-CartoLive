type MapLibreProtocolHost = {
  addProtocol?: (scheme: string, handler: unknown) => void;
  removeProtocol?: (scheme: string) => void;
};

export interface PMTilesProtocolStatus {
  installed: boolean;
  reason?: 'disabled' | 'missing-package' | 'api-unavailable';
}

export async function installPMTilesProtocol(maplibregl: MapLibreProtocolHost, enabled: boolean): Promise<PMTilesProtocolStatus> {
  if (!enabled) return { installed: false, reason: 'disabled' };
  if (typeof maplibregl.addProtocol !== 'function') {
    return { installed: false, reason: 'api-unavailable' };
  }
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    const module = await dynamicImport('pmtiles') as { Protocol?: new () => { tile: unknown } };
    const protocol = module.Protocol ? new module.Protocol() : null;
    if (!protocol) return { installed: false, reason: 'missing-package' };
    maplibregl.addProtocol('pmtiles', protocol.tile);
    return { installed: true };
  } catch {
    return { installed: false, reason: 'missing-package' };
  }
}

export function removePMTilesProtocol(maplibregl: MapLibreProtocolHost): void {
  if (typeof maplibregl.removeProtocol === 'function') {
    maplibregl.removeProtocol('pmtiles');
  }
}
