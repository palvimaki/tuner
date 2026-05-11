export interface AnalysisTarget {
  id: string;
  hz: number;
}

export interface AnalysisFrame {
  hz: number;
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
}

export interface WorkletConfig {
  targets: AnalysisTarget[];
  onsetThresholdDb: number;
  onsetDebounceMs: number;
}
