interface LigatureCandidate extends LigatureMatch {
  readonly cps: readonly number[];
}

export interface LigatureMatch {
  readonly id: number;
  readonly text: string;
  readonly span: number;
}

const LIGATURE_CANDIDATES = [
  "!==",
  "===",
  ">>>",
  "<<<",
  ">>=",
  "<<=",
  "<=>",
  "<->",
  "->",
  "=>",
  "<-",
  "!=",
  "==",
  "<=",
  ">=",
  "&&",
  "||",
  "::",
  "++",
  "--",
  "...",
  "??",
  "?.",
] as const satisfies readonly string[];

const CANDIDATES_BY_FIRST_CP = new Map<number, LigatureCandidate[]>();

for (let id = 0; id < LIGATURE_CANDIDATES.length; id++) {
  const text = LIGATURE_CANDIDATES[id]!;
  const cps = Array.from(text, (char) => char.codePointAt(0)!);
  const first = cps[0]!;
  const bucket = CANDIDATES_BY_FIRST_CP.get(first);
  const candidate: LigatureCandidate = { id, text, span: cps.length, cps };
  if (bucket) {
    bucket.push(candidate);
  } else {
    CANDIDATES_BY_FIRST_CP.set(first, [candidate]);
  }
}

for (const bucket of CANDIDATES_BY_FIRST_CP.values()) {
  bucket.sort((a, b) => b.cps.length - a.cps.length);
}

export function findLigatureMatch(
  cellChars: Uint32Array,
  cellHl: Uint32Array,
  base: number,
  cols: number,
  col: number,
): LigatureMatch | null {
  if (col < 0 || col >= cols) return null;
  const first = cellChars[base + col]!;
  const bucket = CANDIDATES_BY_FIRST_CP.get(first);
  if (!bucket) return null;
  const hlId = cellHl[base + col]!;

  candidateLoop: for (const candidate of bucket) {
    const span = candidate.span;
    if (col + span > cols) continue;
    for (let offset = 0; offset < span; offset++) {
      if (cellHl[base + col + offset] !== hlId) continue candidateLoop;
      if (cellChars[base + col + offset] !== candidate.cps[offset]) continue candidateLoop;
    }
    return { id: candidate.id, text: candidate.text, span };
  }

  return null;
}
