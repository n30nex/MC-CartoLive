import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, Github, History, List, MessageSquareText, Network, X } from 'lucide-react';
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

type InfoPanel = 'changelog' | null;

const LATEST_CHANGELOG = [
  '2.6.1 trims the public top bar, removes the Perf/Guide/Features buttons, and keeps Changelog as the single lightweight release note surface.',
  'Packets now opens cleaner, focuses a selected route directly on the map, and closes when replaying one bright forced packet comet.',
  'NetGraph is quieter on desktop and mobile with fewer controls, no empty inspector, and a hidden mobile legend.'
];

interface LinkBarProps {
  packetsOpen?: boolean;
  netGraphOpen?: boolean;
  chatOpen?: boolean;
}

export default function LinkBar({ packetsOpen = false, netGraphOpen = false, chatOpen = false }: LinkBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [repoStats, setRepoStats] = useState<RepoStats | null>(() => readCachedRepoStats(browserStorage()));
  const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanel>(null);
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
        <a className={`link-bar-page ${packetsOpen ? 'active' : ''}`} href="#/packets" title="Open true path packets">
          <List size={13} />
          <span>Packets</span>
        </a>
        <a className={`link-bar-page ${netGraphOpen ? 'active' : ''}`} href="#/netgraph" title="Open live network graph">
          <Network size={13} />
          <span>NetGraph</span>
        </a>
        <a className={`link-bar-page ${chatOpen ? 'active' : ''}`} href="#/chat" title="Open public chat history">
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
        </div>
        <a className="link-bar-github" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" title="Open MC-CartoLive on GitHub">
          <Github size={15} />
          <span>{repoStats ? `${repoStats.stars.toLocaleString()} stars / ${repoStats.forks.toLocaleString()} forks` : 'GitHub'}</span>
          <ExternalLink size={12} />
        </a>
      </div>
      {activeInfoPanel === 'changelog' && (
        <InfoPopover title="Latest Changelog" icon={<History size={14} />} onClose={() => setActiveInfoPanel(null)}>
          <p>MC-CartoLive v{appVersion} keeps the public map focused on live routes, Packets, NetGraph, Chat, and a cleaner top bar.</p>
          <ul>
            {LATEST_CHANGELOG.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <a href={releaseURL} target="_blank" rel="noreferrer">Open full release notes</a>
        </InfoPopover>
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

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
