import type { CSSProperties } from 'react';
import { normalizePayloadType, payloadLegendVisuals } from '../payloadVisuals';
import { OBSERVER_NODE_VISUAL, NODE_ROLE_VISUALS } from '../nodeVisuals';
import { routePacketDots } from '../assets/routes/assets';

export default function Legend() {
  const payloads = payloadLegendVisuals();
  return (
    <section className="legend-panel" aria-label="Map legend">
      <div className="legend-group">
        <span className="legend-title">Devices</span>
        {[...NODE_ROLE_VISUALS.slice(0, 3), OBSERVER_NODE_VISUAL, ...NODE_ROLE_VISUALS.slice(3)].map((visual) => (
          <span key={visual.key}>
            <img className={`legend-role-icon ${visual.legendClass ?? ''}`.trim()} src={visual.icon} alt="" aria-hidden="true" />
            {visual.label}
          </span>
        ))}
      </div>
      <div className="legend-group">
        <span className="legend-title">Routes</span>
        <span className="frequency-ramp" />
        <span className="legend-scale"><b>Quiet</b><b>Busy</b></span>
      </div>
      <div className="legend-group packet-key">
        <span className="legend-title">Packets</span>
        <div className="payload-key">
          {payloads.map((payload) => (
            <span className="payload-chip legend-payload" style={{ '--payload-color': payload.color } as CSSProperties} title={payload.description} key={payload.className}>
              <img src={routePacketDots[normalizePayloadType(payload.label)] ?? routePacketDots.OTHER} alt="" aria-hidden="true" />
              {payload.shortLabel}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
