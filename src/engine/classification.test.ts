import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpponentTurnFen,
  classifyPlayedMove,
  evalToWinPercent,
  formatEvalScore,
  parseAndValidateFen,
  selectMoveForQualityFilter,
} from './classification';
import {
  CURATED_FENS,
  detectMoveSacrifice,
  detectThreatMarkers,
  evaluateCandidatesSync,
  STARTING_FEN,
  uciLineToSan,
} from './fastEvaluator';
import type { CandidateEval } from './types';

function makeCandidate(
  uci: string,
  cpMover: number,
  extra: Partial<CandidateEval> = {}
): CandidateEval {
  return {
    uci,
    san: uci,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    cpWhite: cpMover,
    cpMover,
    isSacrifice: false,
    isCheck: false,
    isCapture: false,
    pvUci: [uci],
    pvSan: [uci],
    depth: 4,
    ...extra,
  };
}

test('evalToWinPercent stays balanced at 0 and saturates on mate', () => {
  assert.equal(evalToWinPercent(0), 50);
  assert.ok(evalToWinPercent(300) > 70);
  assert.ok(evalToWinPercent(-300) < 30);
  assert.equal(evalToWinPercent(0, 3), 100);
  assert.equal(evalToWinPercent(0, -2), 0);
});

test('formatEvalScore handles centipawns and mates cleanly', () => {
  assert.equal(formatEvalScore(0), '0.0');
  assert.equal(formatEvalScore(142), '+1.4');
  assert.equal(formatEvalScore(-80), '-0.8');
  assert.equal(formatEvalScore(0, 4), 'M4');
  assert.equal(formatEvalScore(0, -1), '-M1');
});

test('classifyPlayedMove classifies Best, Good, Inaccuracy, Mistake, Blunder, and Brilliant', () => {
  const best = makeCandidate('e2e4', 45);
  assert.equal(
    classifyPlayedMove({
      playedUci: 'e2e4',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: 45,
    }),
    'best'
  );

  assert.equal(
    classifyPlayedMove({
      playedUci: 'd2d4',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: 0,
    }),
    'good'
  );

  assert.equal(
    classifyPlayedMove({
      playedUci: 'a2a3',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: -55,
    }),
    'inaccuracy'
  );

  assert.equal(
    classifyPlayedMove({
      playedUci: 'g2g4',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: -220,
    }),
    'mistake'
  );

  assert.equal(
    classifyPlayedMove({
      playedUci: 'f2f3',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: -450,
    }),
    'blunder'
  );

  assert.equal(
    classifyPlayedMove({
      playedUci: 'b4h7',
      bestCandidate: best,
      cpMoverBeforeBest: 45,
      cpMoverAfter: 35,
      isSacrifice: true,
    }),
    'brilliant'
  );
});

test('selectMoveForQualityFilter returns matching move for every quality button', () => {
  const candidates: CandidateEval[] = [
    makeCandidate('e2e4', 50, { isCheck: false }),
    makeCandidate('b4h7', 30, { isSacrifice: true, isCheck: true }),
    makeCandidate('d2d4', 15),
    makeCandidate('c2c3', -75),
    makeCandidate('a2a4', -115),
    makeCandidate('h2h4', -200),
    makeCandidate('f2f3', -520),
  ];

  const bestPick = selectMoveForQualityFilter(candidates, 'best');
  assert.equal(bestPick?.candidate.uci, 'e2e4');
  assert.equal(bestPick?.quality, 'best');

  const brilliantPick = selectMoveForQualityFilter(candidates, 'brilliant');
  assert.equal(brilliantPick?.candidate.uci, 'b4h7');
  assert.equal(brilliantPick?.quality, 'brilliant');

  const goodPick = selectMoveForQualityFilter(candidates, 'good');
  assert.equal(goodPick?.candidate.uci, 'd2d4');
  assert.equal(goodPick?.quality, 'good');

  const missPick = selectMoveForQualityFilter(candidates, 'miss');
  assert.equal(missPick?.quality, 'miss');
  assert.ok(['c2c3', 'a2a4', 'h2h4'].includes(missPick?.candidate.uci ?? ''));

  const mistakePick = selectMoveForQualityFilter(candidates, 'mistake');
  assert.equal(mistakePick?.candidate.uci, 'h2h4');
  assert.equal(mistakePick?.quality, 'mistake');

  const blunderPick = selectMoveForQualityFilter(candidates, 'blunder');
  assert.equal(blunderPick?.candidate.uci, 'f2f3');
  assert.equal(blunderPick?.quality, 'blunder');
});

test('parseAndValidateFen rejects invalid FEN and accepts valid FEN', () => {
  assert.equal(parseAndValidateFen('').valid, false);
  assert.equal(parseAndValidateFen('invalid fen string').valid, false);
  const ok = parseAndValidateFen(STARTING_FEN);
  assert.equal(ok.valid, true);
  assert.equal(ok.turn, 'w');
});

test('buildOpponentTurnFen safely flips side to move only when not in check', () => {
  const flipped = buildOpponentTurnFen(STARTING_FEN);
  assert.ok(flipped && flipped.includes(' b '));

  // Position where White is in check on e1 from Black rook on e8
  const inCheckFen = '4r2k/8/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(buildOpponentTurnFen(inCheckFen), null);
});

test('uciLineToSan converts UCI sequences accurately', () => {
  const sans = uciLineToSan(STARTING_FEN, ['e2e4', 'e7e5', 'g1f3']);
  assert.deepEqual(sans, ['e4', 'e5', 'Nf3']);
});

test('detectMoveSacrifice identifies Greek Gift Bxh7+ as a tactical sacrifice', () => {
  const greekGift = CURATED_FENS.find((p) => p.id === 'greek-gift')!;
  assert.equal(detectMoveSacrifice(greekGift.fen, 'd3h7'), true);
});

test('detectThreatMarkers detects hanging pieces and checks', () => {
  // White knight on g5 attacked by Black queen on d8? Let's place undefended White rook on e5 attacked by Black bishop on c7
  const fen = '4k3/2b5/8/4R3/8/8/8/4K3 w - - 0 1';
  const markers = detectThreatMarkers(fen);
  assert.ok(markers.some((m) => m.square === 'e5' && m.severity === 'hanging'));
});

test('evaluateCandidatesSync scores all legal moves in starting and tactical positions', () => {
  const startScores = evaluateCandidatesSync(STARTING_FEN, 150, 1);
  assert.equal(startScores.length, 20);

  const opera = CURATED_FENS.find((p) => p.id === 'opera-mate')!;
  const operaScores = evaluateCandidatesSync(opera.fen, 220, 2);
  assert.ok(operaScores.length > 0);
  // Top move in Opera position is Qb8+!
  assert.equal(operaScores[0].uci, 'b3b8');
});
