export type InputMode = 'wrong' | 'correct';

export interface ScoreModule {
  id: string;
  name: string;
  /** Number of questions for a leaf module; computed sum when children exist */
  questionCount: number;
  /** Points per question for a leaf module */
  scorePerQuestion: number;
  /** Optional sub-modules (e.g. 判断推理 -> 图形/定义/类比/逻辑) */
  children?: ScoreModule[];
}

export interface Preset {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  modules: ScoreModule[];
  updatedAt: number;
  deletedAt?: number;
}

export interface ModuleResult {
  moduleId: string;
  moduleName: string;
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  score: number;
  maxScore: number;
  accuracy: number;
  children?: ModuleResult[];
}

export interface CalculationResult {
  totalQuestions: number;
  totalCorrect: number;
  totalWrong: number;
  totalScore: number;
  maxScore: number;
  accuracy: number;
  modules: ModuleResult[];
}

export interface HistoryRecord {
  id: string;
  paperName: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  mode: InputMode;
  inputs: Record<string, number>;
  presetSnapshot: Preset;
  result: CalculationResult;
}

export interface SyncPayload {
  schemaVersion: number;
  updatedAt: number;
  presets: Preset[];
  records: HistoryRecord[];
}

export interface SyncProfile {
  enabled: boolean;
  spaceName: string;
  passphrase: string;
  lastSyncedAt?: number;
}

export interface HealthStatus {
  ok: boolean;
  platform: 'edgeone' | 'local-mock' | 'static-only';
  kvReady: boolean;
  kvBindingName?: string;
}
