import { evalToWinPercent, formatEvalScore } from '../engine/classification';

interface EvaluationBarProps {
  cpWhite: number;
  mateWhite?: number;
  flipped: boolean;
  isAnalyzing?: boolean;
}

export function EvaluationBar({
  cpWhite,
  mateWhite,
  flipped,
}: EvaluationBarProps) {
  const whitePct = evalToWinPercent(cpWhite, mateWhite);
  const label = formatEvalScore(cpWhite, mateWhite);
  const whiteWinning =
    mateWhite !== undefined ? mateWhite > 0 : cpWhite >= 0;

  // When unflipped: White sits at the bottom, Black at the top.
  // When flipped: Black sits at the bottom, White at the top.
  const whiteScale = whitePct / 100;

  return (
    <div
      className="relative w-7 sm:w-8 h-full rounded-[4px] overflow-hidden bg-[#2b2926] border border-[#3d3b37] select-none shrink-0 flex flex-col justify-between"
      role="meter"
      aria-label={`Position evaluation ${label}`}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(whitePct)}
      data-testid="eval-bar"
    >
      {/* White advantage fill layer (compositor-animated via scaleY) */}
      <div
        className="absolute inset-0 bg-[#f2f1ed] transition-transform duration-300 ease-out will-change-transform"
        style={{
          transformOrigin: flipped ? 'top center' : 'bottom center',
          transform: `scaleY(${whiteScale})`,
        }}
      />

      {/* Top edge score (Black when unflipped, White when flipped) */}
      <div className="relative z-10 w-full pt-1.5 flex justify-center">
        {((!flipped && !whiteWinning) || (flipped && whiteWinning)) && (
          <span
            className={`font-mono-tabular text-[10px] sm:text-[11px] font-bold leading-none px-0.5 ${
              flipped ? 'text-[#201f1c]' : 'text-[#f2f1ed]'
            }`}
          >
            {label}
          </span>
        )}
      </div>

      {/* Subtle midpoint tick */}
      <div
        className="relative z-10 w-full h-[1px] bg-[#81b64c]/45 pointer-events-none"
        aria-hidden="true"
      />

      {/* Bottom edge score (White when unflipped, Black when flipped) */}
      <div className="relative z-10 w-full pb-1.5 flex justify-center">
        {((!flipped && whiteWinning) || (flipped && !whiteWinning)) && (
          <span
            className={`font-mono-tabular text-[10px] sm:text-[11px] font-bold leading-none px-0.5 ${
              flipped ? 'text-[#f2f1ed]' : 'text-[#201f1c]'
            }`}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
