import { evaluateCandidatesSync, detectThreatMarkers } from './fastEvaluator';
import type { CandidateEval, ThreatMarker } from './types';

export interface CandidateWorkerRequest {
  searchId: number;
  fen: string;
  timeBudgetMs: number;
  maxDepth: number;
}

export interface CandidateWorkerResponse {
  searchId: number;
  fen: string;
  candidates: CandidateEval[];
  threatMarkers: ThreatMarker[];
}

self.onmessage = (event: MessageEvent<CandidateWorkerRequest>) => {
  const { searchId, fen, timeBudgetMs, maxDepth } = event.data;
  try {
    const candidates = evaluateCandidatesSync(fen, timeBudgetMs, maxDepth);
    const threatMarkers = detectThreatMarkers(fen);
    const response: CandidateWorkerResponse = {
      searchId,
      fen,
      candidates,
      threatMarkers,
    };
    self.postMessage(response);
  } catch {
    self.postMessage({
      searchId,
      fen,
      candidates: [],
      threatMarkers: [],
    } satisfies CandidateWorkerResponse);
  }
};
