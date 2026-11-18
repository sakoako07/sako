import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { AnalysisSidebar } from './components/AnalysisSidebar';
import { ChessBoard } from './components/ChessBoard';
import { ChessPiece } from './components/ChessPiece';
import { EngineControls } from './components/EngineControls';
import { EvaluationBar } from './components/EvaluationBar';
import {
  classifyPlayedMove,
  parseAndValidateFen,
  QUALITY_META,
  selectMoveForQualityFilter,
} from './engine/classification';
import {
  detectMoveSacrifice,
  getCapturedAndMaterial,
  STARTING_FEN,
} from './engine/fastEvaluator';
import { ChessEngineManager } from './engine/stockfishManager';
import type {
  BoardArrow,
  CandidateEval,
  Color,
  EngineAnalysisResult,
  EnginePhase,
  HistoryEntry,
  MoveQuality,
  PerspectiveMode,
  QualityFilter,
} from './engine/types';
import { playChessSound } from './utils/sound';

const MULTIPV_ARROW_COLORS = ['#81b64c', '#3b9ed8', '#d9a441'] as const;

export default function App() {
  const [rootFen, setRootFen] = useState<string>(STARTING_FEN);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewPly, setViewPly] = useState<number>(0);

  const [phase, setPhase] = useState<EnginePhase>('human');
  const [perspective, setPerspective] = useState<PerspectiveMode>('white');
  const [flipped, setFlipped] = useState<boolean>(false);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('auto');
  const [autoReply, setAutoReply] = useState<boolean>(true);
  const [muted, setMuted] = useState<boolean>(false);
  const [fenError, setFenError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<EngineAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [recalcNonce, setRecalcNonce] = useState<number>(0);

  const engineRef = useRef<ChessEngineManager | null>(null);
  const analysisCacheRef = useRef<Map<string, EngineAnalysisResult>>(new Map());
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active FEN at the currently viewed ply
  const activeFen = useMemo(() => {
    if (viewPly === 0 || history.length === 0) return rootFen;
    return history[viewPly - 1]?.fenAfter ?? rootFen;
  }, [rootFen, history, viewPly]);

  const activeChess = useMemo(() => new Chess(activeFen), [activeFen]);
  const activeTurn: Color = activeChess.turn();

  const gameOverMessage = useMemo(() => {
    if (activeChess.isCheckmate()) {
      return activeTurn === 'w'
        ? 'Checkmate · Black wins'
        : 'Checkmate · White wins';
    }
    if (activeChess.isStalemate()) return 'Draw · Stalemate';
    if (activeChess.isThreefoldRepetition()) return 'Draw · Repetition';
    if (activeChess.isInsufficientMaterial()) return 'Draw · Insufficient material';
    if (activeChess.isDraw()) return 'Draw · 50-move rule';
    return null;
  }, [activeChess, activeTurn]);

  useEffect(() => {
    document.body.dataset.state = gameOverMessage ? 'gameover' : 'playing';
  }, [gameOverMessage]);

  // Initialize and clean up Web Worker Engine Manager
  useEffect(() => {
    const mgr = new ChessEngineManager();
    engineRef.current = mgr;
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      mgr.destroy();
      engineRef.current = null;
    };
  }, []);

  // Run asynchronous Web Worker analysis whenever position, phase, perspective, or filter changes
  useEffect(() => {
    const mgr = engineRef.current;
    if (!mgr) return;

    let cancelled = false;
    setIsAnalyzing(true);

    const movetimeMs = phase === 'god' ? 460 : phase === 'sandbox' ? 420 : 360;

    mgr
      .analyze({
        fen: activeFen,
        phase,
        perspective,
        movetimeMs,
      })
      .then((res) => {
        if (cancelled || !res) return;
        analysisCacheRef.current.set(res.fen, res);
        if (analysisCacheRef.current.size > 40) {
          const oldest = analysisCacheRef.current.keys().next().value;
          if (oldest) analysisCacheRef.current.delete(oldest);
        }
        setAnalysis(res);
        setIsAnalyzing(false);

        // Retroactively refine the classification badge of the move that led to this position
        if (viewPly > 0) {
          setHistory((prev) => {
            const idx = viewPly - 1;
            const entry = prev[idx];
            if (!entry || entry.fenAfter !== res.fen) return prev;
            const preEval = analysisCacheRef.current.get(entry.fenBefore);
            if (!preEval) return prev;

            const bestBefore = preEval.topLines[0] ?? preEval.allCandidates[0];
            const playedCand = preEval.allCandidates.find((c) => c.uci === entry.uci);
            const moverSign = entry.color === 'w' ? 1 : -1;
            const cpMoverBeforeBest = bestBefore ? bestBefore.cpMover : 0;
            const cpMoverAfter = res.bestCpWhite * moverSign;
            const mateMoverAfter =
              res.bestMateWhite !== undefined ? res.bestMateWhite * moverSign : undefined;
            const mateMoverBeforeBest = bestBefore?.mateMover;

            const refined = classifyPlayedMove({
              playedUci: entry.uci,
              bestCandidate: bestBefore,
              playedCandidate: playedCand,
              cpMoverBeforeBest,
              cpMoverAfter,
              mateMoverBeforeBest,
              mateMoverAfter,
              isSacrifice: playedCand?.isSacrifice ?? detectMoveSacrifice(entry.fenBefore, entry.uci),
              isCheck: playedCand?.isCheck,
              wasForced: preEval.allCandidates.length <= 1,
            });

            if (
              refined === entry.quality &&
              entry.cpWhiteAfter === res.bestCpWhite &&
              entry.mateWhiteAfter === res.bestMateWhite
            ) {
              return prev;
            }

            const next = [...prev];
            next[idx] = {
              ...entry,
              quality: refined,
              cpWhiteAfter: res.bestCpWhite,
              mateWhiteAfter: res.bestMateWhite,
            };
            return next;
          });
        }
      })
      .catch(() => {
        if (!cancelled) setIsAnalyzing(false);
      });

    return () => {
      cancelled = true;
      mgr.cancelOngoing();
    };
  }, [activeFen, phase, perspective, qualityFilter, recalcNonce, viewPly]);

  // Execute a legal move on the board
  const playMove = useCallback(
    (
      from: Square,
      to: Square,
      promotion?: 'q' | 'r' | 'b' | 'n',
      forcedQualityHint?: MoveQuality
    ): boolean => {
      if (aiTimerRef.current) {
        clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }

      const boardBefore = new Chess(activeFen);
      const uciAttempt = `${from}${to}${promotion ?? ''}`;
      let moveResult: ReturnType<Chess['move']> | null = null;
      try {
        moveResult = boardBefore.move({ from, to, promotion });
      } catch {
        return false;
      }
      if (!moveResult) return false;

      const fenAfter = boardBefore.fen();
      const moverColor = moveResult.color;
      const uci = `${moveResult.from}${moveResult.to}${moveResult.promotion ?? ''}`;

      // Immediate classification from cached pre-move analysis (refined once post-move worker completes)
      const preEval =
        analysis?.fen === activeFen
          ? analysis
          : analysisCacheRef.current.get(activeFen);

      const bestBefore = preEval?.topLines[0] ?? preEval?.allCandidates[0];
      const playedCand = preEval?.allCandidates.find((c) => c.uci === uci || c.uci === uciAttempt);
      const isSac = playedCand?.isSacrifice ?? detectMoveSacrifice(activeFen, uci);

      let initialQuality: MoveQuality = 'good';
      if (forcedQualityHint) {
        initialQuality = forcedQualityHint;
      } else if (preEval && preEval.allCandidates.length > 0) {
        initialQuality = classifyPlayedMove({
          playedUci: uci,
          bestCandidate: bestBefore,
          playedCandidate: playedCand,
          cpMoverBeforeBest: bestBefore?.cpMover ?? 0,
          cpMoverAfter: playedCand?.cpMover ?? 0,
          mateMoverBeforeBest: bestBefore?.mateMover,
          mateMoverAfter: playedCand?.mateMover,
          isSacrifice: isSac,
          isCheck: moveResult.san.includes('+') || moveResult.san.includes('#'),
          wasForced: preEval.allCandidates.length <= 1,
        });
      }

      const cpAfter = playedCand?.cpWhite ?? preEval?.bestCpWhite ?? 0;

      // Audio feedback
      if (boardBefore.isCheckmate() || boardBefore.isStalemate() || boardBefore.isDraw()) {
        playChessSound('gameover', muted);
      } else if (boardBefore.inCheck()) {
        playChessSound('check', muted);
      } else if (moveResult.san.startsWith('O-')) {
        playChessSound('castle', muted);
      } else if (moveResult.captured) {
        playChessSound('capture', muted);
      } else {
        playChessSound('move', muted);
      }

      engineRef.current?.cancelOngoing();

      setHistory((prev) => {
        const sliced = prev.slice(0, viewPly);
        const entry: HistoryEntry = {
          ply: sliced.length + 1,
          san: moveResult.san,
          uci,
          from: moveResult.from,
          to: moveResult.to,
          color: moverColor,
          fenBefore: activeFen,
          fenAfter,
          quality: initialQuality,
          cpWhiteAfter: cpAfter,
          mateWhiteAfter: playedCand?.mateWhite,
          bestMoveUci: bestBefore?.uci,
          bestMoveSan: bestBefore?.san,
        };
        return [...sliced, entry];
      });
      setViewPly((p) => p + 1);
      return true;
    },
    [activeFen, analysis, muted, viewPly]
  );

  // Compute the active suggestion for the current phase/filter
  const activeSuggestion = useMemo<{
    candidate: CandidateEval;
    quality: MoveQuality;
  } | null>(() => {
    if (!analysis || analysis.fen !== activeFen || gameOverMessage) return null;
    const pool =
      analysis.allCandidates.length > 0
        ? analysis.allCandidates
        : analysis.topLines;
    if (pool.length === 0) return null;

    if (phase === 'human') {
      return selectMoveForQualityFilter(
        pool,
        qualityFilter,
        viewPly + recalcNonce
      );
    }

    const top = analysis.topLines[0] ?? pool[0];
    if (!top) return null;
    const quality: MoveQuality = top.isSacrifice ? 'brilliant' : 'best';
    return { candidate: top, quality };
  }, [analysis, activeFen, gameOverMessage, phase, qualityFilter, viewPly, recalcNonce]);

  // Auto-Reply Opponent AI in Assist White / Assist Black when VS AI is enabled
  useEffect(() => {
    if (aiTimerRef.current) {
      clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }

    if (
      !autoReply ||
      phase === 'sandbox' ||
      perspective === 'neutral' ||
      viewPly !== history.length ||
      gameOverMessage ||
      !analysis ||
      analysis.fen !== activeFen
    ) {
      return;
    }

    const humanColor: Color = perspective === 'white' ? 'w' : 'b';
    if (activeTurn === humanColor) return;

    const pool =
      analysis.allCandidates.length > 0
        ? analysis.allCandidates
        : analysis.topLines;
    if (pool.length === 0) return;

    const chosen =
      phase === 'god'
        ? {
            candidate: analysis.topLines[0] ?? pool[0],
            quality: (analysis.topLines[0]?.isSacrifice ? 'brilliant' : 'best') as MoveQuality,
          }
        : selectMoveForQualityFilter(pool, 'auto', viewPly + 13);

    if (!chosen) return;

    aiTimerRef.current = setTimeout(() => {
      playMove(
        chosen.candidate.from as Square,
        chosen.candidate.to as Square,
        chosen.candidate.promotion as 'q' | 'r' | 'b' | 'n' | undefined,
        chosen.quality
      );
    }, 240);

    return () => {
      if (aiTimerRef.current) {
        clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [
    autoReply,
    phase,
    perspective,
    viewPly,
    history.length,
    gameOverMessage,
    analysis,
    activeFen,
    activeTurn,
    playMove,
  ]);

  // Build SVG Arrows strictly respecting Perspective, Phase, and Quality Colors
  const computedArrows = useMemo<BoardArrow[]>(() => {
    if (!analysis || analysis.fen !== activeFen || gameOverMessage) return [];

    const arrows: BoardArrow[] = [];

    if (perspective === 'neutral') {
      if (phase === 'sandbox') {
        // Phase 3 Neutral: Top 3 Multi-PV lines for active side + Opponent threat arrow
        analysis.topLines.slice(0, 3).forEach((line, idx) => {
          const quality: MoveQuality = line.isSacrifice
            ? 'brilliant'
            : idx === 0
            ? 'best'
            : 'good';
          const arrowColor =
            quality === 'brilliant'
              ? QUALITY_META.brilliant.arrowColor
              : MULTIPV_ARROW_COLORS[idx] ?? '#81b64c';
          arrows.push({
            id: `pv-${idx + 1}`,
            from: line.from,
            to: line.to,
            quality,
            color: arrowColor,
            badgeSymbol: QUALITY_META[quality].symbol,
            rank: idx + 1,
            opacity: idx === 0 ? 0.9 : idx === 1 ? 0.72 : 0.56,
            widthScale: idx === 0 ? 1.05 : idx === 1 ? 0.85 : 0.72,
          });
        });
      } else if (activeSuggestion) {
        const meta = QUALITY_META[activeSuggestion.quality];
        arrows.push({
          id: 'main-suggestion',
          from: activeSuggestion.candidate.from,
          to: activeSuggestion.candidate.to,
          quality: activeSuggestion.quality,
          color: meta.arrowColor,
          badgeSymbol: meta.symbol,
          opacity: 0.9,
          widthScale: 1.05,
        });
      }

      if (analysis.opponentThreat) {
        arrows.push({
          id: 'opp-threat',
          from: analysis.opponentThreat.from,
          to: analysis.opponentThreat.to,
          quality: 'miss',
          color: '#ee6c38',
          badgeSymbol: '!',
          isThreat: true,
          opacity: 0.78,
          widthScale: 0.82,
        });
      }
      return arrows;
    }

    // Play/Assist White or Play/Assist Black: arrows ONLY assist the chosen side
    const assistedColor: Color = perspective === 'white' ? 'w' : 'b';

    if (activeTurn === assistedColor) {
      if (phase === 'sandbox') {
        analysis.topLines.slice(0, 3).forEach((line, idx) => {
          const quality: MoveQuality = line.isSacrifice
            ? 'brilliant'
            : idx === 0
            ? 'best'
            : 'good';
          const arrowColor =
            quality === 'brilliant'
              ? QUALITY_META.brilliant.arrowColor
              : MULTIPV_ARROW_COLORS[idx] ?? '#81b64c';
          arrows.push({
            id: `pv-${idx + 1}`,
            from: line.from,
            to: line.to,
            quality,
            color: arrowColor,
            badgeSymbol: QUALITY_META[quality].symbol,
            rank: idx + 1,
            opacity: idx === 0 ? 0.9 : idx === 1 ? 0.72 : 0.56,
            widthScale: idx === 0 ? 1.05 : idx === 1 ? 0.85 : 0.72,
          });
        });
      } else if (activeSuggestion) {
        const meta = QUALITY_META[activeSuggestion.quality];
        arrows.push({
          id: 'assist-suggestion',
          from: activeSuggestion.candidate.from,
          to: activeSuggestion.candidate.to,
          quality: activeSuggestion.quality,
          color: meta.arrowColor,
          badgeSymbol: meta.symbol,
          opacity: 0.92,
          widthScale: 1.05,
        });
      }
    } else if (!autoReply && analysis.opponentThreat) {
      // Opponent's turn with Auto-Reply OFF: only draw assisted side's best upcoming counter-threat
      arrows.push({
        id: 'assisted-counter',
        from: analysis.opponentThreat.from,
        to: analysis.opponentThreat.to,
        quality: 'best',
        color: '#26c6da',
        badgeSymbol: '★',
        isThreat: true,
        opacity: 0.75,
        widthScale: 0.85,
      });
    }

    return arrows;
  }, [
    analysis,
    activeFen,
    gameOverMessage,
    perspective,
    phase,
    activeSuggestion,
    activeTurn,
    autoReply,
  ]);

  // Keyboard move navigation (ArrowLeft / ArrowRight)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewPly((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewPly((p) => Math.min(history.length, p + 1));
      } else if (e.key === 'Home') {
        setViewPly(0);
      } else if (e.key === 'End') {
        setViewPly(history.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history.length]);

  const handlePhaseChange = (nextPhase: EnginePhase) => {
    engineRef.current?.cancelOngoing();
    setPhase(nextPhase);
    if (nextPhase === 'sandbox') {
      setAutoReply(false);
    }
  };

  const handlePerspectiveChange = (nextPerspective: PerspectiveMode) => {
    engineRef.current?.cancelOngoing();
    setPerspective(nextPerspective);
    if (nextPerspective === 'white') {
      setFlipped(false);
      if (phase !== 'sandbox') setAutoReply(true);
    } else if (nextPerspective === 'black') {
      setFlipped(true);
      if (phase !== 'sandbox') setAutoReply(true);
    } else {
      setAutoReply(false);
    }
  };

  const handleQualityFilterChange = (filter: QualityFilter) => {
    engineRef.current?.cancelOngoing();
    setQualityFilter(filter);
    setRecalcNonce((n) => n + 1);
  };

  const handleResetGame = () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    engineRef.current?.cancelOngoing();
    setRootFen(STARTING_FEN);
    setHistory([]);
    setViewPly(0);
    setFenError(null);
    setRecalcNonce((n) => n + 1);
  };

  const handleUndoMove = () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    engineRef.current?.cancelOngoing();
    if (viewPly === 0) return;
    const targetPly =
      autoReply && perspective !== 'neutral' && viewPly >= 2
        ? viewPly - 2
        : viewPly - 1;
    setHistory((prev) => prev.slice(0, targetPly));
    setViewPly(targetPly);
  };

  const handleLoadFen = (fen: string) => {
    const check = parseAndValidateFen(fen);
    if (!check.valid) {
      setFenError(check.error ?? 'Invalid FEN position.');
      return;
    }
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    engineRef.current?.cancelOngoing();
    setFenError(null);
    setRootFen(fen.trim());
    setHistory([]);
    setViewPly(0);
    setRecalcNonce((n) => n + 1);
  };

  const lastEntry = viewPly > 0 ? history[viewPly - 1] : null;
  const evalCpWhite = analysis?.bestCpWhite ?? lastEntry?.cpWhiteAfter ?? 0;
  const evalMateWhite = analysis?.bestMateWhite ?? lastEntry?.mateWhiteAfter;

  const material = useMemo(() => getCapturedAndMaterial(activeFen), [activeFen]);

  const topColor: Color = flipped ? 'w' : 'b';
  const bottomColor: Color = flipped ? 'b' : 'w';

  const getPlayerLabel = (color: Color) => {
    if (perspective === 'neutral' || phase === 'sandbox') {
      return color === 'w' ? 'White' : 'Black';
    }
    const humanColor: Color = perspective === 'white' ? 'w' : 'b';
    if (color === humanColor) {
      return `${color === 'w' ? 'White' : 'Black'} (You)`;
    }
    if (!autoReply) {
      return color === 'w' ? 'White' : 'Black';
    }
    return phase === 'god'
      ? 'Stockfish 3500 ELO'
      : 'Natural Human AI';
  };

  const renderPlayerStrip = (color: Color) => {
    const captured = color === 'w' ? material.whiteCaptured : material.blackCaptured;
    const adv =
      color === 'w'
        ? material.whiteAdvantage > 0
          ? material.whiteAdvantage
          : 0
        : material.whiteAdvantage < 0
        ? -material.whiteAdvantage
        : 0;
    const isTurn = activeTurn === color && !gameOverMessage;

    return (
      <div className="flex items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-3.5 h-3.5 rounded-[3px] border border-[#4a4741] shrink-0 ${
              color === 'w' ? 'bg-[#f4f3ef]' : 'bg-[#1a1917]'
            }`}
            aria-hidden="true"
          />
          <span
            className={`text-xs sm:text-sm font-bold truncate ${
              isTurn ? 'text-white' : 'text-[#a3a098]'
            }`}
          >
            {getPlayerLabel(color)}
          </span>
          {isTurn && (
            <span className="text-[11px] font-semibold text-[#96bc4b] whitespace-nowrap shrink-0">
              Turn
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 min-h-[20px]">
          {captured.slice(0, 12).map((pieceType, idx) => {
            const capturedColor = color === 'w' ? 'b' : 'w';
            return (
              <span
                key={`${pieceType}-${idx}`}
                className={`w-4 h-4 inline-flex ${
                  capturedColor === 'b'
                    ? 'drop-shadow-[0_0_1.5px_rgba(240,238,230,0.65)]'
                    : ''
                }`}
              >
                <ChessPiece
                  type={pieceType}
                  color={capturedColor}
                  className="w-full h-full"
                />
              </span>
            );
          })}
          {adv > 0 && (
            <span className="font-mono-tabular text-xs font-bold text-[#c5c2bb] ml-0.5">
              +{adv}
            </span>
          )}
        </div>
      </div>
    );
  };

  // Board is always interactive except while viewing historical moves in auto-AI mode?
  // Allowing direct move branching from any viewed ply is standard Chess.com analysis behavior.
  const canInteractBoard = !gameOverMessage;

  return (
    <div className="min-h-screen bg-[#1b1a17] text-[#f1f0ec] flex flex-col">
      {/* Compact Header (Top Bar Contract) */}
      <header className="border-b border-[#2e2c28] bg-[#21201d] px-4 sm:px-6 py-2.5">
        <div className="max-w-[1260px] mx-auto flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleResetGame();
            }}
            className="text-base sm:text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Grandmaster Board
          </a>

          <nav
            className="hidden sm:flex items-center gap-6 text-xs font-semibold text-[#a3a098]"
            aria-label="Analysis shortcuts"
          >
            <button
              type="button"
              onClick={() => handlePhaseChange('human')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                phase === 'human' ? 'text-[#f1f0ec]' : ''
              }`}
            >
              Human Style
            </button>
            <button
              type="button"
              onClick={() => handlePhaseChange('god')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                phase === 'god' ? 'text-[#f1f0ec]' : ''
              }`}
            >
              3500 ELO
            </button>
            <button
              type="button"
              onClick={() => handlePhaseChange('sandbox')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                phase === 'sandbox' ? 'text-[#f1f0ec]' : ''
              }`}
            >
              Multi-PV Review
            </button>
          </nav>

          <button
            type="button"
            onClick={handleResetGame}
            data-testid="header-new-game"
            className="px-3.5 py-1.5 rounded-md bg-[#81b64c] hover:bg-[#91c45c] text-[#141412] text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            New Game
          </button>
        </div>
      </header>

      {/* Main Chess Analysis Workspace */}
      <main className="flex-1 w-full max-w-[1260px] mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col gap-3">
        <EngineControls
          phase={phase}
          perspective={perspective}
          qualityFilter={qualityFilter}
          autoReply={autoReply}
          onPhaseChange={handlePhaseChange}
          onPerspectiveChange={handlePerspectiveChange}
          onQualityFilterChange={handleQualityFilterChange}
          onAutoReplyChange={setAutoReply}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,660px)_400px] xl:grid-cols-[minmax(0,660px)_420px] justify-center gap-5 items-start">
          {/* Left Column: Eval Bar + Board + Player Strips */}
          <section
            aria-label="Interactive chessboard"
            className="w-full max-w-[660px] mx-auto lg:mx-0 flex flex-col gap-1"
          >
            <div className="pl-9 sm:pl-10">{renderPlayerStrip(topColor)}</div>

            <div className="flex items-stretch gap-2 sm:gap-2.5 w-full">
              {/* Vertical Real-Time Evaluation Bar */}
              <div className="self-stretch">
                <EvaluationBar
                  cpWhite={evalCpWhite}
                  mateWhite={evalMateWhite}
                  flipped={flipped}
                  isAnalyzing={isAnalyzing}
                />
              </div>

              {/* Board Container */}
              <div className="relative flex-1 min-w-0">
                <ChessBoard
                  fen={activeFen}
                  flipped={flipped}
                  interactive={canInteractBoard}
                  lastMove={
                    lastEntry
                      ? { from: lastEntry.from, to: lastEntry.to }
                      : null
                  }
                  lastMoveQuality={lastEntry?.quality ?? null}
                  arrows={computedArrows}
                  threatMarkers={analysis?.threatMarkers ?? []}
                  showThreatMarkers={perspective === 'neutral'}
                  onMove={(from, to, promo) => playMove(from, to, promo)}
                />

                {/* Game Over Banner */}
                {gameOverMessage && (
                  <div
                    role="status"
                    data-testid="gameover-banner"
                    className="mt-2.5 px-4 py-2.5 rounded-lg bg-[#262522] border border-[#81b64c]/60 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm font-bold text-white">
                      {gameOverMessage}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewPly(Math.max(0, history.length - 1))}
                        className="px-3 py-1.5 rounded bg-[#35332e] hover:bg-[#44413b] text-xs font-semibold text-[#f1f0ec] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Step Back
                      </button>
                      <button
                        type="button"
                        onClick={handleResetGame}
                        className="px-3 py-1.5 rounded bg-[#81b64c] hover:bg-[#91c45c] text-[#141412] text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Play Again
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pl-9 sm:pl-10">{renderPlayerStrip(bottomColor)}</div>
          </section>

          {/* Right Column: Chess.com-style Dark Sidebar */}
          <AnalysisSidebar
            phase={phase}
            turn={activeTurn}
            isAnalyzing={isAnalyzing}
            gameOverMessage={gameOverMessage}
            activeSuggestion={activeSuggestion}
            topLines={analysis?.topLines ?? []}
            history={history}
            viewPly={viewPly}
            currentFen={activeFen}
            fenError={fenError}
            muted={muted}
            onJumpToPly={(ply) => setViewPly(ply)}
            onFlipBoard={() => setFlipped((f) => !f)}
            onUndoMove={handleUndoMove}
            onResetGame={handleResetGame}
            onToggleMute={() => setMuted((m) => !m)}
            onPlayCandidate={(cand) => {
              playMove(
                cand.from as Square,
                cand.to as Square,
                cand.promotion as 'q' | 'r' | 'b' | 'n' | undefined
              );
            }}
            onLoadFen={handleLoadFen}
          />
        </div>
      </main>
    </div>
  );
}
