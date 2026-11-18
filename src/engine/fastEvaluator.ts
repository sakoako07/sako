import { Chess, type Square } from 'chess.js';
import type { CandidateEval, Color, ThreatMarker } from './types';

export const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export interface CuratedFenPreset {
  id: string;
  label: string;
  fen: string;
  note: string;
}

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const CURATED_FENS: CuratedFenPreset[] = [
  {
    id: 'start',
    label: 'Starting Position',
    fen: STARTING_FEN,
    note: 'Standard opening board',
  },
  {
    id: 'greek-gift',
    label: 'Greek Gift Setup',
    fen: 'r1bq1rk1/pppn1ppp/4pn2/3p4/1b1P4/2NBPN2/PP3PPP/R1BQK2R w KQ - 4 8',
    note: 'Classic Bxh7+ sacrifice motif',
  },
  {
    id: 'fried-liver',
    label: 'Fried Liver Tactical',
    fen: 'r1bqkb1r/ppp2ppp/2n5/3np1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 0 6',
    note: 'Sharp Nxf7 tactical strike',
  },
  {
    id: 'opera-mate',
    label: 'Morphy Opera Mate',
    fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
    note: 'Famous 16. Qb8+! Nxb8 17. Rd8#',
  },
  {
    id: 'endgame-lucena',
    label: 'Rook Endgame',
    fen: '1K1k4/1P6/8/8/8/8/r7/4R3 w - - 0 1',
    note: 'Precision rook endgame',
  },
];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export function squareFromCoords(row: number, col: number): Square {
  return `${FILES[col]}${8 - row}` as Square;
}

/**
 * Convert UCI move array (e.g. ["e2e4", "e7e5"]) into SAN strings (["e4", "e5"]).
 */
export function uciLineToSan(fen: string, pvUci: string[]): string[] {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pvUci) {
    if (!uci || uci.length < 4) break;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const move = chess.move({ from, to, promotion });
      if (!move) break;
      sans.push(move.san);
    } catch {
      break;
    }
  }
  return sans;
}

/**
 * Detect whether a move is a tactical sacrifice (places a piece onto a square
 * attacked by a lesser piece or undefended square, or gives up net material).
 */
export function detectMoveSacrifice(fenBefore: string, uci: string): boolean {
  try {
    const before = new Chess(fenBefore);
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length > 4 ? uci[4] : undefined;

    const movingPiece = before.get(from);
    if (!movingPiece) return false;
    const capturedPiece = before.get(to);

    const movingVal = PIECE_VALUES[movingPiece.type] ?? 0;
    const capturedVal = capturedPiece ? PIECE_VALUES[capturedPiece.type] ?? 0 : 0;

    // Never call a pawn move a material sacrifice unless capturing into danger with promotion
    if (movingVal < 300) return false;

    const after = new Chess(fenBefore);
    const mv = after.move({ from, to, promotion });
    if (!mv) return false;

    const moverColor = movingPiece.color;
    const enemyColor: Color = moverColor === 'w' ? 'b' : 'w';

    // Is destination square attacked by opponent?
    const attackedByEnemy = after.isAttacked(to, enemyColor);
    if (!attackedByEnemy) return false;

    const defendedByUs = after.isAttacked(to, moverColor);

    // Uncaptured sacrifice onto an undefended attacked square, or losing material trade (e.g. QxN, BxP Bxh7+)
    if (!defendedByUs && movingVal > capturedVal + 100) {
      return true;
    }
    if (movingVal >= 300 && capturedVal < movingVal - 150) {
      // Check if an enemy pawn or lesser piece attacks the destination
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Find threatened/hanging pieces and checked kings for visual board markers.
 */
export function detectThreatMarkers(fen: string): ThreatMarker[] {
  const markers: ThreatMarker[] = [];
  try {
    const chess = new Chess(fen);
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const sq = squareFromCoords(r, c);
        const enemy: Color = piece.color === 'w' ? 'b' : 'w';

        if (piece.type === 'k') {
          if (chess.isAttacked(sq, enemy)) {
            markers.push({ square: sq, color: piece.color, severity: 'check' });
          }
          continue;
        }

        const isAttacked = chess.isAttacked(sq, enemy);
        if (!isAttacked) continue;

        const isDefended = chess.isAttacked(sq, piece.color);
        if (!isDefended && PIECE_VALUES[piece.type] >= 300) {
          markers.push({ square: sq, color: piece.color, severity: 'hanging' });
        } else if (PIECE_VALUES[piece.type] >= 500) {
          markers.push({ square: sq, color: piece.color, severity: 'attacked' });
        }
      }
    }
  } catch {
    // Ignore invalid FEN
  }
  return markers;
}

// Piece-square tables (from White's perspective, rank 8 at row 0 -> rank 1 at row 7)
const PAWN_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 27, 27, 10, 5, 5],
  [0, 0, 0, 24, 24, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -22, -22, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const KNIGHT_PST = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 12, 16, 16, 12, 0, -30],
  [-30, 5, 16, 22, 22, 16, 5, -30],
  [-30, 0, 16, 22, 22, 16, 0, -30],
  [-30, 5, 12, 16, 16, 12, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const BISHOP_PST = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 8, 12, 12, 8, 0, -10],
  [-10, 6, 6, 12, 12, 6, 6, -10],
  [-10, 0, 12, 12, 12, 12, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 6, 0, 0, 0, 0, 6, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

const ROOK_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [6, 12, 12, 12, 12, 12, 12, 6],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 6, 6, 0, 0, 0],
];

const QUEEN_PST = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];

const KING_PST = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

function getPstValue(type: string, color: Color, row: number, col: number): number {
  const r = color === 'w' ? row : 7 - row;
  switch (type) {
    case 'p':
      return PAWN_PST[r][col];
    case 'n':
      return KNIGHT_PST[r][col];
    case 'b':
      return BISHOP_PST[r][col];
    case 'r':
      return ROOK_PST[r][col];
    case 'q':
      return QUEEN_PST[r][col];
    case 'k':
      return KING_PST[r][col];
    default:
      return 0;
  }
}

/**
 * Static board evaluation in centipawns from White's perspective.
 */
export function evaluateBoardStaticWhite(chess: Chess): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -100000 : 100000;
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition()) {
    return 0;
  }

  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const val = (PIECE_VALUES[piece.type] ?? 0) + getPstValue(piece.type, piece.color, r, c);
      score += piece.color === 'w' ? val : -val;
    }
  }
  return score;
}

/**
 * Fast synchronous fallback/reference tactical search using chess.js (for unit tests
 * or environments where Web Workers are unavailable). Searches all legal moves at
 * shallow depth + capture quiescence within a tight time budget.
 */
export function evaluateCandidatesSync(
  fen: string,
  timeBudgetMs = 240,
  maxDepth = 2
): CandidateEval[] {
  const chess = new Chess(fen);
  const turn = chess.turn();
  const sign = turn === 'w' ? 1 : -1;
  const legal = chess.moves({ verbose: true }).sort((a, b) => {
    const aScore = (a.captured ? PIECE_VALUES[a.captured] : 0) + (a.san.includes('+') ? 400 : 0) + (a.promotion ? 800 : 0);
    const bScore = (b.captured ? PIECE_VALUES[b.captured] : 0) + (b.san.includes('+') ? 400 : 0) + (b.promotion ? 800 : 0);
    return bScore - aScore;
  });
  if (legal.length === 0) return [];

  const deadline = Date.now() + timeBudgetMs;

  function quiesce(c: Chess, alpha: number, beta: number, qDepth: number): number {
    const standPat = evaluateBoardStaticWhite(c) * (c.turn() === 'w' ? 1 : -1);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    if (qDepth <= 0 || Date.now() > deadline) return alpha;

    const captures = c
      .moves({ verbose: true })
      .filter((m) => Boolean(m.captured) || Boolean(m.promotion))
      .sort(
        (a, b) =>
          (PIECE_VALUES[b.captured ?? 'p'] ?? 0) -
          (PIECE_VALUES[a.captured ?? 'p'] ?? 0)
      );

    for (const cap of captures) {
      c.move(cap);
      const score = -quiesce(c, -beta, -alpha, qDepth - 1);
      c.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(c: Chess, depth: number, alpha: number, beta: number, extLeft = 1): number {
    if (c.isCheckmate()) return -99000 - depth * 100;
    if (c.isDraw() || c.isStalemate()) return 0;
    const inCheck = c.inCheck();
    const effectiveDepth = inCheck && extLeft > 0 ? depth + 1 : depth;
    const nextExt = inCheck && extLeft > 0 ? extLeft - 1 : extLeft;
    if (effectiveDepth <= 0 || Date.now() > deadline) {
      return quiesce(c, alpha, beta, 2);
    }

    const moves = c.moves({ verbose: true }).sort((a, b) => {
      const aScore = (a.captured ? PIECE_VALUES[a.captured] : 0) + (a.promotion ? 800 : 0);
      const bScore = (b.captured ? PIECE_VALUES[b.captured] : 0) + (b.promotion ? 800 : 0);
      return bScore - aScore;
    });

    let best = -120000;
    for (const mv of moves) {
      c.move(mv);
      const val = -negamax(c, effectiveDepth - 1, -beta, -alpha, nextExt);
      c.undo();
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
      if (Date.now() > deadline) break;
    }
    return best;
  }

  const results: CandidateEval[] = [];
  for (const mv of legal) {
    const uci = `${mv.from}${mv.to}${mv.promotion ?? ''}`;
    const isSacrifice = detectMoveSacrifice(fen, uci);
    chess.move(mv);
    const isCheck = chess.inCheck();
    let cpMover: number;
    let mateMover: number | undefined;

    if (chess.isCheckmate()) {
      cpMover = 99900;
      mateMover = 1;
    } else if (chess.isDraw() || chess.isStalemate()) {
      cpMover = 0;
    } else {
      const searchDepth = Math.max(0, maxDepth - 1);
      cpMover = -negamax(chess, searchDepth, -120000, 120000);
      if (Math.abs(cpMover) > 95000) {
        mateMover = cpMover > 0 ? 2 : -2;
      }
    }
    chess.undo();

    results.push({
      uci,
      san: mv.san,
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion,
      cpWhite: cpMover * sign,
      mateWhite: mateMover !== undefined ? mateMover * sign : undefined,
      cpMover,
      mateMover,
      isSacrifice,
      isCheck,
      isCapture: Boolean(mv.captured),
      pvUci: [uci],
      pvSan: [mv.san],
      depth: maxDepth,
    });
  }

  return results.sort((a, b) => b.cpMover - a.cpMover);
}

export interface MaterialSummary {
  whiteCaptured: Array<'q' | 'r' | 'b' | 'n' | 'p'>;
  blackCaptured: Array<'q' | 'r' | 'b' | 'n' | 'p'>;
  whiteAdvantage: number;
}

const START_COUNTS: Record<'q' | 'r' | 'b' | 'n' | 'p', number> = {
  q: 1,
  r: 2,
  b: 2,
  n: 2,
  p: 8,
};

const MAT_WEIGHT: Record<'q' | 'r' | 'b' | 'n' | 'p', number> = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
};

export function getCapturedAndMaterial(fen: string): MaterialSummary {
  const countsW: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  const countsB: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  try {
    const chess = new Chess(fen);
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell || cell.type === 'k') continue;
        if (cell.color === 'w') countsW[cell.type] += 1;
        else countsB[cell.type] += 1;
      }
    }
  } catch {
    return { whiteCaptured: [], blackCaptured: [], whiteAdvantage: 0 };
  }

  const order: Array<'q' | 'r' | 'b' | 'n' | 'p'> = ['q', 'r', 'b', 'n', 'p'];
  const whiteCaptured: Array<'q' | 'r' | 'b' | 'n' | 'p'> = [];
  const blackCaptured: Array<'q' | 'r' | 'b' | 'n' | 'p'> = [];

  let matW = 0;
  let matB = 0;
  for (const t of order) {
    matW += (countsW[t] ?? 0) * MAT_WEIGHT[t];
    matB += (countsB[t] ?? 0) * MAT_WEIGHT[t];
    const missingB = Math.max(0, START_COUNTS[t] - (countsB[t] ?? 0));
    const missingW = Math.max(0, START_COUNTS[t] - (countsW[t] ?? 0));
    for (let i = 0; i < missingB; i++) whiteCaptured.push(t);
    for (let i = 0; i < missingW; i++) blackCaptured.push(t);
  }

  return {
    whiteCaptured,
    blackCaptured,
    whiteAdvantage: matW - matB,
  };
}

