import { Chess } from 'chess.js';
import {
  buildOpponentTurnFen,
  candidateSortScore,
} from './classification';
import {
  detectMoveSacrifice,
  detectThreatMarkers,
  evaluateCandidatesSync,
  uciLineToSan,
} from './fastEvaluator';
import type {
  CandidateWorkerRequest,
  CandidateWorkerResponse,
} from './candidate.worker';
import type {
  CandidateEval,
  Color,
  EngineAnalysisResult,
  EnginePhase,
  PerspectiveMode,
} from './types';

const STOCKFISH_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

interface ParsedUciInfo {
  multipv: number;
  depth: number;
  cpMover?: number;
  mateMover?: number;
  pvUci: string[];
}

export interface AnalyzeOptions {
  fen: string;
  phase: EnginePhase;
  perspective: PerspectiveMode;
  movetimeMs?: number;
}

export class ChessEngineManager {
  private sfWorker: Worker | null = null;
  private sfBlobUrl: string | null = null;
  private sfReady = false;
  private sfFailed = false;
  private sfReadyWaiters: Array<() => void> = [];

  private candWorker: Worker | null = null;
  private currentSearchId = 0;
  private activeSfCancel: (() => void) | null = null;
  private activeCandReject: ((err: unknown) => void) | null = null;

  private cache = new Map<string, EngineAnalysisResult>();

  constructor() {
    this.initWorkers();
  }

  private initWorkers() {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      this.sfFailed = true;
      return;
    }
    this.spawnStockfishWorker();
    this.spawnCandidateWorker();
  }

  private spawnStockfishWorker() {
    this.cleanupStockfish();
    try {
      const workerCode = `
        try {
          importScripts('${STOCKFISH_CDN}');
        } catch (e) {
          self.postMessage('__SF_LOAD_ERROR__:' + (e && e.message ? e.message : 'failed'));
        }
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.sfBlobUrl = URL.createObjectURL(blob);
      const worker = new Worker(this.sfBlobUrl);
      this.sfWorker = worker;
      this.sfReady = false;
      this.sfFailed = false;

      const bootHandler = (e: MessageEvent<string>) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.startsWith('__SF_LOAD_ERROR__')) {
          this.sfFailed = true;
          this.flushReadyWaiters();
          worker.removeEventListener('message', bootHandler);
          return;
        }
        if (line === 'uciok') {
          worker.postMessage('setoption name Hash value 16');
          worker.postMessage('isready');
        } else if (line === 'readyok') {
          this.sfReady = true;
          this.flushReadyWaiters();
          worker.removeEventListener('message', bootHandler);
        }
      };

      worker.addEventListener('message', bootHandler);
      worker.addEventListener('error', () => {
        this.sfFailed = true;
        this.flushReadyWaiters();
      });
      worker.postMessage('uci');
    } catch {
      this.sfFailed = true;
      this.flushReadyWaiters();
    }
  }

  private flushReadyWaiters() {
    const list = this.sfReadyWaiters.splice(0);
    for (const resolve of list) resolve();
  }

  private waitForStockfishReady(timeoutMs = 500): Promise<boolean> {
    if (this.sfReady) return Promise.resolve(true);
    if (this.sfFailed || !this.sfWorker) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.sfReady), timeoutMs);
      this.sfReadyWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.sfReady);
      });
    });
  }

  private spawnCandidateWorker() {
    try {
      if (this.candWorker) {
        this.candWorker.terminate();
      }
      this.candWorker = new Worker(
        new URL('./candidate.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      this.candWorker = null;
    }
  }

  private cleanupStockfish() {
    if (this.sfWorker) {
      try {
        this.sfWorker.postMessage('stop');
        this.sfWorker.terminate();
      } catch {
        // Ignore termination error
      }
      this.sfWorker = null;
    }
    if (this.sfBlobUrl) {
      URL.revokeObjectURL(this.sfBlobUrl);
      this.sfBlobUrl = null;
    }
  }

  public cancelOngoing() {
    this.currentSearchId += 1;
    if (this.activeSfCancel) {
      this.activeSfCancel();
      this.activeSfCancel = null;
    }
    if (this.activeCandReject) {
      this.activeCandReject(new Error('Search cancelled'));
      this.activeCandReject = null;
    }
    if (this.sfWorker && this.sfReady) {
      try {
        this.sfWorker.postMessage('stop');
      } catch {
        // Ignore
      }
    }
  }

  public destroy() {
    this.cancelOngoing();
    this.cleanupStockfish();
    if (this.candWorker) {
      this.candWorker.terminate();
      this.candWorker = null;
    }
  }

  /**
   * Run asynchronous engine analysis strictly bounded to 300ms-600ms.
   * Immediately cancels any prior in-flight search so stale results never leak.
   */
  public async analyze(options: AnalyzeOptions): Promise<EngineAnalysisResult | null> {
    const { fen, phase, perspective } = options;
    const movetimeMs = Math.max(300, Math.min(580, options.movetimeMs ?? (phase === 'god' ? 460 : 380)));

    this.cancelOngoing();
    const searchId = this.currentSearchId;

    const chess = new Chess(fen);
    const turn = chess.turn();
    const legal = chess.moves({ verbose: true });

    if (legal.length === 0) {
      const staticCp = chess.isCheckmate() ? (turn === 'w' ? -100000 : 100000) : 0;
      const mateVal = chess.isCheckmate() ? (turn === 'w' ? -1 : 1) : undefined;
      return {
        fen,
        turn,
        bestCpWhite: staticCp,
        bestMateWhite: mateVal,
        depth: 0,
        topLines: [],
        allCandidates: [],
        opponentThreat: null,
        threatMarkers: detectThreatMarkers(fen),
        engineSource: 'hybrid',
      };
    }

    const cacheKey = `${fen}|${phase}|${perspective}`;
    const cached = this.cache.get(cacheKey);
    if (cached && phase !== 'human') {
      return cached;
    }

    const multiPv = phase === 'god' ? 1 : 3;

    // Run Stockfish (primary deep evaluation) and Candidate Worker (all legal moves spectrum) concurrently
    const [sfLines, candResult] = await Promise.all([
      this.runStockfishSearch(fen, turn, multiPv, movetimeMs, searchId),
      this.runCandidateWorker(fen, Math.min(260, movetimeMs - 80), phase === 'god' ? 2 : 2, searchId),
    ]);

    if (searchId !== this.currentSearchId) {
      return null;
    }

    const mergedCandidates = this.mergeCandidates(
      fen,
      turn,
      sfLines,
      candResult?.candidates ?? []
    );

    const topLines =
      sfLines.length > 0
        ? sfLines
        : mergedCandidates.slice(0, 3);

    const best = topLines[0] ?? mergedCandidates[0];
    const bestCpWhite = best ? best.cpWhite : 0;
    const bestMateWhite = best?.mateWhite;
    const depth = best ? best.depth : 2;

    // In Neutral (Both Sides) mode, also compute opponent's strongest immediate threat
    let opponentThreat: CandidateEval | null = null;
    if (perspective === 'neutral' && searchId === this.currentSearchId) {
      const oppFen = buildOpponentTurnFen(fen);
      if (oppFen) {
        const oppChess = new Chess(oppFen);
        const oppTurn = oppChess.turn();
        const oppLines = await this.runStockfishSearch(
          oppFen,
          oppTurn,
          1,
          160,
          searchId
        );
        if (searchId !== this.currentSearchId) return null;
        if (oppLines.length > 0) {
          opponentThreat = oppLines[0];
        } else {
          const oppFallback = await this.runCandidateWorker(oppFen, 140, 1, searchId);
          if (searchId !== this.currentSearchId) return null;
          opponentThreat = oppFallback?.candidates[0] ?? null;
        }
      }
    }

    const result: EngineAnalysisResult = {
      fen,
      turn,
      bestCpWhite,
      bestMateWhite,
      depth,
      topLines: topLines.slice(0, 3),
      allCandidates: mergedCandidates,
      opponentThreat,
      threatMarkers: candResult?.threatMarkers ?? detectThreatMarkers(fen),
      engineSource: sfLines.length > 0 ? 'stockfish' : 'hybrid',
    };

    if (this.cache.size > 24) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  private mergeCandidates(
    fen: string,
    turn: Color,
    sfLines: CandidateEval[],
    workerCandidates: CandidateEval[]
  ): CandidateEval[] {
    const byUci = new Map<string, CandidateEval>();

    for (const c of workerCandidates) {
      byUci.set(c.uci, c);
    }

    // Ensure every legal move is represented even if worker timed out early
    if (byUci.size === 0) {
      for (const c of evaluateCandidatesSync(fen, 140, 1)) {
        byUci.set(c.uci, c);
      }
    }

    // Stockfish lines override/upgrade matching moves with deep tactical scores
    for (const sf of sfLines) {
      const existing = byUci.get(sf.uci);
      byUci.set(sf.uci, {
        ...sf,
        isSacrifice: existing?.isSacrifice ?? sf.isSacrifice,
      });
    }

    // Also make sure any Stockfish move missing from map is included
    const sign = turn === 'w' ? 1 : -1;
    return Array.from(byUci.values())
      .map((c) => ({
        ...c,
        cpWhite: c.cpMover * sign,
      }))
      .sort((a, b) => candidateSortScore(b) - candidateSortScore(a));
  }

  private runCandidateWorker(
    fen: string,
    timeBudgetMs: number,
    maxDepth: number,
    searchId: number
  ): Promise<CandidateWorkerResponse | null> {
    if (!this.candWorker) {
      return Promise.resolve({
        searchId,
        fen,
        candidates: evaluateCandidatesSync(fen, timeBudgetMs, maxDepth),
        threatMarkers: detectThreatMarkers(fen),
      });
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (val: CandidateWorkerResponse | null) => {
        if (settled) return;
        settled = true;
        this.candWorker?.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(val);
      };

      const onMsg = (e: MessageEvent<CandidateWorkerResponse>) => {
        if (e.data?.searchId === searchId) {
          finish(e.data);
        }
      };

      const timer = setTimeout(() => {
        finish(null);
      }, timeBudgetMs + 180);

      this.activeCandReject = () => finish(null);
      this.candWorker!.addEventListener('message', onMsg);
      const req: CandidateWorkerRequest = {
        searchId,
        fen,
        timeBudgetMs,
        maxDepth,
      };
      this.candWorker!.postMessage(req);
    });
  }

  private async runStockfishSearch(
    fen: string,
    turn: Color,
    multiPv: number,
    movetimeMs: number,
    searchId: number
  ): Promise<CandidateEval[]> {
    if (this.sfFailed || !this.sfWorker) {
      return [];
    }
    if (!this.sfReady) {
      const becameReady = await this.waitForStockfishReady(950);
      if (!becameReady || searchId !== this.currentSearchId) {
        return [];
      }
    }

    return new Promise((resolve) => {
      const worker = this.sfWorker!;
      const pvMap = new Map<number, ParsedUciInfo>();
      let settled = false;

      const finish = (lines: CandidateEval[]) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener('message', onMessage);
        clearTimeout(hardTimer);
        if (this.activeSfCancel === cancelFn) {
          this.activeSfCancel = null;
        }
        resolve(lines);
      };

      const cancelFn = () => {
        finish([]);
      };
      this.activeSfCancel = cancelFn;

      // Hard watchdog so Stockfish never hangs browser or leaks memory
      const hardTimer = setTimeout(() => {
        try {
          worker.postMessage('stop');
        } catch {
          // Ignore
        }
        finish(this.convertParsedInfos(fen, turn, pvMap));
      }, movetimeMs + 320);

      const onMessage = (event: MessageEvent<string>) => {
        if (searchId !== this.currentSearchId) {
          finish([]);
          return;
        }
        const line = typeof event.data === 'string' ? event.data : '';
        if (!line) return;

        if (line.startsWith('info ') && line.includes(' pv ')) {
          const parsed = parseUciInfoLine(line);
          if (parsed && parsed.pvUci.length > 0) {
            const prev = pvMap.get(parsed.multipv);
            if (!prev || parsed.depth >= prev.depth) {
              pvMap.set(parsed.multipv, parsed);
            }
          }
        } else if (line.startsWith('bestmove')) {
          finish(this.convertParsedInfos(fen, turn, pvMap));
        }
      };

      worker.addEventListener('message', onMessage);
      try {
        worker.postMessage('stop');
        worker.postMessage(`setoption name MultiPV value ${multiPv}`);
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go movetime ${movetimeMs}`);
      } catch {
        finish([]);
      }
    });
  }

  private convertParsedInfos(
    fen: string,
    turn: Color,
    pvMap: Map<number, ParsedUciInfo>
  ): CandidateEval[] {
    const sign = turn === 'w' ? 1 : -1;
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });
    const legalByUci = new Map<string, (typeof legalMoves)[number]>();
    for (const mv of legalMoves) {
      legalByUci.set(`${mv.from}${mv.to}${mv.promotion ?? ''}`, mv);
    }

    const entries = Array.from(pvMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, info]) => info);

    const out: CandidateEval[] = [];
    for (const info of entries) {
      const rootUci = info.pvUci[0];
      const mv = legalByUci.get(rootUci);
      if (!mv) continue;

      const cpMover =
        info.mateMover !== undefined
          ? info.mateMover > 0
            ? 99000 - info.mateMover * 100
            : -99000 - info.mateMover * 100
          : info.cpMover ?? 0;

      const pvSan = uciLineToSan(fen, info.pvUci.slice(0, 6));
      const isSacrifice = detectMoveSacrifice(fen, rootUci);

      out.push({
        uci: rootUci,
        san: mv.san,
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion,
        cpWhite: cpMover * sign,
        mateWhite: info.mateMover !== undefined ? info.mateMover * sign : undefined,
        cpMover,
        mateMover: info.mateMover,
        isSacrifice,
        isCheck: mv.san.includes('+') || mv.san.includes('#'),
        isCapture: Boolean(mv.captured),
        pvUci: info.pvUci.slice(0, 6),
        pvSan,
        depth: info.depth,
      });
    }

    return out;
  }
}

function parseUciInfoLine(line: string): ParsedUciInfo | null {
  const tokens = line.split(/\s+/);
  let multipv = 1;
  let depth = 1;
  let cpMover: number | undefined;
  let mateMover: number | undefined;
  let pvUci: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === 'multipv' && tokens[i + 1]) {
      multipv = parseInt(tokens[i + 1], 10) || 1;
    } else if (tok === 'depth' && tokens[i + 1]) {
      depth = parseInt(tokens[i + 1], 10) || 1;
    } else if (tok === 'score' && tokens[i + 1] && tokens[i + 2]) {
      const kind = tokens[i + 1];
      const val = parseInt(tokens[i + 2], 10);
      if (!Number.isNaN(val)) {
        if (kind === 'cp') cpMover = val;
        if (kind === 'mate') mateMover = val;
      }
    } else if (tok === 'pv') {
      pvUci = tokens.slice(i + 1).filter((t) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t));
      break;
    }
  }

  if (pvUci.length === 0) return null;
  return { multipv, depth, cpMover, mateMover, pvUci };
}
