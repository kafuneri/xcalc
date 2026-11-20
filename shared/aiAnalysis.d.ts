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
