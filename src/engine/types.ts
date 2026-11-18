export type Color = 'w' | 'b';

export type EnginePhase = 'human' | 'god' | 'sandbox';

export type PerspectiveMode = 'white' | 'black' | 'neutral';

export type MoveQuality =
  | 'brilliant'
  | 'best'
  | 'good'
  | 'inaccuracy'
  | 'miss'
  | 'mistake'
  | 'blunder';

export type QualityFilter =
  | 'auto'
  | 'brilliant'
  | 'best'
  | 'good'
  | 'miss'
  | 'mistake'
  | 'blunder';

export interface CandidateEval {
  uci: string;
  san: string;
  from: string;
  to: string;
  promotion?: string;
  /** Evaluation in centipawns from White's perspective */
  cpWhite: number;
  /** Mate in N from White's perspective (+White mates, -Black mates) */
  mateWhite?: number;
  /** Evaluation in centipawns from the side-to-move's perspective */
  cpMover: number;
  /** Mate in N from the side-to-move's perspective */
  mateMover?: number;
  isSacrifice: boolean;
  isCheck: boolean;
  isCapture: boolean;
  pvUci: string[];
  pvSan: string[];
  depth: number;
}

export interface BoardArrow {
  id: string;
  from: string;
  to: string;
  quality: MoveQuality;
  color: string;
  label?: string;
  badgeSymbol?: string;
  rank?: number;
  isThreat?: boolean;
  opacity?: number;
  widthScale?: number;
}

export interface ThreatMarker {
  square: string;
  color: Color;
  severity: 'hanging' | 'attacked' | 'check';
}

export interface HistoryEntry {
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  quality: MoveQuality;
  cpWhiteAfter: number;
  mateWhiteAfter?: number;
  bestMoveUci?: string;
  bestMoveSan?: string;
}

export interface EngineAnalysisResult {
  fen: string;
  turn: Color;
  bestCpWhite: number;
  bestMateWhite?: number;
  depth: number;
  /** Top 3 Multi-PV lines from Stockfish (or fallback engine) */
  topLines: CandidateEval[];
  /** Full spectrum of legal moves scored for Phase 1 Quality Forcer */
  allCandidates: CandidateEval[];
  /** Opponent's best threat move if it were their turn (for Neutral mode) */
  opponentThreat?: CandidateEval | null;
  /** Threatened/hanging piece markers */
  threatMarkers: ThreatMarker[];
  /** Engine source identifier */
  engineSource: 'stockfish' | 'hybrid';
}
