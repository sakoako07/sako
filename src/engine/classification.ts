import { Chess } from 'chess.js';
import type {
  CandidateEval,
  Color,
  MoveQuality,
  QualityFilter,
} from './types';

export interface QualityBadgeMeta {
  quality: MoveQuality;
  label: string;
  symbol: string;
  arrowColor: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}

export const QUALITY_META: Record<MoveQuality, QualityBadgeMeta> = {
  brilliant: {
    quality: 'brilliant',
    label: 'Brilliant',
    symbol: '!!',
    arrowColor: '#26c6da',
    badgeBg: '#1baca6',
    badgeText: '#ffffff',
    description: 'Strong tactical sacrifice or razor-sharp strike',
  },
  best: {
    quality: 'best',
    label: 'Best',
    symbol: '★',
    arrowColor: '#81b64c',
    badgeBg: '#5c9c31',
    badgeText: '#ffffff',
    description: 'Engine top choice',
  },
  good: {
    quality: 'good',
    label: 'Good',
    symbol: '✓',
    arrowColor: '#96bc4b',
    badgeBg: '#7fa650',
    badgeText: '#ffffff',
    description: 'Solid playable move',
  },
  inaccuracy: {
    quality: 'inaccuracy',
    label: 'Inaccuracy',
    symbol: '?!',
    arrowColor: '#f7c631',
    badgeBg: '#f7c631',
    badgeText: '#1b1a17',
    description: 'Slightly imprecise; gives away a small edge',
  },
  miss: {
    quality: 'miss',
    label: 'Miss',
    symbol: '⨯',
    arrowColor: '#ee6c38',
    badgeBg: '#ee6c38',
    badgeText: '#ffffff',
    description: 'Missed a strong tactical opportunity',
  },
  mistake: {
    quality: 'mistake',
    label: 'Mistake',
    symbol: '?',
    arrowColor: '#e58f2a',
    badgeBg: '#e58f2a',
    badgeText: '#ffffff',
    description: 'Significant evaluation drop',
  },
  blunder: {
    quality: 'blunder',
    label: 'Blunder',
    symbol: '??',
    arrowColor: '#fa412d',
    badgeBg: '#ca3431',
    badgeText: '#ffffff',
    description: 'Severe tactical or positional error',
  },
};

export const QUALITY_FILTER_OPTIONS: Array<{
  id: QualityFilter;
  label: string;
  symbol?: string;
  accentColor: string;
}> = [
  { id: 'auto', label: 'Auto Natural', accentColor: '#96bc4b' },
  { id: 'brilliant', label: 'Brilliant', symbol: '!!', accentColor: '#26c6da' },
  { id: 'best', label: 'Best', symbol: '★', accentColor: '#81b64c' },
  { id: 'good', label: 'Good', symbol: '✓', accentColor: '#96bc4b' },
  { id: 'miss', label: 'Miss', symbol: '⨯', accentColor: '#ee6c38' },
  { id: 'mistake', label: 'Mistake', symbol: '?', accentColor: '#e58f2a' },
  { id: 'blunder', label: 'Blunder', symbol: '??', accentColor: '#fa412d' },
];

/**
 * Convert a centipawn / mate evaluation (from White's perspective) into a
 * smooth 0-100% White advantage percentage for the vertical Evaluation Bar.
 */
export function evalToWinPercent(cpWhite: number, mateWhite?: number): number {
  if (mateWhite !== undefined && mateWhite !== 0) {
    return mateWhite > 0 ? 100 : 0;
  }
  const clamped = Math.max(-1800, Math.min(1800, cpWhite));
  const winProb = 50 + 50 * (2 / (1 + Math.exp(-0.00368 * clamped)) - 1);
  return Math.max(4, Math.min(96, Math.round(winProb * 10) / 10));
}

/**
 * Format centipawns or mate into compact Chess.com eval string (+1.4, -0.8, M3, 0.0).
 */
export function formatEvalScore(cpWhite: number, mateWhite?: number): string {
  if (mateWhite !== undefined && mateWhite !== 0) {
    return mateWhite > 0 ? `M${mateWhite}` : `-M${Math.abs(mateWhite)}`;
  }
  const pawns = cpWhite / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
}

/**
 * Normalize score for sorting from the side-to-move's perspective.
 * Positive mate is scored above all centipawn values; negative mate below all.
 */
export function candidateSortScore(c: CandidateEval): number {
  if (c.mateMover !== undefined && c.mateMover !== 0) {
    return c.mateMover > 0
      ? 100000 - c.mateMover * 100
      : -100000 - c.mateMover * 100;
  }
  return c.cpMover;
}

/**
 * Classify a move that was just played on the board.
 */
export function classifyPlayedMove(params: {
  playedUci: string;
  bestCandidate?: CandidateEval;
  playedCandidate?: CandidateEval;
  cpMoverBeforeBest: number;
  cpMoverAfter: number;
  mateMoverBeforeBest?: number;
  mateMoverAfter?: number;
  isSacrifice?: boolean;
  isCheck?: boolean;
  wasForced?: boolean;
}): MoveQuality {
  const {
    playedUci,
    bestCandidate,
    playedCandidate,
    cpMoverBeforeBest,
    cpMoverAfter,
    mateMoverBeforeBest,
    mateMoverAfter,
    isSacrifice = playedCandidate?.isSacrifice ?? false,
    isCheck = playedCandidate?.isCheck ?? false,
    wasForced = false,
  } = params;

  if (wasForced) return 'best';

  // Missed forced mate -> Miss or Blunder depending on remaining eval
  if (mateMoverBeforeBest && mateMoverBeforeBest > 0 && (!mateMoverAfter || mateMoverAfter <= 0)) {
    if (cpMoverAfter < 100) return 'blunder';
    return 'miss';
  }

  // Found forced mate
  if (mateMoverAfter && mateMoverAfter > 0) {
    return isSacrifice ? 'brilliant' : 'best';
  }

  // Walked into forced mate
  if (mateMoverAfter && mateMoverAfter < 0) {
    return 'blunder';
  }

  const bestScore = bestCandidate ? candidateSortScore(bestCandidate) : cpMoverBeforeBest;
  const cpLoss = Math.max(0, bestScore - cpMoverAfter);

  if (isSacrifice && cpLoss <= 55 && cpMoverAfter >= -120) {
    return 'brilliant';
  }

  if (bestCandidate && playedUci === bestCandidate.uci) {
    return 'best';
  }

  if (cpLoss <= 22) {
    return isCheck && isSacrifice ? 'brilliant' : 'best';
  }
  if (cpLoss <= 70) {
    return 'good';
  }
  if (cpLoss <= 135) {
    // If position had a big tactical capture/edge and mover played a passive move
    if (bestCandidate?.isCapture && !playedCandidate?.isCapture && cpLoss >= 95) {
      return 'miss';
    }
    return 'inaccuracy';
  }
  if (cpLoss <= 240) {
    if (cpMoverAfter >= -40 && cpMoverBeforeBest >= 140) {
      return 'miss';
    }
    return 'mistake';
  }
  if (cpLoss <= 340) {
    return 'mistake';
  }
  return 'blunder';
}

/**
 * Select a legal candidate move matching a requested QualityFilter in Phase 1.
 * Guarantees a valid move & quality badge in any legal position (opening, middle, endgame).
 */
export function selectMoveForQualityFilter(
  candidates: CandidateEval[],
  filter: QualityFilter,
  seed = 0
): { candidate: CandidateEval; quality: MoveQuality } | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(
    (a, b) => candidateSortScore(b) - candidateSortScore(a)
  );
  const best = sorted[0];
  const bestScore = candidateSortScore(best);

  if (sorted.length === 1) {
    return {
      candidate: best,
      quality: filter === 'auto' ? 'best' : filter,
    };
  }

  const withLoss = sorted.map((c, idx) => ({
    candidate: c,
    idx,
    loss: Math.max(0, bestScore - candidateSortScore(c)),
  }));

  if (filter === 'best') {
    return { candidate: best, quality: 'best' };
  }

  if (filter === 'brilliant') {
    // Prefer a genuine sacrifice near the top, then a forcing check/capture near the top, then #1
    const sac = withLoss.find(
      (item) => item.candidate.isSacrifice && item.loss <= 140
    );
    if (sac) return { candidate: sac.candidate, quality: 'brilliant' };

    const sharp = withLoss.find(
      (item) => (item.candidate.isCheck || item.candidate.isCapture) && item.loss <= 75
    );
    if (sharp) return { candidate: sharp.candidate, quality: 'brilliant' };

    return { candidate: best, quality: 'brilliant' };
  }

  if (filter === 'good') {
    const goodPool = withLoss.filter(
      (item) => item.idx > 0 && !item.candidate.isSacrifice && item.loss >= 15 && item.loss <= 90
    );
    if (goodPool.length > 0) {
      const pick = goodPool[Math.abs(seed) % goodPool.length];
      return { candidate: pick.candidate, quality: 'good' };
    }
    const anyGood = withLoss.filter((item) => item.idx > 0 && item.loss >= 15 && item.loss <= 90);
    if (anyGood.length > 0) {
      const pick = anyGood[Math.abs(seed) % anyGood.length];
      return { candidate: pick.candidate, quality: 'good' };
    }
    const second = withLoss[Math.min(1, withLoss.length - 1)];
    return { candidate: second.candidate, quality: 'good' };
  }

  if (filter === 'miss') {
    // Prefer a passive/missed-tactic move with moderate loss (90..260cp), or closest to 150cp loss
    const missPool = withLoss.filter(
      (item) => item.loss >= 80 && item.loss <= 260 && !item.candidate.isCapture
    );
    if (missPool.length > 0) {
      return { candidate: missPool[0].candidate, quality: 'miss' };
    }
    const closest = [...withLoss]
      .slice(1)
      .sort((a, b) => Math.abs(a.loss - 150) - Math.abs(b.loss - 150))[0];
    return { candidate: closest.candidate, quality: 'miss' };
  }

  if (filter === 'mistake') {
    const mistakePool = withLoss.filter(
      (item) => item.loss >= 150 && item.loss <= 340
    );
    if (mistakePool.length > 0) {
      const mid = mistakePool[Math.floor(mistakePool.length / 2)];
      return { candidate: mid.candidate, quality: 'mistake' };
    }
    const closest = [...withLoss]
      .slice(1)
      .sort((a, b) => Math.abs(a.loss - 230) - Math.abs(b.loss - 230))[0];
    return { candidate: closest.candidate, quality: 'mistake' };
  }

  if (filter === 'blunder') {
    // Pick a move with >= 320cp loss or forced mate against us, or the worst available move
    const blunders = withLoss.filter(
      (item) =>
        item.loss >= 320 ||
        (item.candidate.mateMover !== undefined && item.candidate.mateMover < 0)
    );
    if (blunders.length > 0) {
      // Pick the worst blunder for unmistakable demonstration
      return { candidate: blunders[blunders.length - 1].candidate, quality: 'blunder' };
    }
    const worst = withLoss[withLoss.length - 1];
    return { candidate: worst.candidate, quality: 'blunder' };
  }

  // filter === 'auto' (Natural Human Style):
  // Dynamically blends top moves, occasional brilliant tactical strikes, good moves, and rare human slips
  const sacHit = withLoss.find((item) => item.candidate.isSacrifice && item.loss <= 60);
  if (sacHit) {
    return { candidate: sacHit.candidate, quality: 'brilliant' };
  }

  const roll = Math.abs(seed) % 100;
  if (roll < 52) {
    return { candidate: best, quality: 'best' };
  }
  if (roll < 82) {
    const goodPool = withLoss.filter((item) => item.idx > 0 && item.loss <= 75);
    if (goodPool.length > 0) {
      const pick = goodPool[Math.abs(seed) % goodPool.length];
      return { candidate: pick.candidate, quality: 'good' };
    }
    return { candidate: best, quality: 'best' };
  }
  if (roll < 94) {
    const inaccPool = withLoss.filter((item) => item.loss >= 60 && item.loss <= 145);
    if (inaccPool.length > 0) {
      return { candidate: inaccPool[0].candidate, quality: 'inaccuracy' };
    }
  }
  const mistakePool = withLoss.filter((item) => item.loss >= 140 && item.loss <= 280);
  if (mistakePool.length > 0) {
    return { candidate: mistakePool[0].candidate, quality: 'mistake' };
  }
  return { candidate: best, quality: 'best' };
}

/**
 * Validate a FEN string using chess.js.
 */
export function parseAndValidateFen(fen: string): {
  valid: boolean;
  error?: string;
  turn?: Color;
} {
  const trimmed = fen.trim();
  if (!trimmed) {
    return { valid: false, error: 'FEN string cannot be empty.' };
  }
  try {
    const chess = new Chess(trimmed);
    return { valid: true, turn: chess.turn() };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid FEN position.',
    };
  }
}

/**
 * Safely build a null-turn FEN (swapping active side) ONLY if the current side
 * is not in check, so Stockfish never receives an illegal FEN.
 */
export function buildOpponentTurnFen(fen: string): string | null {
  try {
    const chess = new Chess(fen);
    if (chess.inCheck()) return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return null;
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-'; // Clear en-passant target on null move
    const candidateFen = parts.join(' ');
    // Verify validity with chess.js
    const verify = new Chess(candidateFen);
    // Ensure the flipped side isn't delivering illegal check to the side that just "passed"
    if (verify.isAttacked(findKingSquare(verify, verify.turn() === 'w' ? 'b' : 'w') ?? 'e1', verify.turn())) {
      return null;
    }
    return candidateFen;
  } catch {
    return null;
  }
}

function findKingSquare(chess: Chess, color: Color): Parameters<Chess['isAttacked']>[0] | null {
  const board = chess.board();
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === color) {
        return `${files[c]}${8 - r}` as Parameters<Chess['isAttacked']>[0];
      }
    }
  }
  return null;
}
