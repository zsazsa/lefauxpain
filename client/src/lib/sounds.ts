// Voice join/leave sound effects using Web Audio API

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq: number, freq2: number, duration: number, delay: number = 0) {
  const ctx = getCtx();
  const t = ctx.currentTime + delay;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.linearRampToValueAtTime(freq2, t + duration);
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export function playJoinSound() {
  // Two ascending tones
  playTone(400, 500, 0.12, 0);
  playTone(500, 600, 0.12, 0.1);
}

export function playLeaveSound() {
  // Two descending tones
  playTone(500, 400, 0.12, 0);
  playTone(400, 300, 0.15, 0.1);
}
