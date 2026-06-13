import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, FlaskConical, Github, History, List, MessageSquareText, Network, X } from 'lucide-react';
import { appBrandLogo, appBrandName, appBrandURL, appVersion, buildNumber, buildTime, gitSha, releaseURL } from '../buildInfo';
import { routeAssetIcons } from '../assets/routes/assets';
import { DEFAULT_LAB_EXPERIMENT_ID, LAB_EXPERIMENTS, type LabExperimentID } from '../lab';
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

export const LATEST_RELEASE_HIGHLIGHTS = [
  {
    label: '2.9.5',
    title: 'Map Studio',
    body: 'Map Studio adds more basemap profiles, optional PMTiles offline views, and richer configurable 3D node and route rendering.'
  },
  {
    label: '2.9.4',
    title: 'Labs Polish',
    body: 'Every Labs experiment gets a routed page, a dropdown entry, clearer live signal context, stronger controls, and tuned visual polish.'
  },
  {
    label: '2.9.3',
    title: 'Live RF Labs',
    body: 'Labs turns sanitized public packets into opt-in sound, visual sequencers, waterfalls, constellations, radar, and message fireflies.'
  }
];

interface LinkBarProps {
  packetsOpen?: boolean;
  netGraphOpen?: boolean;
  chatOpen?: boolean;
  labOpen?: boolean;
  activeLabExperimentID?: LabExperimentID;
}

export default function LinkBar({ packetsOpen = false, netGraphOpen = false, chatOpen = false, labOpen = false, activeLabExperimentID = DEFAULT_LAB_EXPERIMENT_ID }: LinkBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [repoStats, setRepoStats] = useState<RepoStats | null>(() => readCachedRepoStats(browserStorage()));
  const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanel>(null);
  const [labsMenuOpen, setLabsMenuOpen] = useState(false);
  const brandName = appBrandName.trim() || 'MC-CartoLive';
  const brandURL = appBrandURL.trim() || GITHUB_REPO_URL;
  const brandLogo = appBrandLogo.trim() || routeAssetIcons.app;
  const buildAge = useMemo(() => formatBuildAge(buildTime, now), [buildTime, now]);
  const buildID = shortBuildID(buildNumber, gitSha);
  const commitURL = commitURLForSha(gitSha || buildNumber);
  const parsedBuildTime = parseBuildTime(buildTime);
  const buildDate = Number.isFinite(parsedBuildTime) ? new Date(parsedBuildTime).toLocaleString() : 'Build time unavailable';
  const activeLabExperiment = LAB_EXPERIMENTS.find((item) => item.id === activeLabExperimentID) ?? LAB_EXPERIMENTS[0];

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
        <div className={`link-bar-labs-menu ${labsMenuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`link-bar-page ${labOpen ? 'active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={labsMenuOpen}
            title={`Open Labs: ${activeLabExperiment.label}`}
            onClick={() => {
              setLabsMenuOpen((value) => !value);
              setActiveInfoPanel(null);
            }}
          >
            <FlaskConical size={13} />
            <span>Labs</span>
            <ChevronDown size={12} />
          </button>
          {labsMenuOpen && (
            <div className="link-bar-labs-popover" role="menu" aria-label="Labs experiments">
              {LAB_EXPERIMENTS.map((experiment) => (
                <a
                  key={experiment.id}
                  className={experiment.id === activeLabExperimentID ? 'active' : ''}
                  href={experiment.path}
                  role="menuitem"
                  title={experiment.detail}
                  style={{ '--lab-accent': experiment.accent } as CSSProperties}
                  onClick={() => setLabsMenuOpen(false)}
                >
                  <span className="lab-menu-dot" />
                  <span>
                    <strong>{experiment.label}</strong>
                    <em>{experiment.tagline}</em>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="link-bar-right">
        <div className="link-bar-info-actions" aria-label="Project information">
          <button
            className={activeInfoPanel === 'changelog' ? 'active' : ''}
            type="button"
            aria-pressed={activeInfoPanel === 'changelog'}
            title="Latest changelog"
            onClick={() => {
              setActiveInfoPanel((panel) => panel === 'changelog' ? null : 'changelog');
              setLabsMenuOpen(false);
            }}
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
          <p>Current public map baseline and the UX polish that makes live traffic easier to read.</p>
          <div className="link-bar-release-list">
            {LATEST_RELEASE_HIGHLIGHTS.map((item) => (
              <article key={`${item.label}-${item.title}`} className="link-bar-release-note">
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
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
