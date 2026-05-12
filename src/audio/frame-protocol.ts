export interface AnalysisTarget {
  id: string;
  hz: number;
}

export interface AnalysisFrame {
  hz: number;
  rawHz?: number;
  clarity: number;
  rmsDb: number;
  shortRmsDb: number;
  slowRmsDb: number;
  onset: boolean;
  variance: number;
  amplitude: number;
  sampleWindow: 2048 | 4096;
  profileScores: Record<string, number>;
  timestampMs: number;
  // Expanded fields (YIN-era worklet). All optional so callers built against
  // the legacy frame keep working until they opt in.
  f0CandidateHz?: number;
  confidence?: number;
  stringScores?: Record<string, number>;
  candidateStringScores?: Record<string, number>;
  lowConfidence?: boolean;
  stableTail?: boolean;
  transientSuppressed?: boolean;
  debug?: AnalysisFrameDebug;
}

export interface AnalysisFrameDebug {
  yinHz?: number;
  yinConfidence?: number;
  mpmHz?: number;
  mpmClarity?: number;
  cmndAtTau?: number;
  halfRatio?: number;
  doubleRatio?: number;
}

export interface WorkletConfig {
  targets: AnalysisTarget[];
  onsetThresholdDb: number;
  onsetDebounceMs: number;
}
