export interface PublicServerSlot {
  value: string;
  index: number;
  model: string;
  label: string;
  firstTokenMs: number;
}

export function listPublicServerSlots(
  serverEnv?: Record<string, string | undefined>
): PublicServerSlot[];

export function buildAnalysisMessages(digest: Record<string, unknown>): {
  systemPrompt: string;
  userPrompt: string;
};

export function runAiAnalysis(params: {
  digest: Record<string, unknown>;
  serverModel?: string;
  byok?: {
    mode: 'server' | 'gemini-byok' | 'openai-byok';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  serverEnv?: Record<string, string | undefined>;
}): Promise<{
  provider: string;
  model: string;
  content: string;
}>;

export function runAiAnalysisStream(params: {
  digest: Record<string, unknown>;
  serverModel?: string;
  byok?: {
    mode: 'server' | 'gemini-byok' | 'openai-byok';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  serverEnv?: Record<string, string | undefined>;
  onStatus?: (message: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
  onDelta?: (delta: string) => void;
}): Promise<{
  provider: string;
  model: string;
  content: string;
}>;
