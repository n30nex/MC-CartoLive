import { useCallback, useEffect, useState } from 'react';
import type { WorkspacePresentation } from '../components/workspacePanel';
import {
  DEFAULT_LAB_EXPERIMENT_ID,
  canonicalLabHash,
  labExperimentIDFromHash,
  labExperimentPath,
  type LabExperimentID
} from '../lab';

export type PacketsPanelMode = 'expanded' | 'compactTray';

interface WorkspaceNavigationOptions {
  onWorkspaceRouteOpened: () => void;
}

function clearHashRoute(hash: string): void {
  if (window.location.hash !== hash) return;
  window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
}

function isLabRoute(hash: string): boolean {
  return hash === '#/lab' || hash.startsWith('#/lab/');
}

/**
 * Owns hash-driven workspace routing and presentation state. Map overlays remain
 * in App because they are not routes and may be combined with a workspace.
 */
export function useWorkspaceNavigation({
  onWorkspaceRouteOpened
}: WorkspaceNavigationOptions) {
  const [packetsOpen, setPacketsOpen] = useState(() => window.location.hash === '#/packets');
  const [netGraphOpen, setNetGraphOpen] = useState(() => window.location.hash === '#/netgraph');
  const [chatOpen, setChatOpen] = useState(() => window.location.hash === '#/chat');
  const [labOpen, setLabOpen] = useState(() => isLabRoute(window.location.hash));
  const [labExperimentID, setLabExperimentID] = useState<LabExperimentID>(() => isLabRoute(window.location.hash)
    ? labExperimentIDFromHash(window.location.hash)
    : DEFAULT_LAB_EXPERIMENT_ID);
  const [setupOpen, setSetupOpen] = useState(() => window.location.hash === '#/setup');
  const [nodeListOpen, setNodeListOpen] = useState(() => window.location.hash === '#/nodes');
  const [packetsPanelMode, setPacketsPanelMode] = useState<PacketsPanelMode>('expanded');
  const [workspacePresentation, setWorkspacePresentation] = useState<WorkspacePresentation>('side');

  useEffect(() => {
    const updateRoute = () => {
      let hash = window.location.hash;
      if (hash === '#/perf') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        hash = '';
      }
      const canonicalLabRoute = canonicalLabHash(hash);
      if (canonicalLabRoute && hash !== canonicalLabRoute) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${canonicalLabRoute}`);
        hash = canonicalLabRoute;
      }
      const nextPacketsOpen = hash === '#/packets';
      const nextNetGraphOpen = hash === '#/netgraph';
      const nextChatOpen = hash === '#/chat';
      const nextLabOpen = isLabRoute(hash);
      const nextSetupOpen = hash === '#/setup';
      const nextNodeListOpen = hash === '#/nodes';
      setPacketsOpen(nextPacketsOpen);
      setNetGraphOpen(nextNetGraphOpen);
      setChatOpen(nextChatOpen);
      setLabOpen(nextLabOpen);
      setLabExperimentID(nextLabOpen ? labExperimentIDFromHash(hash) : DEFAULT_LAB_EXPERIMENT_ID);
      setSetupOpen(nextSetupOpen);
      setNodeListOpen(nextNodeListOpen);
      if (nextLabOpen || nextNodeListOpen) {
        setWorkspacePresentation('fullscreen');
      } else if (nextPacketsOpen || nextChatOpen) {
        setWorkspacePresentation('side');
      }
      if (nextPacketsOpen || nextNetGraphOpen || nextChatOpen || nextLabOpen || nextSetupOpen || nextNodeListOpen) {
        onWorkspaceRouteOpened();
      }
      if (nextPacketsOpen) setPacketsPanelMode('expanded');
    };
    updateRoute();
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, [onWorkspaceRouteOpened]);

  const closePackets = useCallback(() => {
    clearHashRoute('#/packets');
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
  }, []);

  const closeNetGraph = useCallback(() => {
    clearHashRoute('#/netgraph');
    setNetGraphOpen(false);
  }, []);

  const closeChat = useCallback(() => {
    clearHashRoute('#/chat');
    setChatOpen(false);
  }, []);

  const closeLab = useCallback(() => {
    if (isLabRoute(window.location.hash)) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setLabOpen(false);
    setLabExperimentID(DEFAULT_LAB_EXPERIMENT_ID);
  }, []);

  const closeSetup = useCallback(() => {
    clearHashRoute('#/setup');
    setSetupOpen(false);
  }, []);

  const closeNodeList = useCallback(() => {
    clearHashRoute('#/nodes');
    setNodeListOpen(false);
  }, []);

  const closeAllWorkspaceSurfaces = useCallback(() => {
    if (window.location.hash) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setPacketsOpen(false);
    setNetGraphOpen(false);
    setChatOpen(false);
    setLabOpen(false);
    setSetupOpen(false);
    setNodeListOpen(false);
    setPacketsPanelMode('expanded');
  }, []);

  const openPackets = useCallback(() => { window.location.hash = '#/packets'; }, []);
  const openChat = useCallback(() => { window.location.hash = '#/chat'; }, []);
  const openNodeList = useCallback(() => { window.location.hash = '#/nodes'; }, []);
  const selectLabExperiment = useCallback((experimentID: LabExperimentID) => {
    window.location.hash = labExperimentPath(experimentID);
  }, []);

  return {
    packetsOpen,
    setPacketsOpen,
    netGraphOpen,
    chatOpen,
    labOpen,
    labExperimentID,
    setupOpen,
    nodeListOpen,
    packetsPanelMode,
    setPacketsPanelMode,
    workspacePresentation,
    setWorkspacePresentation,
    closePackets,
    closeNetGraph,
    closeChat,
    closeLab,
    closeSetup,
    closeNodeList,
    closeAllWorkspaceSurfaces,
    openPackets,
    openChat,
    openNodeList,
    selectLabExperiment
  };
}
