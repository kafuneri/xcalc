import { mergeSyncPayloads, normalizePayload } from '../../shared/syncMerge.js';

const SYNC_KEY_RE = /^[a-f0-9]{64}$/i;
const MAX_PAYLOAD_BYTES = 950 * 1024; // Stay safely under KV 1MB single-value limit

function resolveKv(context) {
  try {
    if (typeof XC_KV !== 'undefined' && XC_KV) return XC_KV;
  } catch {
    // ignore ReferenceError when unbound
  }
  return context?.env?.XC_KV ?? globalThis.XC_KV ?? null;
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

function parseSyncKey(request) {
  const raw = (request.headers.get('x-sync-key') || '').trim().toLowerCase();
  if (!SYNC_KEY_RE.test(raw)) {
    return null;
  }
  return `u:${raw}`;
}

async function readKvJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  if (typeof raw === 'string') {
    return JSON.parse(raw);
  }
  return raw;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
    },
  });
}

export async function onRequestGet(context) {
  const kv = resolveKv(context);
  if (!kv) {
    return jsonResponse(
      {
        error: 'KV_NOT_BOUND',
        message: 'EdgeOne KV 命名空间 (XC_KV) 尚未绑定，请先在控制台绑定 KV 并命名为 XC_KV。',
      },
      503
    );
  }

  const kvKey = parseSyncKey(context.request);
  if (!kvKey) {
    return jsonResponse(
      { error: 'INVALID_SYNC_KEY', message: '缺少或无效的同步凭证 (X-Sync-Key)。' },
      400
    );
  }

  try {
    const existing = await readKvJson(kv, kvKey);
    return jsonResponse({
      ok: true,
      exists: Boolean(existing),
      payload: normalizePayload(existing),
    });
  } catch (err) {
    return jsonResponse(
      { error: 'KV_READ_FAILED', message: err?.message || '读取云端 KV 失败' },
      500
    );
  }
}

export async function onRequestPut(context) {
  const kv = resolveKv(context);
  if (!kv) {
    return jsonResponse(
      {
        error: 'KV_NOT_BOUND',
        message: 'EdgeOne KV 命名空间 (XC_KV) 尚未绑定，请先在控制台绑定 KV 并命名为 XC_KV。',
      },
      503
    );
  }

  const kvKey = parseSyncKey(context.request);
  if (!kvKey) {
    return jsonResponse(
      { error: 'INVALID_SYNC_KEY', message: '缺少或无效的同步凭证 (X-Sync-Key)。' },
      400
    );
  }

  let bodyText = '';
  try {
    bodyText = await context.request.text();
  } catch {
    return jsonResponse({ error: 'INVALID_BODY', message: '无法读取请求体' }, 400);
  }

  if (new TextEncoder().encode(bodyText).length > MAX_PAYLOAD_BYTES) {
    return jsonResponse(
      { error: 'PAYLOAD_TOO_LARGE', message: '同步数据超过单键上限 (950 KB)' },
      413
    );
  }

  let incoming;
  try {
    incoming = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: 'INVALID_JSON', message: '请求体不是有效 JSON' }, 400);
  }

  try {
    const existing = await readKvJson(kv, kvKey);
    const merged = mergeSyncPayloads(incoming, existing);
    const serialized = JSON.stringify(merged);

    if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
      return jsonResponse(
        { error: 'PAYLOAD_TOO_LARGE', message: '合并后的数据超过单键上限 (950 KB)' },
        413
      );
    }

    await kv.put(kvKey, serialized);
    return jsonResponse({
      ok: true,
      payload: merged,
    });
  } catch (err) {
    return jsonResponse(
      { error: 'KV_WRITE_FAILED', message: err?.message || '写入云端 KV 失败' },
      500
    );
  }
}
