import { activeAssetPack as selectedAssetPack } from '@mc-active-asset-pack';

export type AssetPackID = 'world' | 'canada';

export interface CartoAssetPack {
  id: AssetPackID;
  label: string;
  shortLabel: string;
  brand: {
    appIcon: string;
    logoWide: string;
    loadingMark: string;
    offlineMark: string;
    emptyState: string;
  };
  public: {
    manifest: string;
    favicon: string;
    appleTouchIcon: string;
    appIcon192: string;
    appIcon512: string;
    logoWide: string;
    socialCard: string;
    releaseHero: string;
    waterfallBackground: string;
    waterfallMist: string;
  };
  roles: Record<string, string>;
  hardware: Record<string, string>;
  packets: Record<string, string>;
  effects: Record<string, string>;
  maps: Record<string, string>;
  workspaces: Record<string, string>;
}

export const activeAssetPack = selectedAssetPack;
export const activeAssetPackID = selectedAssetPack.id;

export function normalizeAssetPackID(value: string | undefined | null): AssetPackID {
  return value === 'canada' ? 'canada' : 'world';
}
