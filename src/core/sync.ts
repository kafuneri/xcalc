import type {
  AiAnalysisConfig,
  HealthStatus,
  SyncPayload,
} from '../types';
import { normalizePayload } from '../../shared/syncMerge.js';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

/**
 * Pure JS FIPS 180-4 SHA-256 fallback so non-HTTPS LAN URLs work without Web Crypto.
 */
export function sha256HexFallback(bytes: Uint8Array): string {
  const msgLen = bytes.length;
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLen = msgLen * 8;
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Derive a deterministic 64-char SHA-256 sync key from spaceName + passphrase.
 * Prefers Web Crypto when available (HTTPS / localhost), with pure-JS fallback on plain HTTP.
 */
export async function deriveSyncKey(spaceName: string, passphrase: string): Promise<string> {
  const normalized = `${spaceName.trim().toLowerCase()}::xingce-sync-v1::${passphrase}`;
  const bytes = new TextEncoder().encode(normalized);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return sha256HexFallback(bytes);
}

export async function checkCloudHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, platform: 'static-only', kvReady: false };
    }
    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      platform: data.platform === 'local-mock' ? 'local-mock' : 'edgeone',
      kvReady: Boolean(data.kvReady),
      kvBindingName: data.kvBindingName,
      aiReady: Boolean(data.aiReady),
      aiSlots: Array.isArray(data.aiSlots) ? data.aiSlots : [],
    };
  } catch {
    return { ok: false, platform: 'static-only', kvReady: false, aiReady: false };
  }
}

export async function requestAiAnalysis(params: {
  digest: Record<string, unknown>;
  aiConfig: AiAnalysisConfig;
  syncKey?: string;
}): Promise<{
  provider: string;
  model: string;
  content: string;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Ai-Mode': params.aiConfig.mode,
  };

  if (params.syncKey) {
    headers['X-Sync-Key'] = params.syncKey;
  }

  if (params.aiConfig.mode === 'gemini-byok') {
    headers['X-Ai-Key'] = params.aiConfig.geminiKey.trim();
    headers['X-Ai-Base-Url'] = params.aiConfig.geminiBaseUrl.trim();
    headers['X-Ai-Model'] = params.aiConfig.geminiModel.trim();
  } else if (params.aiConfig.mode === 'openai-byok') {
    headers['X-Ai-Key'] = params.aiConfig.openaiKey.trim();
    headers['X-Ai-Base-Url'] = params.aiConfig.openaiBaseUrl.trim();
    headers['X-Ai-Model'] = params.aiConfig.openaiModel.trim();
  }

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      digest: params.digest,
      serverModel: params.aiConfig.serverModel || 'auto',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `AI 分析请求失败 (${res.status})`);
  }

  return {
    provider: String(data.provider || ''),
    model: String(data.model || ''),
    content: String(data.content || ''),
  };
}

export async function requestAiAnalysisStream(params: {
  digest: Record<string, unknown>;
  aiConfig: AiAnalysisConfig;
  syncKey?: string;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
  onDelta?: (delta: string) => void;
}): Promise<{
  provider: string;
  model: string;
  content: string;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Ai-Mode': params.aiConfig.mode,
  };

  if (params.syncKey) {
    headers['X-Sync-Key'] = params.syncKey;
  }

  if (params.aiConfig.mode === 'gemini-byok') {
    headers['X-Ai-Key'] = params.aiConfig.geminiKey.trim();
    headers['X-Ai-Base-Url'] = params.aiConfig.geminiBaseUrl.trim();
    headers['X-Ai-Model'] = params.aiConfig.geminiModel.trim();
  } else if (params.aiConfig.mode === 'openai-byok') {
    headers['X-Ai-Key'] = params.aiConfig.openaiKey.trim();
    headers['X-Ai-Base-Url'] = params.aiConfig.openaiBaseUrl.trim();
    headers['X-Ai-Model'] = params.aiConfig.openaiModel.trim();
  }

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      digest: params.digest,
      serverModel: params.aiConfig.serverModel || 'auto',
      stream: true,
    }),
  });

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `AI 分析请求失败 (${res.status})`);
    }
    if (typeof data.content === 'string' && data.content) {
      params.onMeta?.({
        provider: String(data.provider || ''),
        model: String(data.model || ''),
      });
      params.onDelta?.(data.content);
      return {
        provider: String(data.provider || ''),
        model: String(data.model || ''),
        content: data.content,
      };
    }
    throw new Error('服务端未返回流式数据');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let finalMeta = { provider: '', model: '' };
  let accumulated = '';
  let finishedResult: { provider: string; model: string; content: string } | null = null;

  const handleLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const jsonText = line.slice(5).trim();
    if (!jsonText) return;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return;
    }

    if (evt.type === 'status' && typeof evt.message === 'string') {
      params.onStatus?.(evt.message);
    } else if (evt.type === 'meta') {
      finalMeta = {
        provider: String(evt.provider || ''),
        model: String(evt.model || ''),
      };
      params.onMeta?.(finalMeta);
    } else if (evt.type === 'delta' && typeof evt.text === 'string') {
      accumulated += evt.text;
      params.onDelta?.(evt.text);
    } else if (evt.type === 'error') {
      throw new Error(String(evt.message || 'AI 分析请求失败'));
    } else if (evt.type === 'done') {
      finishedResult = {
        provider: String(evt.provider || finalMeta.provider || ''),
        model: String(evt.model || finalMeta.model || ''),
        content: String(evt.content || accumulated),
      };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line);
      }
    }
    lineBuffer += decoder.decode();
    if (lineBuffer.trim()) {
      handleLine(lineBuffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (finishedResult) {
    return finishedResult;
  }
  if (accumulated.trim()) {
    return {
      provider: finalMeta.provider,
      model: finalMeta.model,
      content: accumulated.trim(),
    };
  }
  throw new Error('AI 流式连接意外中断，未收到有效内容');
}

export async function pullCloudData(syncKey: string): Promise<{
  exists: boolean;
  payload: SyncPayload;
}> {
  const res = await fetch('/api/sync', {
    method: 'GET',
    headers: {
      'X-Sync-Key': syncKey,
    },
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `拉取云端数据失败 (${res.status})`);
  }

  return {
    exists: Boolean(data.exists),
    payload: normalizePayload(data.payload),
  };
}

export async function pushCloudData(
  syncKey: string,
  payload: SyncPayload
): Promise<SyncPayload> {
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Key': syncKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `推送云端数据失败 (${res.status})`);
  }

  return normalizePayload(data.payload);
}

export async function changeSyncPassphrase(params: {
  spaceName: string;
  oldPassphrase: string;
  newPassphrase: string;
}): Promise<void> {
  const oldSyncKey = await deriveSyncKey(params.spaceName, params.oldPassphrase);
  const newSyncKey = await deriveSyncKey(params.spaceName, params.newPassphrase);
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Key': oldSyncKey,
    },
    body: JSON.stringify({ newSyncKey }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `修改同步口令失败 (${res.status})`);
  }
}
