const cache = new Map<string, Float32Array>();
const pending = new Map<string, Promise<Float32Array>>();

export async function computePeaks(
  url: string,
  numBars = 150
): Promise<Float32Array> {
  const cached = cache.get(url);
  if (cached) return cached;

  const inflight = pending.get(url);
  if (inflight) return inflight;

  const promise = _compute(url, numBars);
  pending.set(url, promise);

  try {
    const peaks = await promise;
    cache.set(url, peaks);
    return peaks;
  } catch {
    // Fallback: flat bars
    const flat = new Float32Array(numBars).fill(0.3);
    cache.set(url, flat);
    return flat;
  } finally {
    pending.delete(url);
  }
}

export async function computePeaksFromFile(
  file: File,
  numBars = 150
): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  return computePeaksFromBuffer(buf, numBars);
}

export function serializePeaks(peaks: Float32Array): string {
  const arr = Array.from(peaks, (v) => Math.round(v * 100) / 100);
  return JSON.stringify(arr);
}

export function deserializePeaks(json: string): Float32Array {
  return new Float32Array(JSON.parse(json));
}

async function computePeaksFromBuffer(
  buf: ArrayBuffer,
  numBars: number
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const decoded = await ctx.decodeAudioData(buf);

  const data = decoded.getChannelData(0);
  const samplesPerBar = Math.floor(data.length / numBars);
  const peaks = new Float32Array(numBars);

  for (let i = 0; i < numBars; i++) {
    let max = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, data.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  // Normalize to [0..1]
  let globalMax = 0;
  for (let i = 0; i < numBars; i++) {
    if (peaks[i] > globalMax) globalMax = peaks[i];
  }
  if (globalMax > 0) {
    for (let i = 0; i < numBars; i++) {
      peaks[i] /= globalMax;
    }
  }

  return peaks;
}

async function _compute(url: string, numBars: number): Promise<Float32Array> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  return computePeaksFromBuffer(buf, numBars);
}
