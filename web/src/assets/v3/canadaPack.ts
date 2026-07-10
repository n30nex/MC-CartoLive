import type { CartoAssetPack } from './assetPacks';

const roles = {
  repeater: new URL('./canada/roles/repeater-64.png', import.meta.url).href,
  companion: new URL('./canada/roles/companion-64.png', import.meta.url).href,
  room: new URL('./canada/roles/room-64.png', import.meta.url).href,
  observer: new URL('./canada/roles/observer-64.png', import.meta.url).href,
  sensor: new URL('./canada/roles/sensor-64.png', import.meta.url).href,
  unknown: new URL('./canada/roles/unknown-64.png', import.meta.url).href,
  gateway: new URL('./canada/roles/gateway-64.png', import.meta.url).href,
  solarRepeater: new URL('./canada/roles/solar-repeater-64.png', import.meta.url).href,
  antennaTower: new URL('./canada/roles/antenna-tower-64.png', import.meta.url).href,
  mobileCompanion: new URL('./canada/roles/mobile-companion-64.png', import.meta.url).href,
  mqttBridge: new URL('./canada/roles/mqtt-bridge-64.png', import.meta.url).href
};

export const activeAssetPack: CartoAssetPack = {
  id: 'canada', label: 'Carto Live Canada', shortLabel: 'CartoLive CA',
  brand: {
    appIcon: new URL('./canada/brand/app-icon-192.png', import.meta.url).href,
    logoWide: new URL('./canada/brand/logo-wide-640x192.png', import.meta.url).href,
    loadingMark: new URL('./canada/brand/loading-mark-256.png', import.meta.url).href,
    offlineMark: new URL('./canada/brand/offline-mark-256.png', import.meta.url).href,
    emptyState: new URL('./canada/brand/empty-state-480x270.png', import.meta.url).href
  },
  public: publicAssets('canada'), roles, hardware: roles,
  packets: {
    ADVERT: new URL('./canada/packets/dot_adv_64.png', import.meta.url).href,
    PLAIN_TEXT: new URL('./canada/packets/dot_txt_64.png', import.meta.url).href,
    GROUP_TEXT: new URL('./canada/packets/dot_grp_64.png', import.meta.url).href,
    GROUP_DATA: new URL('./canada/packets/dot_data_64.png', import.meta.url).href,
    TRACE: new URL('./canada/packets/dot_trc_64.png', import.meta.url).href,
    RETURNED_PATH: new URL('./canada/packets/dot_ret_64.png', import.meta.url).href,
    REQUEST: new URL('./canada/packets/dot_req_64.png', import.meta.url).href,
    RESPONSE: new URL('./canada/packets/dot_rsp_64.png', import.meta.url).href,
    ACK: new URL('./canada/packets/dot_ack_64.png', import.meta.url).href,
    CONTROL: new URL('./canada/packets/dot_ctl_64.png', import.meta.url).href,
    OTHER: new URL('./canada/packets/dot_oth_64.png', import.meta.url).href
  },
  effects: {
    cometHead: new URL('./canada/effects/comet-head-128.png', import.meta.url).href,
    trailNoise: new URL('./canada/effects/trail-noise-256.png', import.meta.url).href,
    routeGlow: new URL('./canada/effects/route-glow-256.png', import.meta.url).href,
    pulseRing: new URL('./canada/effects/pulse-ring-256.png', import.meta.url).href,
    observerAura: new URL('./canada/effects/observer-aura-256.png', import.meta.url).href,
    threeMaterial: new URL('./canada/effects/three-material-256.png', import.meta.url).href,
    messageSpark: new URL('./canada/effects/message-spark-128.png', import.meta.url).href,
    clusterGlow: new URL('./canada/effects/cluster-glow-256.png', import.meta.url).href
  },
  maps: {
    'classic-dark': new URL('./canada/maps/classic-dark-320x180.png', import.meta.url).href,
    'classic-light': new URL('./canada/maps/classic-light-320x180.png', import.meta.url).href,
    'openfreemap-dark': new URL('./canada/maps/openfreemap-dark-320x180.png', import.meta.url).href,
    'openfreemap-light': new URL('./canada/maps/openfreemap-light-320x180.png', import.meta.url).href,
    'openfreemap-3d': new URL('./canada/maps/openfreemap-3d-320x180.png', import.meta.url).href,
    'topo-rf': new URL('./canada/maps/topo-rf-320x180.png', import.meta.url).href,
    noc: new URL('./canada/maps/noc-320x180.png', import.meta.url).href,
    'offline-pmtiles': new URL('./canada/maps/offline-pmtiles-320x180.png', import.meta.url).href,
    'terrain-relief': new URL('./canada/maps/terrain-relief-320x180.png', import.meta.url).href,
    'weather-clouds': new URL('./canada/maps/weather-clouds-320x180.png', import.meta.url).href,
    'activity-heatmap': new URL('./canada/maps/activity-heatmap-320x180.png', import.meta.url).href
  },
  workspaces: {
    map: new URL('./canada/workspaces/map-480x270.png', import.meta.url).href,
    packets: new URL('./canada/workspaces/packets-480x270.png', import.meta.url).href,
    nodes: new URL('./canada/workspaces/nodes-480x270.png', import.meta.url).href,
    netgraph: new URL('./canada/workspaces/netgraph-480x270.png', import.meta.url).href,
    chat: new URL('./canada/workspaces/chat-480x270.png', import.meta.url).href,
    setup: new URL('./canada/workspaces/setup-480x270.png', import.meta.url).href,
    labsWaterfall: new URL('./canada/workspaces/labs-waterfall-480x270.png', import.meta.url).href,
    propagation: new URL('./canada/workspaces/propagation-480x270.png', import.meta.url).href,
    visitorGuide: new URL('./canada/workspaces/visitor-guide-480x270.png', import.meta.url).href,
    emptyState: new URL('./canada/workspaces/empty-state-480x270.png', import.meta.url).href
  }
};

function publicAssets(pack: 'canada') {
  return { manifest: `/brand/${pack}/manifest.json`, favicon: `/brand/${pack}/favicon-32.png`, appleTouchIcon: `/brand/${pack}/apple-touch-icon.png`, appIcon192: `/brand/${pack}/app-icon-192.png`, appIcon512: `/brand/${pack}/app-icon-512.png`, logoWide: `/brand/${pack}/logo-wide-640x192.png`, socialCard: `/brand/${pack}/social-card-1200x630.png`, releaseHero: `/brand/${pack}/release-hero-1600x900.png`, waterfallBackground: `/labs/waterfall/${pack}-rf-waterfall-bg.png`, waterfallMist: `/labs/waterfall/${pack}-rf-waterfall-mist.png` };
}
