import type { HealthStatus, SyncPayload } from '../types';
import { normalizePayload } from '../../shared/syncMerge.js';

/**
 * Derive a deterministic 64-char SHA-256 sync key from spaceName + passphrase.
 * The raw passphrase never leaves the browser.
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

  throw new Error('当前浏览器环境不支持 Web Crypto API (SHA-256)，请使用 HTTPS 或 localhost 访问。');
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
    };
  } catch {
    return { ok: false, platform: 'static-only', kvReady: false };
  }
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
