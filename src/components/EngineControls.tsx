import { QUALITY_FILTER_OPTIONS } from '../engine/classification';
import type {
  EnginePhase,
  PerspectiveMode,
  QualityFilter,
} from '../engine/types';

interface EngineControlsProps {
  phase: EnginePhase;
  perspective: PerspectiveMode;
  qualityFilter: QualityFilter;
  autoReply: boolean;
  onPhaseChange: (phase: EnginePhase) => void;
  onPerspectiveChange: (perspective: PerspectiveMode) => void;
  onQualityFilterChange: (filter: QualityFilter) => void;
  onAutoReplyChange: (enabled: boolean) => void;
}

const PHASE_OPTIONS: Array<{ id: EnginePhase; label: string; shortLabel: string }> = [
  { id: 'human', label: 'Phase 1: Natural Human', shortLabel: 'Natural Human' },
  { id: 'god', label: 'Phase 2: 3500 ELO God', shortLabel: '3500 God' },
  { id: 'sandbox', label: 'Phase 3: Sandbox & Review', shortLabel: 'Sandbox' },
];

const PERSPECTIVE_OPTIONS: Array<{ id: PerspectiveMode; label: string }> = [
  { id: 'white', label: 'Assist White' },
  { id: 'black', label: 'Assist Black' },
  { id: 'neutral', label: 'Neutral (Both)' },
];

export function EngineControls({
  phase,
  perspective,
  qualityFilter,
  autoReply,
  onPhaseChange,
  onPerspectiveChange,
  onQualityFilterChange,
  onAutoReplyChange,
}: EngineControlsProps) {
  return (
    <div className="w-full space-y-2">
      {/* Primary Mode & Perspective Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#262522] border border-[#383631] rounded-lg p-1.5">
        {/* 3 Engine Phases */}
        <div
          className="flex items-center gap-1 flex-wrap"
          role="tablist"
          aria-label="Engine behavior phase"
        >
          {PHASE_OPTIONS.map((opt) => {
            const active = phase === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`phase-${opt.id}`}
                onClick={() => onPhaseChange(opt.id)}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-[13px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#81b64c] text-[#141412] shadow-sm'
                    : 'text-[#c5c2bb] hover:text-white hover:bg-[#33312d]'
                }`}
              >
                <span className="hidden md:inline">{opt.label}</span>
                <span className="md:hidden">{opt.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Perspective & Auto-Reply Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center gap-1 bg-[#1e1d1a] p-0.5 rounded-md border border-[#35332f]"
            role="group"
            aria-label="Board perspective and assist side"
          >
            {PERSPECTIVE_OPTIONS.map((opt) => {
              const active = perspective === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`perspective-${opt.id}`}
                  onClick={() => onPerspectiveChange(opt.id)}
                  className={`px-2.5 py-1 rounded-[5px] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#3d3b36] text-white'
                      : 'text-[#a3a098] hover:text-[#e5e3dc]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {phase !== 'sandbox' && perspective !== 'neutral' && (
            <button
              type="button"
              aria-pressed={autoReply}
              data-testid="toggle-auto-reply"
              onClick={() => onAutoReplyChange(!autoReply)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                autoReply
                  ? 'bg-[#33312d] border-[#81b64c]/60 text-[#b4df82]'
                  : 'bg-[#1e1d1a] border-[#383631] text-[#a3a098] hover:text-white'
              }`}
            >
              {autoReply ? 'VS AI: On' : 'VS AI: Off'}
            </button>
          )}
        </div>
      </div>

      {/* Phase 1 Interactive Move Quality Forcer Bar */}
      {phase === 'human' && (
        <div
          className="flex flex-wrap items-center gap-1.5 bg-[#262522] border border-[#383631] rounded-lg px-2.5 py-2"
          role="group"
          aria-label="Phase 1 move quality forcer"
          data-testid="quality-forcer-bar"
        >
          <span className="text-xs font-semibold text-[#a3a098] mr-1 whitespace-nowrap shrink-0">
            Force Move Quality
          </span>
          {QUALITY_FILTER_OPTIONS.map((opt) => {
            const active = qualityFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                data-testid={`quality-btn-${opt.id}`}
                onClick={() => onQualityFilterChange(opt.id)}
                style={
                  active
                    ? {
                        backgroundColor: opt.accentColor,
                        color: opt.id === 'brilliant' || opt.id === 'auto' || opt.id === 'best' || opt.id === 'good'
                          ? '#141412'
                          : '#ffffff',
                      }
                    : undefined
                }
                className={`px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                  active
                    ? 'shadow-sm'
                    : 'bg-[#1e1d1a] text-[#d6d3cc] hover:bg-[#33312d] border border-[#35332f]'
                }`}
              >
                <span>{opt.label}</span>
                {opt.symbol && (
                  <span className="font-mono-tabular opacity-90">{opt.symbol}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
