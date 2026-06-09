const SAMPLE_ZOOM = 12;
const TILE_SIZE = 256;

const tileCache = new Map<string, HTMLImageElement>();

export function elevationToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function fetchTileImage(url: string): Promise<HTMLImageElement> {
  const cached = tileCache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      tileCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Tile load failed'));
    img.src = url;
  });
}

export async function sampleElevationAlongRoute(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
  numSamples: number,
  terrainTileUrl: string
): Promise<number[]> {
  if (numSamples < 2) numSamples = 2;

  const points: Array<{ lng: number; lat: number }> = [];
  for (let i = 0; i < numSamples; i++) {
    const t = i / Math.max(1, numSamples - 1);
    points.push({ lng: lng1 + (lng2 - lng1) * t, lat: lat1 + (lat2 - lat1) * t });
  }

  const tileGroups = new Map<string, Array<{ index: number; px: number; py: number }>>();
  for (let i = 0; i < points.length; i++) {
    const { lng, lat } = points[i];
    const tile = lngLatToTile(lng, lat, SAMPLE_ZOOM);
    const tileX = Math.floor(tile.x);
    const tileY = Math.floor(tile.y);
    const px = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((tile.x - tileX) * TILE_SIZE)));
    const py = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((tile.y - tileY) * TILE_SIZE)));
    const key = `${SAMPLE_ZOOM}/${tileX}/${tileY}`;
    let group = tileGroups.get(key);
    if (!group) {
      group = [];
      tileGroups.set(key, group);
    }
    group.push({ index: i, px, py });
  }

  const elevations: number[] = new Array(numSamples).fill(0);

  await Promise.all(
    [...tileGroups.entries()].map(async ([key, samples]) => {
      const [z, xStr, yStr] = key.split('/');
      const url = terrainTileUrl.replace('{z}', z).replace('{x}', xStr).replace('{y}', yStr);
      try {
        const img = await fetchTileImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        for (const sample of samples) {
          const pixel = ctx.getImageData(sample.px, sample.py, 1, 1).data;
          elevations[sample.index] = elevationToMeters(pixel[0], pixel[1], pixel[2]);
        }
      } catch {
        // leave at 0 for failed tiles
      }
    })
  );

  return elevations;
}

export function summarizeElevation(elevations: number[]): {
  min: number;
  max: number;
  avg: number;
  gain: number;
  loss: number;
  start: number;
  end: number;
} {
  const len = elevations.length;
  if (len === 0) return { min: 0, max: 0, avg: 0, gain: 0, loss: 0, start: 0, end: 0 };

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let gain = 0;
  let loss = 0;

  for (let i = 0; i < len; i++) {
    const e = elevations[i];
    if (e < min) min = e;
    if (e > max) max = e;
    sum += e;
    if (i > 0) {
      const diff = e - elevations[i - 1];
      if (diff > 0) gain += diff;
      else loss -= diff;
    }
  }

  return {
    min,
    max,
    avg: sum / len,
    gain,
    loss,
    start: elevations[0],
    end: elevations[len - 1]
  };
}
