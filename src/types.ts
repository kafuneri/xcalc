export type InputMode = 'wrong' | 'correct';
export type ExamCategory = 'xingce' | 'zhice';

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
  category?: ExamCategory;
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
  /** User-editable exam/save date in YYYY-MM-DD format */
  examDate?: string;
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

export interface PublicServerSlot {
  value: string;
  index: number;
  model: string;
  label: string;
  firstTokenMs: number;
}

export interface HealthStatus {
  ok: boolean;
  platform: 'edgeone' | 'local-mock' | 'static-only';
  kvReady: boolean;
  kvBindingName?: string;
  aiReady?: boolean;
  aiSlots?: PublicServerSlot[];
}

export type ModuleTierStatus = 'strength' | 'weakness' | 'volatile' | 'normal';

export interface ModuleAnalytics {
  moduleName: string;
  isSubModule: boolean;
  parentName?: string;
  sampleCount: number;
  totalQuestions: number;
  totalCorrect: number;
  avgAccuracy: number;
  avgScore: number;
  avgMaxScore: number;
  avgLostScore: number;
  minAccuracy: number;
  maxAccuracy: number;
  stdDevAccuracy: number;
  latestAccuracy: number;
  trendDelta: number | null;
  controllabilityWeight: number;
  targetAccuracy: number;
  recoverableScore: number;
  priorityScore: number;
  isVolatile: boolean;
  status: ModuleTierStatus;
  ruleAdvice: string;
}

export interface AnalysisReport {
  recordCount: number;
  avgScore: number;
  bestScore: number;
  latestScore: number;
  avgAccuracy: number;
  recentScoreDelta: number | null;
  leafModules: ModuleAnalytics[];
  parentModules: ModuleAnalytics[];
  strengths: ModuleAnalytics[];
  priorities: ModuleAnalytics[];
}

export type AiProviderMode = 'server' | 'gemini-byok' | 'openai-byok';

export type ServerModelChoice =
  | 'auto'
  | `slot:${number}`
  | 'nvidia:nemotron-3.5-super-vl-120b-a12b'
  | 'nvidia:minimaxai/minimax-m3.1-flash'
  | 'nvidia:nvidia/nemotron-3-ultra-550b-a55b'
  | 'zhipu:glm-4.7-flash'
  | 'cf:@cf/google/gemma-4-26b-a4b-it'
  | 'makers:auto'
  | 'makers:google/gemini-4-hydrogen'
  | 'makers:google/gemini-3.8-flash'
  | 'makers:google/gemini-3.6-flash'
  | 'makers:google/gemini-3.5-flash-lite';

export interface AiAnalysisConfig {
  mode: AiProviderMode;
  serverModel: ServerModelChoice;
  geminiKey: string;
  geminiBaseUrl: string;
  geminiModel: string;
  openaiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
}

export interface AiAnalysisResult {
  fingerprint: string;
  provider: string;
  model: string;
  content: string;
  createdAt: number;
}
