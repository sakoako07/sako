import { useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { QUALITY_META } from '../engine/classification';
import type {
  BoardArrow,
  Color,
  MoveQuality,
  ThreatMarker,
} from '../engine/types';
import { ChessPiece, type PieceType } from './ChessPiece';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

interface ChessBoardProps {
  fen: string;
  flipped: boolean;
  interactive: boolean;
  lastMove?: { from: string; to: string } | null;
  lastMoveQuality?: MoveQuality | null;
  arrows: BoardArrow[];
  threatMarkers?: ThreatMarker[];
  showThreatMarkers?: boolean;
  onMove: (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n') => boolean;
}

function getSquareCoords(square: string, flipped: boolean): { col: number; row: number } {
  const fileIdx = square.charCodeAt(0) - 97;
  const rankIdx = parseInt(square[1], 10) - 1;
  return {
    col: flipped ? 7 - fileIdx : fileIdx,
    row: flipped ? rankIdx : 7 - rankIdx,
  };
}

export function ChessBoard({
  fen,
  flipped,
  interactive,
  lastMove,
  lastMoveQuality,
  arrows,
  threatMarkers = [],
  showThreatMarkers = false,
  onMove,
}: ChessBoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [dragState, setDragState] = useState<{
    from: Square;
    piece: { type: PieceType; color: Color };
    x: number;
    y: number;
    active: boolean;
  } | null>(null);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const boardMatrix = useMemo(() => chess.board(), [chess]);
  const turn = chess.turn();
  const inCheck = chess.inCheck();

  const legalTargets = useMemo(() => {
    const map = new Map<Square, { isCapture: boolean; isPromotion: boolean }>();
    if (!selectedSquare || !interactive) return map;
    const moves = chess.moves({ square: selectedSquare, verbose: true });
    for (const m of moves) {
      map.set(m.to, {
        isCapture: Boolean(m.captured),
        isPromotion: Boolean(m.promotion),
      });
    }
    return map;
  }, [chess, selectedSquare, interactive]);

  // Reset selection when FEN changes externally
  const prevFenRef = useRef(fen);
  if (prevFenRef.current !== fen) {
    prevFenRef.current = fen;
    if (selectedSquare !== null) {
      setSelectedSquare(null);
    }
    if (pendingPromotion !== null) {
      setPendingPromotion(null);
    }
  }

  const attemptMove = (from: Square, to: Square) => {
    const moves = chess.moves({ square: from, verbose: true });
    const matching = moves.filter((m) => m.to === to);
    if (matching.length === 0) return false;

    if (matching.some((m) => m.promotion)) {
      const piece = chess.get(from);
      if (piece) {
        setPendingPromotion({ from, to, color: piece.color });
        setSelectedSquare(null);
        return true;
      }
    }

    const ok = onMove(from, to);
    setSelectedSquare(null);
    return ok;
  };

  const handleSquareClick = (sq: Square) => {
    if (!interactive) return;
    if (pendingPromotion) {
      setPendingPromotion(null);
      return;
    }

    if (selectedSquare && selectedSquare === sq) {
      setSelectedSquare(null);
      return;
    }

    if (selectedSquare && legalTargets.has(sq)) {
      attemptMove(selectedSquare, sq);
      return;
    }

    const piece = chess.get(sq);
    if (piece && piece.color === turn) {
      setSelectedSquare(sq);
    } else {
      setSelectedSquare(null);
    }
  };

  const squareFromClientPoint = (clientX: number, clientY: number): Square | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const visualCol = Math.min(7, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 8)));
    const visualRow = Math.min(7, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * 8)));
    const fileIdx = flipped ? 7 - visualCol : visualCol;
    const rankNum = flipped ? visualRow + 1 : 8 - visualRow;
    return `${FILES[fileIdx]}${rankNum}` as Square;
  };

  const handlePointerDown = (sq: Square, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!interactive || e.button !== 0) return;
    const piece = chess.get(sq);
    if (!piece || piece.color !== turn) return;

    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setDragState({
      from: sq,
      piece: { type: piece.type as PieceType, color: piece.color },
      x: e.clientX,
      y: e.clientY,
      active: false,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || !dragStartPos.current) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    const movedEnough = dragState.active || Math.hypot(dx, dy) > 6;
    if (movedEnough) {
      if (!dragState.active) {
        setSelectedSquare(dragState.from);
      }
      setDragState({
        ...dragState,
        x: e.clientX,
        y: e.clientY,
        active: true,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    const wasDragging = dragState.active;
    const from = dragState.from;
    setDragState(null);
    dragStartPos.current = null;

    if (wasDragging) {
      const targetSq = squareFromClientPoint(e.clientX, e.clientY);
      if (targetSq && targetSq !== from) {
        attemptMove(from, targetSq);
      }
    }
  };

  const threatBySquare = useMemo(() => {
    const map = new Map<string, ThreatMarker>();
    for (const t of threatMarkers) {
      map.set(t.square, t);
    }
    return map;
  }, [threatMarkers]);

  const squares = useMemo(() => {
    const items: Array<{
      sq: Square;
      isLight: boolean;
      piece: { type: PieceType; color: Color } | null;
      visualRow: number;
      visualCol: number;
      fileLabel: string | null;
      rankLabel: string | null;
    }> = [];

    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const boardRow = flipped ? 7 - vr : vr;
        const boardCol = flipped ? 7 - vc : vc;
        const fileChar = FILES[boardCol];
        const rankNum = 8 - boardRow;
        const sq = `${fileChar}${rankNum}` as Square;
        const isLight = (boardRow + boardCol) % 2 === 0;
        const rawPiece = boardMatrix[boardRow][boardCol];
        items.push({
          sq,
          isLight,
          piece: rawPiece
            ? { type: rawPiece.type as PieceType, color: rawPiece.color }
            : null,
          visualRow: vr,
          visualCol: vc,
          fileLabel: vr === 7 ? fileChar : null,
          rankLabel: vc === 0 ? String(rankNum) : null,
        });
      }
    }
    return items;
  }, [boardMatrix, flipped]);

  const lastBadgeMeta = lastMoveQuality ? QUALITY_META[lastMoveQuality] : null;

  return (
    <div
      ref={boardRef}
      className="relative aspect-square w-full select-none rounded-[4px] overflow-hidden shadow-[0_12px_36px_rgba(0,0,0,0.48)] border border-[#32302c]"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDragState(null);
        dragStartPos.current = null;
      }}
      data-testid="chess-board"
    >
      {/* 8x8 Square Grid */}
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {squares.map(({ sq, isLight, piece, fileLabel, rankLabel }) => {
          const isSelected = selectedSquare === sq;
          const isLastFrom = lastMove?.from === sq;
          const isLastTo = lastMove?.to === sq;
          const targetInfo = legalTargets.get(sq);
          const isKingInCheck =
            inCheck && piece?.type === 'k' && piece?.color === turn;
          const threat = showThreatMarkers ? threatBySquare.get(sq) : undefined;
          const isBeingDragged = dragState?.active && dragState.from === sq;

          let bg = isLight ? '#eeeed2' : '#769656';
          if (isSelected) {
            bg = isLight ? '#f5f682' : '#bbcb2b';
          } else if (isLastFrom || isLastTo) {
            bg = isLight ? '#f5f682' : '#b9ca43';
          }

          const coordColor = isLight ? '#769656' : '#eeeed2';
          const pieceAria = piece
            ? `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[piece.type]}`
            : 'empty';
          const legalAria = targetInfo ? ', legal move' : '';

          return (
            <button
              key={sq}
              type="button"
              data-square={sq}
              aria-label={`Square ${sq}, ${pieceAria}${legalAria}`}
              onClick={() => handleSquareClick(sq)}
              onPointerDown={(e) => handlePointerDown(sq, e)}
              style={{ backgroundColor: bg }}
              className="relative flex items-center justify-center p-0 m-0 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#26c6da] cursor-pointer"
            >
              {/* King in check radial alert */}
              {isKingInCheck && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(235,55,45,0.88) 0%, rgba(235,55,45,0.38) 52%, rgba(235,55,45,0) 76%)',
                  }}
                />
              )}

              {/* Threat / Hanging piece marker in Neutral mode */}
              {threat && threat.severity === 'hanging' && (
                <div
                  className="absolute inset-[5%] rounded-full border-[2.5px] border-dashed border-[#fa412d]/85 pointer-events-none"
                  title="Undefended piece under attack"
                />
              )}
              {threat && threat.severity === 'attacked' && (
                <div
                  className="absolute inset-[6%] rounded-full border-2 border-[#f7c631]/75 pointer-events-none"
                  title="Major piece under attack"
                />
              )}

              {/* Rank & File edge coordinates (Chess.com style) */}
              {rankLabel && (
                <span
                  style={{ color: coordColor }}
                  className="absolute top-[3px] left-[4px] text-[10px] sm:text-[11px] font-bold leading-none pointer-events-none"
                >
                  {rankLabel}
                </span>
              )}
              {fileLabel && (
                <span
                  style={{ color: coordColor }}
                  className="absolute bottom-[2px] right-[4px] text-[10px] sm:text-[11px] font-bold leading-none pointer-events-none"
                >
                  {fileLabel}
                </span>
              )}

              {/* Chess Piece SVG */}
              {piece && !isBeingDragged && (
                <ChessPiece type={piece.type} color={piece.color} />
              )}

              {/* Legal move affordance */}
              {targetInfo && !targetInfo.isCapture && (
                <span
                  className="absolute w-[28%] h-[28%] rounded-full bg-black/18 pointer-events-none"
                  aria-hidden="true"
                />
              )}
              {targetInfo && targetInfo.isCapture && (
                <span
                  className="absolute inset-[6%] rounded-full border-[4px] sm:border-[5px] border-black/20 pointer-events-none"
                  aria-hidden="true"
                />
              )}

              {/* Real-time Destination Square Move Classification Badge */}
              {isLastTo && lastBadgeMeta && (
                <div
                  data-testid="last-move-badge"
                  title={`${lastBadgeMeta.label}: ${lastBadgeMeta.description}`}
                  style={{
                    backgroundColor: lastBadgeMeta.badgeBg,
                    color: lastBadgeMeta.badgeText,
                  }}
                  className="absolute top-[3px] right-[3px] z-20 w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] rounded-full flex items-center justify-center text-[11px] sm:text-[12px] font-extrabold leading-none shadow-[0_2px_6px_rgba(0,0,0,0.45)] ring-2 ring-[#1e1d1a]/80 pointer-events-none"
                >
                  {lastBadgeMeta.symbol}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Dynamic SVG Arrow Overlay */}
      <svg
        viewBox="0 0 800 800"
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        aria-hidden="true"
        data-testid="board-arrows-svg"
      >
        <defs>
          {arrows.map((arrow) => (
            <marker
              key={`head-${arrow.id}`}
              id={`arrowhead-${arrow.id}`}
              markerWidth="4.2"
              markerHeight="4.2"
              refX="2.3"
              refY="2.1"
              orient="auto"
            >
              <polygon
                points="0 0, 4.2 2.1, 0 4.2"
                fill={arrow.color}
              />
            </marker>
          ))}
        </defs>

        {arrows.map((arrow) => {
          const fromC = getSquareCoords(arrow.from, flipped);
          const toC = getSquareCoords(arrow.to, flipped);
          const x1 = fromC.col * 100 + 50;
          const y1 = fromC.row * 100 + 50;
          const x2 = toC.col * 100 + 50;
          const y2 = toC.row * 100 + 50;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;

          const startOffset = 18;
          const endOffset = 22;
          const sx = x1 + ux * startOffset;
          const sy = y1 + uy * startOffset;
          const ex = x2 - ux * endOffset;
          const ey = y2 - uy * endOffset;

          const strokeWidth = 14 * (arrow.widthScale ?? 1);
          const opacity = arrow.opacity ?? 0.86;

          return (
            <g key={arrow.id} opacity={opacity}>
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke={arrow.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={arrow.isThreat ? '16 12' : undefined}
                markerEnd={`url(#arrowhead-${arrow.id})`}
              />
            </g>
          );
        })}
      </svg>

      {/* Suggested Arrow Classification Badges on Destination Squares */}
      {arrows.map((arrow) => {
        if (!arrow.badgeSymbol) return null;
        const toC = getSquareCoords(arrow.to, flipped);
        const meta = QUALITY_META[arrow.quality];
        // Avoid colliding with lastMoveBadge on top-right; put arrow suggestion badge on bottom-left or top-left
        const badgePosClass =
          arrow.rank && arrow.rank > 1
            ? 'bottom-[3px] left-[3px]'
            : 'top-[3px] left-[3px]';

        return (
          <div
            key={`tip-${arrow.id}`}
            data-testid={`arrow-badge-${arrow.id}`}
            style={{
              left: `${toC.col * 12.5}%`,
              top: `${toC.row * 12.5}%`,
              width: '12.5%',
              height: '12.5%',
            }}
            className="absolute pointer-events-none z-20"
          >
            <div
              style={{
                backgroundColor: arrow.isThreat ? '#ee6c38' : meta.badgeBg,
                color: arrow.isThreat ? '#ffffff' : meta.badgeText,
              }}
              className={`absolute ${badgePosClass} min-w-[20px] h-[20px] px-1 rounded-full flex items-center justify-center gap-0.5 text-[10px] font-extrabold leading-none shadow-[0_2px_6px_rgba(0,0,0,0.5)] ring-1 ring-[#1b1a17]`}
            >
              {arrow.rank ? <span>#{arrow.rank}</span> : null}
              <span>{arrow.badgeSymbol}</span>
            </div>
          </div>
        );
      })}

      {/* Floating Dragged Piece */}
      {dragState?.active && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-1/2 w-14 h-14 sm:w-16 sm:h-16"
          style={{ left: dragState.x, top: dragState.y }}
        >
          <ChessPiece type={dragState.piece.type} color={dragState.piece.color} className="w-full h-full" />
        </div>
      )}

      {/* Pawn Promotion Overlay Modal */}
      {pendingPromotion && (
        <div
          className="absolute inset-0 z-30 bg-black/55 flex items-center justify-center p-4"
          role="dialog"
          aria-label="Choose promotion piece"
        >
          <div className="bg-[#262522] border border-[#3d3b37] rounded-lg p-3 shadow-2xl">
            <p className="text-xs font-semibold text-[#c5c2bb] mb-2 text-center">
              Promote pawn to
            </p>
            <div className="flex items-center gap-2">
              {(['q', 'r', 'b', 'n'] as const).map((promo) => (
                <button
                  key={promo}
                  type="button"
                  aria-label={`Promote to ${PIECE_NAMES[promo]}`}
                  onClick={() => {
                    onMove(pendingPromotion.from, pendingPromotion.to, promo);
                    setPendingPromotion(null);
                  }}
                  className="w-14 h-14 rounded-md bg-[#33312d] hover:bg-[#45423c] border border-[#4a4741] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <ChessPiece
                    type={promo}
                    color={pendingPromotion.color}
                    className="w-11 h-11"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
