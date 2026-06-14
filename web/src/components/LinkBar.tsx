import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, FlaskConical, Github, History, List, MessageSquareText, Network, RadioTower, X } from 'lucide-react';
import { appBrandLogo, appBrandName, appBrandURL, appVersion, buildNumber, buildTime, gitSha, releaseURL } from '../buildInfo';
import { routeAssetIcons } from '../assets/routes/assets';
import { activeAssetPack } from '../assets/v3/assetPacks';
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
    label: '3.0.0',
    title: 'Asset Pack v3',
    body: 'World and Canada presets now ship curated v3 branding, node, packet, map, workspace, and motion assets without runtime image-generation calls.'
  },
  {
    label: '2.9.6',
    title: 'Waterfall Labs',
    body: 'Labs is now a single cinematic Packet Waterfall with generated RF-waterfall art, capped falling packet motion, and opt-in rhythmic synth audio.'
  },
  {
    label: '2.9.5',
    title: 'Map Studio',
    body: 'Map Studio adds more basemap profiles, optional PMTiles offline views, and richer configurable 3D node and route rendering.'
  }
];

export const WORKSPACE_LINKS = [
  { id: 'packets', label: 'Packets', href: '#/packets' },
  { id: 'nodes', label: 'Nodes', href: '#/nodes' },
  { id: 'chat', label: 'Chat', href: '#/chat' },
  { id: 'netgraph', label: 'NetGraph', href: '#/netgraph' },
  { id: 'labs', label: 'Labs', href: '#/lab/waterfall' }
] as const;

interface LinkBarProps {
  packetsOpen?: boolean;
  netGraphOpen?: boolean;
  chatOpen?: boolean;
  labOpen?: boolean;
  nodeListOpen?: boolean;
  activeLabExperimentID?: LabExperimentID;
}

export default function LinkBar({ packetsOpen = false, netGraphOpen = false, chatOpen = false, labOpen = false, nodeListOpen = false, activeLabExperimentID = DEFAULT_LAB_EXPERIMENT_ID }: LinkBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [repoStats, setRepoStats] = useState<RepoStats | null>(() => readCachedRepoStats(browserStorage()));
  const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanel>(null);
  const [workspacesMenuOpen, setWorkspacesMenuOpen] = useState(false);
  const brandName = appBrandName.trim() || 'MC-CartoLive';
  const brandURL = appBrandURL.trim() || GITHUB_REPO_URL;
  const brandLogo = appBrandLogo.trim() || routeAssetIcons.app || activeAssetPack.brand.appIcon;
  const buildAge = useMemo(() => formatBuildAge(buildTime, now), [buildTime, now]);
  const buildID = shortBuildID(buildNumber, gitSha);
  const commitURL = commitURLForSha(gitSha || buildNumber);
  const parsedBuildTime = parseBuildTime(buildTime);
  const buildDate = Number.isFinite(parsedBuildTime) ? new Date(parsedBuildTime).toLocaleString() : 'Build time unavailable';
  const activeLabExperiment = LAB_EXPERIMENTS.find((item) => item.id === activeLabExperimentID) ?? LAB_EXPERIMENTS[0];
  const workspaceActive = packetsOpen || netGraphOpen || chatOpen || labOpen || nodeListOpen;

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
        <div className={`link-bar-labs-menu link-bar-workspaces-menu ${workspacesMenuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`link-bar-page ${workspaceActive ? 'active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={workspacesMenuOpen}
            title="Open workspaces"
            onClick={() => {
              setWorkspacesMenuOpen((value) => !value);
              setActiveInfoPanel(null);
            }}
          >
            <List size={13} />
            <span>Workspaces</span>
            <ChevronDown size={12} />
          </button>
          {workspacesMenuOpen && (
            <div className="link-bar-labs-popover link-bar-workspaces-popover" role="menu" aria-label="Workspaces">
              <WorkspaceLink active={packetsOpen} href="#/packets" icon={<List size={14} />} label="Packets" onClick={() => setWorkspacesMenuOpen(false)} />
              <WorkspaceLink active={nodeListOpen} href="#/nodes" icon={<RadioTower size={14} />} label="Nodes" onClick={() => setWorkspacesMenuOpen(false)} />
              <WorkspaceLink active={chatOpen} href="#/chat" icon={<MessageSquareText size={14} />} label="Chat" onClick={() => setWorkspacesMenuOpen(false)} />
              <WorkspaceLink active={netGraphOpen} href="#/netgraph" icon={<Network size={14} />} label="NetGraph" onClick={() => setWorkspacesMenuOpen(false)} />
              <a
                className={labOpen ? 'active' : ''}
                href={activeLabExperiment.path}
                role="menuitem"
                title={`Open Labs: ${activeLabExperiment.label}`}
                style={{ '--lab-accent': activeLabExperiment.accent } as CSSProperties}
                onClick={() => setWorkspacesMenuOpen(false)}
              >
                <FlaskConical size={14} />
                <span>
                  <strong>Labs</strong>
                  <em>{activeLabExperiment.label}</em>
                </span>
              </a>
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
            title="About"
            onClick={() => {
              setActiveInfoPanel((panel) => panel === 'changelog' ? null : 'changelog');
              setWorkspacesMenuOpen(false);
            }}
          >
            <History size={13} />
            <span>About</span>
          </button>
        </div>
      </div>
      {activeInfoPanel === 'changelog' && (
        <InfoPopover title="About" icon={<History size={14} />} onClose={() => setActiveInfoPanel(null)}>
          <p>Version {appVersion} · build <a href={commitURL} target="_blank" rel="noreferrer">{buildID}</a> · <span title={buildDate}>{buildAge}</span></p>
          <p>Asset pack: {activeAssetPack.label}</p>
          <div className="link-bar-release-list">
            {LATEST_RELEASE_HIGHLIGHTS.map((item) => (
              <article key={`${item.label}-${item.title}`} className="link-bar-release-note">
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            <Github size={13} />
            <span>{repoStats ? `${repoStats.stars.toLocaleString()} stars / ${repoStats.forks.toLocaleString()} forks` : 'GitHub'}</span>
            <ExternalLink size={12} />
          </a>
          <a href={releaseURL} target="_blank" rel="noreferrer">Open full release notes</a>
        </InfoPopover>
      )}
    </nav>
  );
}

function WorkspaceLink({ active, href, icon, label, onClick }: { active: boolean; href: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <a className={active ? 'active' : ''} href={href} role="menuitem" onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
      </span>
    </a>
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
