/**
 * Deterministic avatar colour per contact, so the same person always gets
 * the same colour across the conversation list, thread header, and contact
 * sidebar — a flat single-colour "bg-muted" circle for every contact made
 * the conversation list hard to scan (every row looked identical at a
 * glance). Palette matches the tag colour presets in tag-manager.tsx so the
 * whole app reads as one system.
 */
const AVATAR_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
