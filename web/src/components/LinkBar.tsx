import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ExternalLink, Gauge, Github, HelpCircle, History, List, Map, MessageSquareText, Network, RadioTower, Settings2, Sparkles, Wrench, X } from 'lucide-react';
import { appBrandLogo, appBrandName, appBrandURL, appVersion, buildNumber, buildTime, gitSha, releaseURL } from '../buildInfo';
import { routeAssetIcons } from '../assets/routes/assets';
import {
  GITHUB_REPO_API_URL,
  GITHUB_REPO_URL,
  commitURLForSha,
  formatBuildAge,
  normalizeRepoStats,
  parseBuildTime,
  readCachedRepoStats,
  shortBuildID,
  writeCachedRepoStats,
  type RepoStats
} from '../releaseInfo';

const GUIDE_DISMISS_KEY = 'mc-cartolive-welcome-guide-dismissed-2.5.46';

type InfoPanel = 'changelog' | 'features' | 'guide' | null;

const LATEST_CHANGELOG = [
  '2.5.46 exposes public-safe Packets projection-path counters so operators can see indexed projection serves vs conversion fallbacks.',
  '2.5.45 exposes public-safe packet-path projection backfill progress in health/readiness so operators can see upgrade catch-up.',
  '2.5.44 backfills missing recent public packet-path projections in bounded startup batches so upgraded DBs reach the fast Packets path sooner.',
  '2.5.43 adds internal public-safe packet-path projection groundwork so Packets can move away from conversion scans.',
  '2.5.42 updates CI and GHCR publish workflows to current Node 24-capable GitHub and Docker action majors.',
  '2.5.41 removes the remaining full stats multi-count query from the legacy public-state fallback path.',
  '2.5.40 removes the all-observer scan from ingest fallback endpoint matching and uses exact public-key/region observer lookup instead.',
  '2.5.39 removes periodic full-table stats queries from runtime counter logging on large production databases.',
  '2.5.36 adds a render quality control and lowers default 3D/canvas render pressure for smoother OpenFreeMap and flat-map motion.',
  '2.5.35 simplifies Perf into live/not-live status, slows Live Follow, expands palette coverage, and aligns NetGraph visuals with map icons.',
  '2.5.34 adds repeatable desktop/mobile browser smoke coverage and fixes mobile Perf/Packets panel clipping.',
  '2.5.33 improves selected OpenFreeMap packet replay with a trailing chase camera, smoother cadence, and distance-aware pitch.',
  '2.5.32 reduces OpenFreeMap 3D load at detail zoom with adaptive node/route budgets and lightweight marker LOD for ordinary nodes.',
  '2.5.31 fixes the remaining visible Chat repeat case by collapsing long rebroadcasted public text within a short repeat window, even when route/sender wrappers differ.',
  '2.5.30 reduces OpenFreeMap 3D route/comet render cost with cheaper ordinary arcs, cached comet paths, and fewer node-scene rebuilds.',
  '2.5.29 makes NetGraph palette-aware, including canvas background, selected pathways, labels, observer accents, and panel chrome.',
  '2.5.28 makes Perf a direct public-safe live status page for backend, API, MQTT, map motion, Packets, and Chat.',
  'Live Follow uses slower, lower-zoom camera moves and stricter movement spacing so it is watchable during busy traffic.',
  '2.5.27 makes active flat-map pathways thicker, clearer, and hue-shifted by recent packet frequency.',
  'Packet comet residue leaves short-lived sparkles so recent true packet movement is easier to spot.',
  '2.5.26 collapses repeated public Chat messages across the full 24h window, including symbol-only decoded texts.',
  '2.5.23 makes NetGraph calmer with locked pause, gentler topology settling, and less component spread.',
  'OpenFreeMap 3D avoids forced full scene rebuilds after every map move or zoom end.'
];

const FEATURE_LIST = [
  'Worldwide-ready public MeshCore map with configurable regions, map bounds, and instance branding.',
  'OpenFreeMap 3D mode with low-poly repeaters, companions, rooms, observer beacons, route arcs, and 3D comets.',
  'True-path Packets page for sanitized 24h packet browsing and cinematic route replay.',
  'NetGraph view for connected public RF topology with live pulses and compact node/pathway inspectors.',
  'Public Chat page for sanitized decoded text history with region, channel, and search filters.',
  'Hidden-by-default VCR for pause, scrub, replay, and 24h public-safe route history.',
  'Plot Routes, reachable-node phonebook, layer controls, themes, palettes, live health, and operator diagnostics.'
];

const GUIDE_STEPS = [
  'Use the layer button to switch between the original flat map and OpenFreeMap 3D.',
  'Open Packets to inspect only real public paths, then Replay to pause live and animate one packet route.',
  'Open NetGraph to see the connected public network as a live node graph.',
  'Use Map Settings for layers, 3D toggles, render quality, comet speed, brightness, trails, and animation style.',
  'Use Plot Routes and Select two for path analysis, or the VCR to replay public route history.'
];

interface LinkBarProps {
  perfOpen?: boolean;
  packetsOpen?: boolean;
  netGraphOpen?: boolean;
  chatOpen?: boolean;
  setupOpen?: boolean;
}

export default function LinkBar({ perfOpen = false, packetsOpen = false, netGraphOpen = false, chatOpen = false }: LinkBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [repoStats, setRepoStats] = useState<RepoStats | null>(() => readCachedRepoStats(browserStorage()));
  const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanel>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [hideWelcomeAgain, setHideWelcomeAgain] = useState(true);
  const brandName = appBrandName.trim() || 'MC-CartoLive';
  const brandURL = appBrandURL.trim() || GITHUB_REPO_URL;
  const brandLogo = appBrandLogo.trim() || routeAssetIcons.app;
  const buildAge = useMemo(() => formatBuildAge(buildTime, now), [buildTime, now]);
  const buildID = shortBuildID(buildNumber, gitSha);
  const commitURL = commitURLForSha(gitSha || buildNumber);
  const parsedBuildTime = parseBuildTime(buildTime);
  const buildDate = Number.isFinite(parsedBuildTime) ? new Date(parsedBuildTime).toLocaleString() : 'Build time unavailable';

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const storage = browserStorage();
    if (storage?.getItem(GUIDE_DISMISS_KEY) !== '1') {
      setWelcomeOpen(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const storage = browserStorage();
    const cached = readCachedRepoStats(storage);
    if (cached) {
      setRepoStats(cached);
      return undefined;
    }
    fetch(GITHUB_REPO_API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!active) return;
        const stats = normalizeRepoStats(payload);
        if (!stats) return;
        writeCachedRepoStats(storage, stats);
        setRepoStats(stats);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const dismissWelcomeGuide = () => {
    if (hideWelcomeAgain) {
      browserStorage()?.setItem(GUIDE_DISMISS_KEY, '1');
    }
    setWelcomeOpen(false);
  };

  return (
    <nav className="link-bar" aria-label="Project links">
      <a className="link-bar-brand" href={brandURL} target="_blank" rel="noreferrer" title={`Open ${brandName}`}>
        <img src={brandLogo} alt="" aria-hidden="true" />
        <span>{brandName}</span>
      </a>
      <div className="link-bar-build" aria-label={`MC-CartoLive version ${appVersion}, build ${buildNumber}`}>
        <strong>MC-CartoLive</strong>
        <a href={releaseURL} target="_blank" rel="noreferrer" title={`Open release v${appVersion}`}>
          v{appVersion}
        </a>
        <a href={commitURL} target="_blank" rel="noreferrer" title={`Open build commit ${gitSha || buildNumber}`}>
          build {buildID}
        </a>
        <span title={buildDate}>{buildAge}</span>
        <a className={`link-bar-perf ${perfOpen ? 'active' : ''}`} href="#/perf" title="Open performance lab">
          <Gauge size={13} />
          <span>Perf</span>
        </a>
        <a className={`link-bar-perf ${packetsOpen ? 'active' : ''}`} href="#/packets" title="Open true path packets">
          <List size={13} />
          <span>Packets</span>
        </a>
        <a className={`link-bar-perf ${netGraphOpen ? 'active' : ''}`} href="#/netgraph" title="Open live network graph">
          <Network size={13} />
          <span>NetGraph</span>
        </a>
        <a className={`link-bar-perf ${chatOpen ? 'active' : ''}`} href="#/chat" title="Open public chat history">
          <MessageSquareText size={13} />
          <span>Chat</span>
        </a>
      </div>
      <div className="link-bar-right">
        <div className="link-bar-info-actions" aria-label="Project information">
          <button
            className={activeInfoPanel === 'changelog' ? 'active' : ''}
            type="button"
            aria-pressed={activeInfoPanel === 'changelog'}
            title="Latest changelog"
            onClick={() => setActiveInfoPanel((panel) => panel === 'changelog' ? null : 'changelog')}
          >
            <History size={13} />
            <span>Changelog</span>
          </button>
          <button
            className={activeInfoPanel === 'features' ? 'active' : ''}
            type="button"
            aria-pressed={activeInfoPanel === 'features'}
            title="Feature list"
            onClick={() => setActiveInfoPanel((panel) => panel === 'features' ? null : 'features')}
          >
            <Sparkles size={13} />
            <span>Features</span>
          </button>
          <button
            className={activeInfoPanel === 'guide' ? 'active' : ''}
            type="button"
            aria-pressed={activeInfoPanel === 'guide'}
            title="Open guide"
            onClick={() => setActiveInfoPanel('guide')}
          >
            <HelpCircle size={13} />
            <span>Guide</span>
          </button>
        </div>
        <a className="link-bar-github" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" title="Open MC-CartoLive on GitHub">
          <Github size={15} />
          <span>{repoStats ? `${repoStats.stars.toLocaleString()} stars / ${repoStats.forks.toLocaleString()} forks` : 'GitHub'}</span>
          <ExternalLink size={12} />
        </a>
      </div>
      {activeInfoPanel === 'changelog' && (
        <InfoPopover title="Latest Changelog" icon={<History size={14} />} onClose={() => setActiveInfoPanel(null)}>
          <p>MC-CartoLive v{appVersion} continues the 2.6 production polish track with calmer live following, clearer map activity, route contrast fixes, and cleaner live-map chrome.</p>
          <ul>
            {LATEST_CHANGELOG.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <a href={releaseURL} target="_blank" rel="noreferrer">Open full release notes</a>
        </InfoPopover>
      )}
      {activeInfoPanel === 'features' && (
        <InfoPopover title="Feature List" icon={<Sparkles size={14} />} onClose={() => setActiveInfoPanel(null)}>
          <ul>
            {FEATURE_LIST.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </InfoPopover>
      )}
      {activeInfoPanel === 'guide' && (
        <GuideOverlay title="MC-CartoLive Guide" onClose={() => setActiveInfoPanel(null)} />
      )}
      {welcomeOpen && (
        <section className="welcome-guide-popover" role="dialog" aria-modal="false" aria-label="Welcome to MC-CartoLive">
          <button type="button" className="welcome-guide-close" title="Close welcome guide" onClick={() => setWelcomeOpen(false)}>
            <X size={15} />
          </button>
          <span className="panel-eyebrow">Welcome</span>
          <h2>MC-CartoLive v{appVersion}</h2>
          <p>Watch the public MeshCore network move live: flat map, OpenFreeMap 3D, true-path Packets, NetGraph, VCR replay, themes, and production-safe diagnostics.</p>
          <ul>
            {GUIDE_STEPS.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
          </ul>
          <label className="welcome-guide-check">
            <input type="checkbox" checked={hideWelcomeAgain} onChange={(event) => setHideWelcomeAgain(event.currentTarget.checked)} />
            <span>Do not show this on next visit</span>
          </label>
          <div className="welcome-guide-actions">
            <button type="button" onClick={() => setActiveInfoPanel('guide')}>Full guide</button>
            <button type="button" className="primary" onClick={dismissWelcomeGuide}>Start watching</button>
          </div>
        </section>
      )}
    </nav>
  );
}

function InfoPopover({ title, icon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <section className="link-bar-info-popover" role="dialog" aria-label={title}>
      <header>
        <span>{icon}</span>
        <strong>{title}</strong>
        <button type="button" title={`Close ${title}`} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="link-bar-info-body">{children}</div>
    </section>
  );
}

function GuideOverlay({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <section className="guide-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="guide-card">
        <header>
          <div>
            <span className="panel-eyebrow">Guide</span>
            <h2>{title}</h2>
          </div>
          <button type="button" title="Close guide" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="guide-grid">
          <GuideSection title="Map Views" tone="map" icon={<Map size={18} />} items={[
            'Original flat mode keeps the fast dark/light map and 2D route layer.',
            'OpenFreeMap 3D adds terrain, buildings, low-poly nodes, route arcs, and 3D packet comets.',
            'Map Settings can turn layers and 3D effects on or off without changing public data.'
          ]} />
          <GuideSection title="Traffic Tools" tone="traffic" icon={<Activity size={18} />} items={[
            'Live packet comets show only resolved public paths.',
            'Packets lists true path packets, filters across the selected window, and replays one route at a watchable speed.',
            'VCR can pause, scrub, and replay public route history without exposing private packet details.'
          ]} />
          <GuideSection title="Analysis" tone="analysis" icon={<Network size={18} />} items={[
            'Plot Routes and Select two compare known public pathways between nodes.',
            'Phonebook shows reachable public nodes from a selected repeater or room.',
            'NetGraph renders the connected RF topology with live pulses and node/path inspectors.'
          ]} />
          <GuideSection title="Operations" tone="ops" icon={<Gauge size={18} />} items={[
            'Perf shows whether the live deployment is healthy across backend, API, MQTT, map motion, Packets, and Chat.',
            'Health/readiness and smoke scripts help operators confirm live deployments.',
            'Public APIs stay sanitized: no raw hashes, full public keys, broker secrets, or resolver debug data.'
          ]} />
          <GuideSection title="World Deploys" tone="world" icon={<RadioTower size={18} />} items={[
            'Package installs can use generic region labels like r1, AUS, or EU-W.',
            'Operators can set their own brand name, logo, URL, region bounds, and public region allowlist.',
            'True routes remain resolver-backed; MC-CartoLive does not invent RF links from coordinates.'
          ]} />
          <GuideSection title="Controls" tone="controls" icon={<Settings2 size={18} />} items={[
            'Use palettes and light/dark mode to adapt the map for the room or screen.',
            'Layer controls can hide routes, nodes, packet comets, observer bursts, and 3D effects.',
            'VCR and Packets replay pause live traffic intentionally so one path can be inspected.'
          ]} />
        </div>
        <div className="guide-setup-actions">
          <a href="#/setup" onClick={onClose}>
            <Wrench size={15} />
            <span>Open first-run setup</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function GuideSection({ title, tone, icon, items }: { title: string; tone: string; icon: ReactNode; items: string[] }) {
  return (
    <section className={`guide-section guide-section-${tone}`}>
      <h3><span>{icon}</span>{title}</h3>
      <div className="guide-section-visual" aria-hidden="true">
        <span className="guide-visual-core">{icon}</span>
        <span className="guide-visual-route" />
        <span className="guide-visual-dot one" />
        <span className="guide-visual-dot two" />
        <span className="guide-visual-dot three" />
      </div>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
