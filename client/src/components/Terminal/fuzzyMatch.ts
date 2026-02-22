/**
 * Sequential character fuzzy match with scoring.
 * Returns null if no match, otherwise a score (higher = better).
 * Bonuses for: prefix match, consecutive characters, word-boundary hits.
 */
export function fuzzyMatch(pattern: string, target: string): number | null {
  const p = pattern.toLowerCase();
  const t = target.toLowerCase();

  if (p.length === 0) return 0;
  if (p.length > t.length) return null;

  let score = 0;
  let pi = 0;
  let lastMatchIdx = -2;

  for (let ti = 0; ti < t.length && pi < p.length; ti++) {
    if (t[ti] === p[pi]) {
      // Prefix bonus
      if (pi === 0 && ti === 0) score += 10;
      // Consecutive bonus
      if (ti === lastMatchIdx + 1) score += 5;
      // Word boundary bonus (after - or start)
      if (ti === 0 || target[ti - 1] === "-") score += 3;

      score += 1;
      lastMatchIdx = ti;
      pi++;
    }
  }

  return pi === p.length ? score : null;
}
