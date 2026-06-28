import { activityHeatmapToGeoJSON, type ActivityHeatEntry } from '../map/activityHeatmap';
import type { NodeFocus } from '../map/nodeFocus';
import { routesToGeoJSON, type RouteThemeMode } from '../map/routeSource';
import type { FeatureCollection } from '../map/sourceDataQueue';
import type { PublicNode, PublicRoute } from '../types';
import type { GeoJSONTransformRequest, GeoJSONTransformResponse } from './geojsonWorkerClient';

export type RouteGeoJSONPayload = {
  sourceId: string;
  signature: string;
  routes: PublicRoute[];
  selectedRouteID: string | null;
  focus: NodeFocus;
  now: number;
  themeMode: RouteThemeMode;
};

export type HeatmapGeoJSONPayload = {
  sourceId: string;
  signature: string;
  nodes: PublicNode[];
  activities: Map<string, ActivityHeatEntry>;
  meshActivityAtByNodeID: Map<string, number>;
  epochNow: number;
  performanceNow: number;
};

export type GeoJSONTransformPayload = RouteGeoJSONPayload | HeatmapGeoJSONPayload;

export function transformGeoJSON(request: GeoJSONTransformRequest<GeoJSONTransformPayload>): GeoJSONTransformResponse<FeatureCollection> {
  switch (request.type) {
    case 'routes': {
      const payload = request.payload as RouteGeoJSONPayload;
      return {
        id: request.id,
        sourceId: payload.sourceId,
        signature: payload.signature,
        geojson: routesToGeoJSON(payload.routes, payload.selectedRouteID, payload.focus, payload.now, payload.themeMode)
      };
    }
    case 'heatmap': {
      const payload = request.payload as HeatmapGeoJSONPayload;
      return {
        id: request.id,
        sourceId: payload.sourceId,
        signature: payload.signature,
        geojson: activityHeatmapToGeoJSON(
          payload.nodes,
          payload.activities,
          payload.meshActivityAtByNodeID,
          payload.epochNow,
          payload.performanceNow
        )
      };
    }
    default:
      throw new Error(`unsupported geojson transform type: ${request.type}`);
  }
}
