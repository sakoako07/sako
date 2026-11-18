import { useEffect, useRef, useState } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  Play,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatEvalScore, QUALITY_META } from '../engine/classification';
import { CURATED_FENS } from '../engine/fastEvaluator';
import type {
  CandidateEval,
  Color,
  EnginePhase,
  HistoryEntry,
  MoveQuality,
} from '../engine/types';

interface AnalysisSidebarProps {
  phase: EnginePhase;
  turn: Color;
  isAnalyzing: boolean;
  gameOverMessage: string | null;
  activeSuggestion: { candidate: CandidateEval; quality: MoveQuality } | null;
  topLines: CandidateEval[];
  history: HistoryEntry[];
  viewPly: number;
  currentFen: string;
  fenError: string | null;
  muted: boolean;
  onJumpToPly: (ply: number) => void;
  onFlipBoard: () => void;
  onUndoMove: () => void;
  onResetGame: () => void;
  onToggleMute: () => void;
  onPlayCandidate: (candidate: CandidateEval) => void;
  onLoadFen: (fen: string) => void;
}

export function AnalysisSidebar({
  phase,
  turn,
  isAnalyzing,
  gameOverMessage,
  activeSuggestion,
  topLines,
  history,
  viewPly,
  currentFen,
  fenError,
  muted,
  onJumpToPly,
  onFlipBoard,
  onUndoMove,
  onResetGame,
  onToggleMute,
  onPlayCandidate,
  onLoadFen,
}: AnalysisSidebarProps) {
  const [fenInput, setFenInput] = useState(currentFen);
  const [showFenDrawer, setShowFenDrawer] = useState(phase === 'sandbox');
  const activeMoveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setFenInput(currentFen);
  }, [currentFen]);

  useEffect(() => {
    if (phase === 'sandbox') {
      setShowFenDrawer(true);
    }
  }, [phase]);

  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [viewPly, history.length]);

  // Group history into move pairs (White + Black)
  const moveRows: Array<{
    moveNumber: number;
    white?: HistoryEntry;
    black?: HistoryEntry;
  }> = [];

  for (let i = 0; i < history.length; i += 2) {
    moveRows.push({
      moveNumber: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1],
    });
  }

  const suggestionMeta = activeSuggestion
    ? QUALITY_META[activeSuggestion.quality]
    : null;

  return (
    <aside
      className="flex flex-col bg-[#262522] border border-[#383631] rounded-lg overflow-hidden h-full min-h-[520px] lg:max-h-[calc(100vh-140px)]"
      aria-label="Chess analysis panel"
    >
      {/* Active Turn & Suggestion Summary */}
      <div className="px-4 py-3 border-b border-[#35332f] bg-[#21201d] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#b8b5ad]">
            <span
              className={`w-2.5 h-2.5 rounded-sm border border-[#4a4741] shrink-0 ${
                turn === 'w' ? 'bg-[#f4f3ef]' : 'bg-[#1a1917]'
              }`}
              aria-hidden="true"
            />
            <span className="truncate">
              {gameOverMessage
                ? gameOverMessage
                : `${turn === 'w' ? 'White' : 'Black'} to move`}
            </span>
            {isAnalyzing && !gameOverMessage && (
              <span className="text-[#9e9b93] font-normal">· Evaluating</span>
            )}
          </div>

          {activeSuggestion && suggestionMeta && !gameOverMessage && (
            <div className="mt-1 flex items-center gap-2 text-sm font-bold text-white">
              <span
                style={{
                  backgroundColor: suggestionMeta.badgeBg,
                  color: suggestionMeta.badgeText,
                }}
                className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded text-[11px] font-extrabold shrink-0"
              >
                {suggestionMeta.symbol}
              </span>
              <span className="font-mono-tabular truncate">
                {activeSuggestion.candidate.san}
              </span>
              <span className="text-xs font-medium text-[#a3a098]">
                {suggestionMeta.label}
              </span>
              <span className="font-mono-tabular text-xs font-semibold text-[#c5c2bb]">
                {formatEvalScore(
                  activeSuggestion.candidate.cpWhite,
                  activeSuggestion.candidate.mateWhite
                )}
              </span>
            </div>
          )}
        </div>

        {activeSuggestion && !gameOverMessage && (
          <button
            type="button"
            onClick={() => onPlayCandidate(activeSuggestion.candidate)}
            data-testid="play-suggestion-btn"
            className="px-2.5 py-1.5 rounded-md bg-[#383631] hover:bg-[#494640] text-xs font-semibold text-[#f1f0ec] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Play</span>
          </button>
        )}
      </div>

      {/* Phase 3 Multi-PV Top 3 Lines */}
      {(phase === 'sandbox' || topLines.length > 0) && (
        <div
          className="px-4 py-2.5 border-b border-[#35332f] bg-[#242320]"
          data-testid="multipv-panel"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-[#a3a098]">
              {phase === 'sandbox'
                ? 'Top 3 Engine Lines (Multi-PV)'
                : phase === 'god'
                ? '3500 ELO Best Line'
                : 'Engine Candidate Lines'}
            </span>
            <button
              type="button"
              onClick={() => setShowFenDrawer((v) => !v)}
              data-testid="toggle-fen-drawer"
              className="text-xs font-semibold text-[#96bc4b] hover:text-[#b4df82] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showFenDrawer ? 'Hide FEN' : 'Load FEN'}
            </button>
          </div>

          <div className="space-y-1">
            {(phase === 'sandbox' ? topLines.slice(0, 3) : topLines.slice(0, 2)).map(
              (line, idx) => {
                const scoreStr = formatEvalScore(line.cpWhite, line.mateWhite);
                const isWhiteAdv =
                  line.mateWhite !== undefined
                    ? line.mateWhite > 0
                    : line.cpWhite >= 0;

                return (
                  <button
                    key={`${line.uci}-${idx}`}
                    type="button"
                    data-testid={`pv-line-${idx + 1}`}
                    onClick={() => onPlayCandidate(line)}
                    className="w-full text-left px-2 py-1.5 rounded bg-[#1e1d1a] hover:bg-[#312f2b] border border-[#32302c] flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <span className="font-mono-tabular text-[11px] font-bold text-[#9e9b93] w-4 shrink-0">
                      #{idx + 1}
                    </span>
                    <span
                      className={`font-mono-tabular text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        isWhiteAdv
                          ? 'bg-[#eeeed2] text-[#1b1a17]'
                          : 'bg-[#3d3b37] text-[#f1f0ec]'
                      }`}
                    >
                      {scoreStr}
                    </span>
                    <span className="font-mono-tabular text-xs text-[#e3e1da] truncate">
                      {line.pvSan.length > 0 ? line.pvSan.join(' ') : line.san}
                    </span>
                  </button>
                );
              }
            )}

            {topLines.length === 0 && !gameOverMessage && (
              <p className="text-xs text-[#8f8c84] py-1">
                Calculating candidate variations...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Custom FEN Loader & Tactical Presets */}
      {showFenDrawer && (
        <div
          className="px-4 py-2.5 border-b border-[#35332f] bg-[#1f1e1b] space-y-2"
          data-testid="fen-loader-panel"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onLoadFen(fenInput);
            }}
            className="flex items-center gap-1.5"
          >
            <label htmlFor="fen-input" className="sr-only">
              Custom FEN string
            </label>
            <input
              id="fen-input"
              type="text"
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              placeholder="Paste FEN position..."
              data-testid="fen-input"
              className="flex-1 min-w-0 bg-[#2b2926] border border-[#3f3d38] focus:border-[#81b64c] rounded px-2.5 py-1.5 text-xs font-mono-tabular text-[#f1f0ec] placeholder:text-[#7c7972] focus:outline-none"
            />
            <button
              type="submit"
              data-testid="load-fen-btn"
              className="px-3 py-1.5 rounded bg-[#81b64c] hover:bg-[#91c45c] text-[#141412] text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Load
            </button>
          </form>

          {fenError && (
            <p className="text-xs font-medium text-[#fa6352]" role="alert" data-testid="fen-error">
              {fenError}
            </p>
          )}

          <div className="flex items-center gap-1 flex-wrap">
            {CURATED_FENS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.note}
                data-testid={`preset-fen-${preset.id}`}
                onClick={() => {
                  setFenInput(preset.fen);
                  onLoadFen(preset.fen);
                }}
                className="px-2 py-1 rounded bg-[#2b2926] hover:bg-[#3a3833] border border-[#3a3833] text-[11px] font-medium text-[#d4d1c9] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Move History Table */}
      <div
        className="flex-1 overflow-y-auto chess-scroll px-3 py-2"
        data-testid="move-history-list"
      >
        {moveRows.length === 0 ? (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-semibold text-[#c5c2bb]">
              Ready to analyze
            </p>
            <p className="text-xs text-[#8f8c84] mt-1 max-w-[24ch]">
              Move a piece on the board or load a FEN position to inspect real-time engine lines.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {moveRows.map((row) => (
              <div
                key={row.moveNumber}
                className="grid grid-cols-[36px_1fr_1fr] items-center gap-1 text-xs"
              >
                <span className="font-mono-tabular text-[#85827a] font-semibold px-1.5 py-1.5 select-none">
                  {row.moveNumber}.
                </span>

                {[row.white, row.black].map((entry, sideIdx) => {
                  if (!entry) {
                    return <div key={`empty-${row.moveNumber}-${sideIdx}`} />;
                  }
                  const isActive = viewPly === entry.ply;
                  const meta = QUALITY_META[entry.quality];
                  return (
                    <button
                      key={entry.ply}
                      ref={isActive ? activeMoveRef : null}
                      type="button"
                      data-testid={`history-ply-${entry.ply}`}
                      onClick={() => onJumpToPly(entry.ply)}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded text-left font-mono-tabular font-semibold transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#45423c] text-white'
                          : 'text-[#dcd9d0] hover:bg-[#312f2b]'
                      }`}
                    >
                      <span className="truncate">{entry.san}</span>
                      <span
                        title={meta.label}
                        style={{
                          backgroundColor: meta.badgeBg,
                          color: meta.badgeText,
                        }}
                        className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold leading-none shrink-0"
                      >
                        {meta.symbol}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation & Board Action Bar */}
      <div className="px-3 py-2.5 border-t border-[#35332f] bg-[#21201d] flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Go to starting position"
            title="Start position"
            disabled={viewPly === 0}
            onClick={() => onJumpToPly(0)}
            data-testid="nav-start"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <ChevronFirst className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Previous move"
            title="Previous move (Left Arrow)"
            disabled={viewPly === 0}
            onClick={() => onJumpToPly(Math.max(0, viewPly - 1))}
            data-testid="nav-prev"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Next move"
            title="Next move (Right Arrow)"
            disabled={viewPly >= history.length}
            onClick={() => onJumpToPly(Math.min(history.length, viewPly + 1))}
            data-testid="nav-next"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Go to latest move"
            title="Latest move"
            disabled={viewPly >= history.length}
            onClick={() => onJumpToPly(history.length)}
            data-testid="nav-end"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <ChevronLast className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Flip board orientation"
            title="Flip board"
            onClick={onFlipBoard}
            data-testid="btn-flip"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <FlipVertical2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Undo last move"
            title="Undo move"
            disabled={history.length === 0}
            onClick={onUndoMove}
            data-testid="btn-undo"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={muted ? 'Unmute board sounds' : 'Mute board sounds'}
            title={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
            data-testid="btn-mute"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            aria-label="Reset board to starting position"
            title="New game"
            onClick={onResetGame}
            data-testid="btn-reset"
            className="w-8 h-8 rounded bg-[#2d2b28] hover:bg-[#3c3a35] flex items-center justify-center text-[#e2dfd7] cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
