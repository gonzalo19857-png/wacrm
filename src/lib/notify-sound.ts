"use client";

/**
 * Synthesizes a short two-tone notification chime via the Web Audio
 * API — no bundled audio asset to ship or fetch. A single
 * `AudioContext` is reused across calls (creating one per play is
 * needless overhead, and browsers cap how many can be alive at once);
 * it's created lazily on first use so page load never eagerly grabs
 * an audio device.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!ctx) ctx = new AudioContextCtor();
  return ctx;
}

function tone(
  context: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  peakGain: number,
) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Quick linear attack then an exponential decay reads as a soft
  // "ding" rather than a harsh square-wave beep or an audible click
  // at the start/end of the tone.
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Plays a brief two-note chime (A5 → E6). Silently no-ops if the Web
 *  Audio API is unavailable or the browser hasn't granted it a user
 *  gesture yet — never throws into a realtime event handler. */
export function playNotificationSound(): void {
  try {
    const context = getContext();
    if (!context) return;
    // Autoplay policies suspend a freshly-created context until a user
    // gesture; resume() is a no-op once it's already running.
    void context.resume();
    const now = context.currentTime;
    tone(context, 880, now, 0.18, 0.15);
    tone(context, 1318.5, now + 0.09, 0.22, 0.12);
  } catch {
    // Never let a sound glitch break the realtime handler it's called from.
  }
}
