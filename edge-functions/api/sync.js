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
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
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

export async function onRequestPost(context) {
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

  const oldKvKey = parseSyncKey(context.request);
  if (!oldKvKey) {
    return jsonResponse(
      { error: 'INVALID_SYNC_KEY', message: '缺少或无效的原同步凭证 (X-Sync-Key)。' },
      400
    );
  }

  let body;
  try {
    body = JSON.parse(await context.request.text());
  } catch {
    return jsonResponse({ error: 'INVALID_JSON', message: '请求体不是有效 JSON' }, 400);
  }

  const rawNewKey = String(body?.newSyncKey || '').trim().toLowerCase();
  if (!SYNC_KEY_RE.test(rawNewKey)) {
    return jsonResponse(
      { error: 'INVALID_NEW_SYNC_KEY', message: '缺少或无效的新同步凭证 (newSyncKey)。' },
      400
    );
  }
  const newKvKey = `u:${rawNewKey}`;
  if (oldKvKey === newKvKey) {
    return jsonResponse(
      { error: 'SAME_SYNC_KEY', message: '新口令与原口令相同，无需迁移。' },
      400
    );
  }

  try {
    const oldData = await readKvJson(kv, oldKvKey);
    if (!oldData) {
      return jsonResponse(
        {
          error: 'SYNC_SOURCE_NOT_FOUND',
          message: '未找到原口令对应的云端数据，请确认空间名与原口令正确并先完成一次同步。',
        },
        404
      );
    }

    const existingTarget = await readKvJson(kv, newKvKey);
    if (existingTarget) {
      return jsonResponse(
        {
          error: 'SYNC_TARGET_EXISTS',
          message: '新口令对应的云端空间已存在数据，为防止误覆盖，请更换其他新口令。',
        },
        409
      );
    }

    const normalized = normalizePayload(oldData);
    await kv.put(newKvKey, JSON.stringify(normalized));
    if (typeof kv.delete === 'function') {
      await kv.delete(oldKvKey);
    } else {
      await kv.put(oldKvKey, '');
    }

    return jsonResponse({ ok: true, migrated: true });
  } catch (err) {
    return jsonResponse(
      { error: 'KV_MIGRATE_FAILED', message: err?.message || '迁移云端同步口令失败' },
      500
    );
  }
}
