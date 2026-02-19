import { createEffect, createSignal } from "solid-js";
import { computePeaks, deserializePeaks } from "../../lib/waveform";

interface WaveformProps {
  trackUrl: string | null;
  progress: number;
  height: number;
  precomputedPeaks?: string;
  onSeek?: (frac: number) => void;
}

export default function Waveform(props: WaveformProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  const [peaks, setPeaks] = createSignal<Float32Array | null>(null);

  // Load peaks when track URL changes
  createEffect(() => {
    const url = props.trackUrl;
    if (!url) {
      setPeaks(null);
      return;
    }
    const pre = props.precomputedPeaks;
    if (pre) {
      setPeaks(deserializePeaks(pre));
      return;
    }
    computePeaks(url).then(setPeaks).catch(() => setPeaks(null));
  });

  // Render bars on canvas
  createEffect(() => {
    const canvas = canvasRef;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const p = peaks();
    const prog = props.progress;
    const h = props.height;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!p || p.length === 0) return;

    const numBars = p.length;
    const gap = 1;
    const barW = Math.max(1, (w - gap * (numBars - 1)) / numBars);
    const playedX = prog * w;

    // Accent color from CSS var
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#c9a84c";
    const muted = "rgba(201,168,76,0.25)";

    for (let i = 0; i < numBars; i++) {
      const x = i * (barW + gap);
      const barH = Math.max(2, p[i] * (h - 4));
      const y = (h - barH) / 2;

      ctx.fillStyle = x + barW <= playedX ? accent : muted;
      ctx.fillRect(x, y, barW, barH);
    }
  });

  // Seek handling
  const seekFromEvent = (e: MouseEvent) => {
    if (!props.onSeek || !canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    props.onSeek(frac);
  };

  const onPointerDown = (e: MouseEvent) => {
    seekFromEvent(e);
    const onMove = (ev: MouseEvent) => seekFromEvent(ev);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onPointerDown}
      style={{
        width: "100%",
        height: `${props.height}px`,
        cursor: props.onSeek ? "pointer" : "default",
        display: "block",
      }}
    />
  );
}
