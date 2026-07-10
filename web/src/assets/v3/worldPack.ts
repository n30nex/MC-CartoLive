import type { CartoAssetPack } from './assetPacks';

const roles = {
  repeater: new URL('./world/roles/repeater-64.png', import.meta.url).href,
  companion: new URL('./world/roles/companion-64.png', import.meta.url).href,
  room: new URL('./world/roles/room-64.png', import.meta.url).href,
  observer: new URL('./world/roles/observer-64.png', import.meta.url).href,
  sensor: new URL('./world/roles/sensor-64.png', import.meta.url).href,
  unknown: new URL('./world/roles/unknown-64.png', import.meta.url).href,
  gateway: new URL('./world/roles/gateway-64.png', import.meta.url).href,
  solarRepeater: new URL('./world/roles/solar-repeater-64.png', import.meta.url).href,
  antennaTower: new URL('./world/roles/antenna-tower-64.png', import.meta.url).href,
  mobileCompanion: new URL('./world/roles/mobile-companion-64.png', import.meta.url).href,
  mqttBridge: new URL('./world/roles/mqtt-bridge-64.png', import.meta.url).href
};

export const activeAssetPack: CartoAssetPack = {
  id: 'world', label: 'MC-CartoLive', shortLabel: 'CartoLive',
  brand: {
    appIcon: new URL('./world/brand/app-icon-192.png', import.meta.url).href,
    logoWide: new URL('./world/brand/logo-wide-640x192.png', import.meta.url).href,
    loadingMark: new URL('./world/brand/loading-mark-256.png', import.meta.url).href,
    offlineMark: new URL('./world/brand/offline-mark-256.png', import.meta.url).href,
    emptyState: new URL('./world/brand/empty-state-480x270.png', import.meta.url).href
  },
  public: publicAssets('world'), roles, hardware: roles,
  packets: {
    ADVERT: new URL('./world/packets/dot_adv_64.png', import.meta.url).href,
    PLAIN_TEXT: new URL('./world/packets/dot_txt_64.png', import.meta.url).href,
    GROUP_TEXT: new URL('./world/packets/dot_grp_64.png', import.meta.url).href,
    GROUP_DATA: new URL('./world/packets/dot_data_64.png', import.meta.url).href,
    TRACE: new URL('./world/packets/dot_trc_64.png', import.meta.url).href,
    RETURNED_PATH: new URL('./world/packets/dot_ret_64.png', import.meta.url).href,
    REQUEST: new URL('./world/packets/dot_req_64.png', import.meta.url).href,
    RESPONSE: new URL('./world/packets/dot_rsp_64.png', import.meta.url).href,
    ACK: new URL('./world/packets/dot_ack_64.png', import.meta.url).href,
    CONTROL: new URL('./world/packets/dot_ctl_64.png', import.meta.url).href,
    OTHER: new URL('./world/packets/dot_oth_64.png', import.meta.url).href
  },
  effects: {
    cometHead: new URL('./world/effects/comet-head-128.png', import.meta.url).href,
    trailNoise: new URL('./world/effects/trail-noise-256.png', import.meta.url).href,
    routeGlow: new URL('./world/effects/route-glow-256.png', import.meta.url).href,
    pulseRing: new URL('./world/effects/pulse-ring-256.png', import.meta.url).href,
    observerAura: new URL('./world/effects/observer-aura-256.png', import.meta.url).href,
    threeMaterial: new URL('./world/effects/three-material-256.png', import.meta.url).href,
    messageSpark: new URL('./world/effects/message-spark-128.png', import.meta.url).href,
    clusterGlow: new URL('./world/effects/cluster-glow-256.png', import.meta.url).href
  },
  maps: {
    'classic-dark': new URL('./world/maps/classic-dark-320x180.png', import.meta.url).href,
    'classic-light': new URL('./world/maps/classic-light-320x180.png', import.meta.url).href,
    'openfreemap-dark': new URL('./world/maps/openfreemap-dark-320x180.png', import.meta.url).href,
    'openfreemap-light': new URL('./world/maps/openfreemap-light-320x180.png', import.meta.url).href,
    'openfreemap-3d': new URL('./world/maps/openfreemap-3d-320x180.png', import.meta.url).href,
    'topo-rf': new URL('./world/maps/topo-rf-320x180.png', import.meta.url).href,
    noc: new URL('./world/maps/noc-320x180.png', import.meta.url).href,
    'offline-pmtiles': new URL('./world/maps/offline-pmtiles-320x180.png', import.meta.url).href,
    'terrain-relief': new URL('./world/maps/terrain-relief-320x180.png', import.meta.url).href,
    'weather-clouds': new URL('./world/maps/weather-clouds-320x180.png', import.meta.url).href,
    'activity-heatmap': new URL('./world/maps/activity-heatmap-320x180.png', import.meta.url).href
  },
  workspaces: {
    map: new URL('./world/workspaces/map-480x270.png', import.meta.url).href,
    packets: new URL('./world/workspaces/packets-480x270.png', import.meta.url).href,
    nodes: new URL('./world/workspaces/nodes-480x270.png', import.meta.url).href,
    netgraph: new URL('./world/workspaces/netgraph-480x270.png', import.meta.url).href,
    chat: new URL('./world/workspaces/chat-480x270.png', import.meta.url).href,
    setup: new URL('./world/workspaces/setup-480x270.png', import.meta.url).href,
    labsWaterfall: new URL('./world/workspaces/labs-waterfall-480x270.png', import.meta.url).href,
    propagation: new URL('./world/workspaces/propagation-480x270.png', import.meta.url).href,
    visitorGuide: new URL('./world/workspaces/visitor-guide-480x270.png', import.meta.url).href,
    emptyState: new URL('./world/workspaces/empty-state-480x270.png', import.meta.url).href
  }
};

function publicAssets(pack: 'world') {
  return { manifest: `/brand/${pack}/manifest.json`, favicon: `/brand/${pack}/favicon-32.png`, appleTouchIcon: `/brand/${pack}/apple-touch-icon.png`, appIcon192: `/brand/${pack}/app-icon-192.png`, appIcon512: `/brand/${pack}/app-icon-512.png`, logoWide: `/brand/${pack}/logo-wide-640x192.png`, socialCard: `/brand/${pack}/social-card-1200x630.png`, releaseHero: `/brand/${pack}/release-hero-1600x900.png`, waterfallBackground: `/labs/waterfall/${pack}-rf-waterfall-bg.png`, waterfallMist: `/labs/waterfall/${pack}-rf-waterfall-mist.png` };
}
