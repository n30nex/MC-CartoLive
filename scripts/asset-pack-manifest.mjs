const PACKS = /** @type {const} */ (['world', 'canada']);

const PACK_PROFILE = {
  world: {
    label: 'MC-CartoLive',
    shortLabel: 'CartoLive',
    visualBrief: 'global public MeshCore live map, dark atlas UI, cyan radio telemetry, violet route glow, operational but welcoming'
  },
  canada: {
    label: 'Carto Live Canada',
    shortLabel: 'CartoLive CA',
    visualBrief: 'original Canada-inspired public mesh atlas, northern dark map, teal radio telemetry, restrained red accent, community deployment branding'
  }
};

const ROLE_ASSETS = [
  ['repeater', 'forwarder repeater tower with strong RF diamond silhouette'],
  ['companion', 'mobile companion node with compact triangular radio marker'],
  ['room', 'room server with stable square server beacon'],
  ['observer', 'observer/listener node with radar aperture and receive rings'],
  ['sensor', 'sensor node with pentagon telemetry beacon'],
  ['gateway', 'MQTT gateway bridge with linked radio and network glyph'],
  ['solar-repeater', 'solar powered repeater with panel and mast'],
  ['antenna-tower', 'antenna tower hardware marker'],
  ['mobile-companion', 'portable companion handset marker'],
  ['mqtt-bridge', 'MQTT bridge service marker'],
  ['unknown', 'unknown node with neutral fallback marker']
];

const PACKET_ASSETS = [
  ['dot_adv_64', 'ADVERT', 'node advert packet dot'],
  ['dot_txt_64', 'PLAIN_TEXT', 'plain text packet dot'],
  ['dot_grp_64', 'GROUP_TEXT', 'group text packet dot'],
  ['dot_data_64', 'GROUP_DATA', 'group data packet dot'],
  ['dot_trc_64', 'TRACE', 'trace route packet dot'],
  ['dot_ret_64', 'RETURNED_PATH', 'returned path packet dot'],
  ['dot_req_64', 'REQUEST', 'request/control packet dot'],
  ['dot_rsp_64', 'RESPONSE', 'response/control packet dot'],
  ['dot_ack_64', 'ACK', 'acknowledgement packet dot'],
  ['dot_ctl_64', 'CONTROL', 'control packet dot'],
  ['dot_oth_64', 'OTHER', 'other packet dot']
];

const EFFECT_ASSETS = [
  ['comet-head-128', 'live packet comet head glow kernel'],
  ['trail-noise-256', 'transparent route trail shimmer noise texture'],
  ['route-glow-256', 'route line payload glow kernel'],
  ['pulse-ring-256', 'arrival and replay pulse ring'],
  ['observer-aura-256', 'observer burst receive aura'],
  ['three-material-256', '3D packet comet material atlas'],
  ['message-spark-128', 'public message spark accent'],
  ['cluster-glow-256', 'cluster activity glow']
];

const MAP_ASSETS = [
  ['classic-dark', 'classic dark CARTO-compatible route map preview'],
  ['classic-light', 'classic light CARTO-compatible route map preview'],
  ['openfreemap-dark', 'OpenFreeMap dark vector preview'],
  ['openfreemap-light', 'OpenFreeMap light vector preview'],
  ['openfreemap-3d', 'pitched 3D terrain and route arcs preview'],
  ['topo-rf', 'topographic RF planning preview'],
  ['noc', 'NOC wallboard high contrast preview'],
  ['offline-pmtiles', 'offline PMTiles field map preview'],
  ['terrain-relief', 'terrain relief layer preview'],
  ['weather-clouds', 'weather cloud overlay preview'],
  ['activity-heatmap', 'activity heatmap layer preview']
];

const WORKSPACE_ASSETS = [
  ['map', 'main live map workspace preview'],
  ['packets', 'Packets and PacketTV workspace preview'],
  ['nodes', 'searchable Node List workspace preview'],
  ['netgraph', 'network graph workspace preview'],
  ['chat', 'public chat workspace preview'],
  ['setup', 'first-run setup workspace preview'],
  ['labs-waterfall', 'Packet Waterfall Labs workspace preview'],
  ['propagation', 'propagation and terrain insight workspace preview'],
  ['visitor-guide', 'visitor guide onboarding preview'],
  ['empty-state', 'quiet public-safe empty state preview']
];

export function buildAssetPackManifest() {
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  for (const pack of PACKS) {
    const profile = PACK_PROFILE[pack];
    addRecord(records, {
      id: `${pack}-brand-core`,
      pack,
      category: 'brand',
      prompt: `${profile.visualBrief}. Create original MC-CartoLive product branding assets: radio tower, route arcs, live packet telemetry, no exact third-party logos, no real packet IDs, no keys, no map labels.`,
      size: '1024x1024',
      targetFiles: [
        `web/src/assets/v3/${pack}/brand/app-icon-192.png`,
        `web/src/assets/v3/${pack}/brand/logo-wide-640x192.png`,
        `web/src/assets/v3/${pack}/brand/loading-mark-256.png`,
        `web/src/assets/v3/${pack}/brand/offline-mark-256.png`,
        `web/public/brand/${pack}/app-icon-192.png`,
        `web/public/brand/${pack}/app-icon-512.png`,
        `web/public/brand/${pack}/favicon-32.png`,
        `web/public/brand/${pack}/apple-touch-icon.png`,
        `web/public/brand/${pack}/logo-wide-640x192.png`
      ],
      acceptance: [
        'original inspired mark only',
        'legible at 32px and 64px',
        'no exact Canadaverse or MeshCore Canada marks'
      ]
    });
    addRecord(records, {
      id: `${pack}-social-release`,
      pack,
      category: 'brand',
      prompt: `${profile.visualBrief}. Create release hero and social card artwork for a privacy-safe MeshCore live map v3 launch, with abstract map networks, RF arcs, public packet motion, and no readable real identifiers.`,
      size: '2048x1152',
      targetFiles: [
        `web/public/brand/${pack}/social-card-1200x630.png`,
        `web/public/brand/${pack}/release-hero-1600x900.png`,
        `web/src/assets/v3/${pack}/brand/empty-state-480x270.png`
      ],
      acceptance: [
        'high quality launch artwork',
        'no readable private or live identifiers',
        'works behind UI overlays'
      ]
    });
    addRecord(records, {
      id: `${pack}-pwa-manifest`,
      pack,
      category: 'pwa',
      prompt: `${profile.visualBrief}. PWA manifest metadata for ${profile.label}.`,
      size: '1024x1024',
      format: 'json',
      targetFiles: [`web/public/brand/${pack}/manifest.json`],
      acceptance: ['manifest points only to committed pack-local icons']
    });
    for (const [role, brief] of ROLE_ASSETS) {
      addRecord(records, {
        id: `${pack}-role-${role}`,
        pack,
        category: 'role',
        prompt: `${profile.visualBrief}. Create a transparent-background app icon for ${brief}. The icon must be simple, high contrast, recognizable at map-marker size, and contain no text.`,
        size: '1024x1024',
        targetFiles: [`web/src/assets/v3/${pack}/roles/${role}-64.png`],
        postprocess: ['matte-alpha-mask', 'downsample-64'],
        acceptance: ['transparent PNG', 'readable at 64px', 'role silhouette is distinct']
      });
    }
    for (const [fileStem, payload, brief] of PACKET_ASSETS) {
      addRecord(records, {
        id: `${pack}-packet-${payload.toLowerCase().replace(/_/g, '-')}`,
        pack,
        category: 'packet',
        prompt: `${profile.visualBrief}. Create a transparent payload dot for ${brief}. It must be tiny, crisp, color coded, and contain no text.`,
        size: '1024x1024',
        targetFiles: [`web/src/assets/v3/${pack}/packets/${fileStem}.png`],
        postprocess: ['matte-alpha-mask', 'downsample-64'],
        acceptance: ['transparent PNG', 'payload color remains recognizable at 16px']
      });
    }
    for (const [effect, brief] of EFFECT_ASSETS) {
      addRecord(records, {
        id: `${pack}-effect-${effect}`,
        pack,
        category: 'effect',
        prompt: `${profile.visualBrief}. Create a transparent effect sprite for ${brief}. It must blend over MapLibre dark and light map styles and avoid obscuring true route geometry.`,
        size: '1024x1024',
        targetFiles: [`web/src/assets/v3/${pack}/effects/${effect}.png`],
        postprocess: ['matte-alpha-mask', 'downsample-effect'],
        acceptance: ['transparent PNG', 'soft edges', 'does not overpower map data']
      });
    }
    addRecord(records, {
      id: `${pack}-waterfall-stage`,
      pack,
      category: 'waterfall',
      prompt: `${profile.visualBrief}. Create Packet Waterfall v3 stage art: cinematic RF cascade, route ribbons, packet mist, dark radio atlas mood, no readable packet data or logos.`,
      size: '2048x1152',
      targetFiles: [
        `web/public/labs/waterfall/${pack}-rf-waterfall-bg.png`,
        `web/public/labs/waterfall/${pack}-rf-waterfall-mist.png`
      ],
      acceptance: ['nonblank cinematic backdrop', 'mist layer works as subtle overlay', 'public-safe abstract data only']
    });
    for (const [style, brief] of MAP_ASSETS) {
      addRecord(records, {
        id: `${pack}-map-${style}`,
        pack,
        category: 'map',
        prompt: `${profile.visualBrief}. Create a map style thumbnail for ${brief}. Use abstract map lines and safe synthetic nodes only.`,
        size: '1536x864',
        targetFiles: [`web/src/assets/v3/${pack}/maps/${style}-320x180.png`],
        acceptance: ['thumbnail communicates map layer purpose', 'no real labels or packet identifiers']
      });
    }
    for (const [workspace, brief] of WORKSPACE_ASSETS) {
      addRecord(records, {
        id: `${pack}-workspace-${workspace}`,
        pack,
        category: 'workspace',
        prompt: `${profile.visualBrief}. Create a workspace preview for ${brief}. Use product UI motifs, abstract signals, no exact screenshots, no readable private data.`,
        size: '1536x864',
        targetFiles: [`web/src/assets/v3/${pack}/workspaces/${workspace}-480x270.png`],
        acceptance: ['usable in cards and empty states', 'keeps operational tone', 'no screenshot-derived private content']
      });
    }
  }
  return records;
}

export { PACKS, PACK_PROFILE, ROLE_ASSETS, PACKET_ASSETS, EFFECT_ASSETS, MAP_ASSETS, WORKSPACE_ASSETS };

function addRecord(records, input) {
  records.push({
    model: 'gpt-image-2',
    quality: 'high',
    format: 'png',
    background: 'opaque',
    postprocess: [],
    ...input
  });
}
