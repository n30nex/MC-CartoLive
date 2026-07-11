export async function probeCurrentPublicTopology(publicBaseUrl, fetchImpl = fetch, nonce = Date.now()) {
  const baseUrl = String(publicBaseUrl).replace(/\/+$/, '');
  const options = { cache: 'no-store', headers: { accept: 'application/json' } };
  try {
    // Capture the compact cursor first. Fetching full state second means live
    // traffic can advance state without making the proof race backwards.
    const bootstrapResponse = await fetchImpl(`${baseUrl}/api/v1/public/bootstrap?browserSmoke=${nonce}`, options);
    if (!bootstrapResponse.ok) {
      return { ready: false, diagnostic: `bootstrap HTTP ${bootstrapResponse.status}` };
    }
    const bootstrap = await bootstrapResponse.json();
    const bootstrapSeq = Number(bootstrap.latestSeq ?? bootstrap.stats?.latestSeq ?? 0);

    const stateResponse = await fetchImpl(`${baseUrl}/api/v1/public/state?browserSmoke=${nonce}`, options);
    if (!stateResponse.ok) {
      return { ready: false, diagnostic: `bootstrapSeq=${bootstrapSeq} state HTTP ${stateResponse.status}` };
    }
    const state = await stateResponse.json();
    const nodes = Array.isArray(state.nodes) ? state.nodes.length : 0;
    const routes = Array.isArray(state.routes) ? state.routes.length : 0;
    const pulses = Array.isArray(state.recentPulses) ? state.recentPulses.length : 0;
    const stateSeq = Number(state.stats?.latestSeq ?? state.latestSeq ?? 0);
    const diagnostic = `nodes=${nodes} routes=${routes} pulses=${pulses} bootstrapSeq=${bootstrapSeq} stateSeq=${stateSeq}`;
    return {
      ready: nodes > 0 && routes > 0 && Number.isFinite(bootstrapSeq) && Number.isFinite(stateSeq) && stateSeq >= bootstrapSeq,
      diagnostic
    };
  } catch (error) {
    return { ready: false, diagnostic: error instanceof Error ? error.message : String(error) };
  }
}
