import { runAiAnalysis, runAiAnalysisStream } from '../../shared/aiAnalysis.js';

const DAILY_SERVER_QUOTA = 8;

function resolveKv(context) {
  try {
    if (typeof XC_KV !== 'undefined' && XC_KV) return XC_KV;
  } catch {
    // ignore
  }
  return context?.env?.XC_KV ?? globalThis.XC_KV ?? null;
}

function resolveEnvVar(context, name) {
  const fromContext = context?.env?.[name];
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }
  try {
    const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : '';
    if (typeof fromProcess === 'string' && fromProcess.trim()) {
      return fromProcess.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

function getTodayUtc8() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function getClientRateId(request) {
  const syncKey = (request.headers.get('x-sync-key') || '').trim().toLowerCase();
  if (/^[a-f0-9]{64}$/i.test(syncKey)) {
    return `sk_${syncKey.slice(0, 16)}`;
  }
  const ip =
    request.headers.get('eo-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anon';
  return `ip_${ip.replace(/[^a-zA-Z0-9._:-]/g, '_')}`;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-Sync-Key, X-Ai-Mode, X-Ai-Key, X-Ai-Base-Url, X-Ai-Model',
    },
  });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON', message: '请求体必须是有效 JSON' }, 400);
  }

  const digest = body?.digest;
  if (!digest || typeof digest !== 'object') {
    return jsonResponse({ error: 'INVALID_DIGEST', message: '缺少统计摘要数据' }, 400);
  }

  const mode = (context.request.headers.get('x-ai-mode') || 'server').trim();
  const byok =
    mode === 'gemini-byok' || mode === 'openai-byok'
      ? {
          mode,
          apiKey: (context.request.headers.get('x-ai-key') || '').trim(),
          baseUrl: (context.request.headers.get('x-ai-base-url') || '').trim(),
          model: (context.request.headers.get('x-ai-model') || '').trim(),
        }
      : { mode: 'server' };

  // Enforce per-user daily quota when consuming server-hosted keys
  const kv = resolveKv(context);
  let rateKey = '';
  let nextCount = 0;

  if (byok.mode === 'server' && kv) {
    const clientId = getClientRateId(context.request);
    rateKey = `rl:${clientId}:${getTodayUtc8()}`;
    try {
      const currentRaw = await kv.get(rateKey);
      const current = Number(currentRaw) || 0;
      if (current >= DAILY_SERVER_QUOTA) {
        return jsonResponse(
          {
            error: 'RATE_LIMIT_EXCEEDED',
            message: `今日服务端 AI 分析额度已达上限（${DAILY_SERVER_QUOTA} 次/天），可切换为自定义 API Key 继续使用。`,
          },
          429
        );
      }
      nextCount = current + 1;
    } catch {
      // Do not fail hard if KV rate-limit check glitches
    }
  }

  const serverModel = typeof body?.serverModel === 'string' ? body.serverModel : 'auto';
  const serverEnv = {
    ...(typeof process !== 'undefined' && process.env ? process.env : {}),
    ...(context?.env || {}),
  };

  if (body?.stream === true) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const sendEvent = (obj) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          const result = await runAiAnalysisStream({
            digest,
            serverModel,
            byok,
            serverEnv,
            onStatus: (message) => sendEvent({ type: 'status', message }),
            onMeta: (meta) => sendEvent({ type: 'meta', ...meta }),
            onDelta: (text) => sendEvent({ type: 'delta', text }),
          });

          if (rateKey && nextCount > 0 && kv) {
            await kv.put(rateKey, String(nextCount)).catch(() => {});
          }

          sendEvent({ type: 'done', ...result });
        } catch (err) {
          sendEvent({
            type: 'error',
            status: Number(err?.status) || 502,
            message: err?.message || 'AI 分析请求失败，请稍后重试',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=UTF-8',
        'Cache-Control': 'no-store, no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  try {
    const result = await runAiAnalysis({
      digest,
      serverModel,
      byok,
      serverEnv,
    });

    if (rateKey && nextCount > 0 && kv) {
      await kv.put(rateKey, String(nextCount)).catch(() => {});
    }

    return jsonResponse({
      ok: true,
      ...result,
    });
  } catch (err) {
    const status = Number(err?.status) || 502;
    return jsonResponse(
      {
        error: 'AI_ANALYSIS_FAILED',
        message: err?.message || 'AI 分析请求失败，请稍后重试',
      },
      status >= 400 && status < 600 ? status : 502
    );
  }
}
