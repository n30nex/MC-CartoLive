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
  readCachedRepoStats,
  shortBuildID,
  writeCachedRepoStats,
  type RepoStats
} from '../releaseInfo';

const GUIDE_DISMISS_KEY = 'mc-cartolive-welcome-guide-dismissed-2.5.18';

type InfoPanel = 'changelog' | 'features' | 'guide' | null;

const LATEST_CHANGELOG = [
  '2.5.18 collapses repeated decoded Chat rows by sender, text, and channel in a short display window so multi-observer reports do not flood the Chat page.',
  '2.5.17 dedupes Chat by internal packet identity so repeated routed observations do not repeat the same decoded message, while keeping distinct packet retransmits visible.',
  'Docker Compose runtime metadata now prefers GIT_SHA and BUILD_TIME so health/readiness reports match the deployed commit.',
  '2.5.16 collapses duplicate Chat rows from multi-segment routed packets and moves first-run Setup into the Guide instead of the permanent top bar.',
  '2.5.15 adds a public-safe Chat page for decoded public text history with region, channel, time-window, search, and paging controls.',
  'NetGraph is steadier: stable visible graph membership, deterministic edge lanes, selected-neighborhood helpers, mobile pinch zoom, role-matched node glyphs, and faster pulse matching.',
  'OpenFreeMap replay chase math now uses shared 3D route-arc samples so selected-packet cinematic replay can stay synchronized with 3D comets.',
  'Release checks now scan public JSON and the public websocket hello for raw hashes, raw hex, full keys, secrets, tokens, and debug fields.',
  '2.5.14 added a release metadata drift guard so version defaults, Docker tags, frontend package metadata, docs, and changelog stay in sync.',
  'OpenFreeMap 3D is lighter in dense views by prioritizing visible, focused, fresh, and selected nodes/routes before rebuilding the Three.js scene.',
  'Public text bubbles are back for sanitized decoded group messages, including reload/polling fallback when a sender or observer anchor is public-safe.',
  'Packets is clearer and safer: select focuses a path, Replay pauses live, scan status explains rare filters, and stale requests cannot replace newer searches.',
  'Live map polish: calmer Live Follow, compact status pills, aligned map/Legend role icons, readable VCR timeline bars, activity heatmap, and stronger light-mode route contrast.',
  'Operator polish: version-safe CI/package smoke, configurable instance branding, and world/private broker configuration without changing public privacy boundaries.'
];

const FEATURE_LIST = [
  'Worldwide-ready public MeshCore map with configurable regions, map bounds, and instance branding.',
  'OpenFreeMap 3D mode with low-poly repeaters, companions, rooms, observer beacons, route arcs, and 3D comets.',
  'True-path Packets page for sanitized 24h packet browsing and cinematic route replay.',
  'NetGraph view for connected public RF topology with live pulses and compact node/pathway inspectors.',
  'Public Chat page for sanitized decoded text history with region, channel, and search filters.',
  'Hidden-by-default VCR for pause, scrub, replay, and 24h public-safe route history.',
  'Plot Routes, reachable-node phonebook, layer controls, themes, palettes, Perf Lab, and operator diagnostics.'
];

const GUIDE_STEPS = [
  'Use the layer button to switch between the original flat map and OpenFreeMap 3D.',
  'Open Packets to inspect only real public paths, then Replay to pause live and animate one packet route.',
  'Open NetGraph to see the connected public network as a live node graph.',
  'Use Map Settings for layers, 3D toggles, comet speed, brightness, trails, and animation style.',
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
  const buildAge = useMemo(() => formatBuildAge(buildTime, now), [now]);
  const buildID = shortBuildID(buildNumber, gitSha);
  const commitURL = commitURLForSha(gitSha || buildNumber);
  const buildDate = Number.isFinite(Date.parse(buildTime)) ? new Date(buildTime).toLocaleString() : 'Build time unavailable';

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
            'Perf shows public-safe runtime health, queues, frame timing, and backend readiness.',
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
