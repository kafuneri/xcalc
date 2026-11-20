/**
 * Shared timestamp-based merge logic used by:
 * 1. EdgeOne Edge Functions (edge-functions/api/sync.js)
 * 2. Local Vite dev mock KV middleware (vite.config.ts)
 * 3. Frontend sync client (src/core/sync.ts)
 *
 * Keeping one pure implementation ensures local mock and cloud KV behave identically.
 */

export const SYNC_SCHEMA_VERSION = 1;
const MAX_TOMBSTONES = 300;

/**
 * Merge two item arrays by `id` using last-write-wins (`updatedAt`).
 * Preserves soft-deleted tombstones (`deletedAt`) so deletions propagate across devices.
 */
export function mergeItemLists(localItems = [], remoteItems = []) {
  const byId = new Map();

  for (const item of [...remoteItems, ...localItems]) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const prev = byId.get(item.id);
    const itemTs = Number(item.updatedAt) || 0;
    const prevTs = prev ? Number(prev.updatedAt) || 0 : -1;

    if (!prev || itemTs > prevTs) {
      byId.set(item.id, item);
    } else if (itemTs === prevTs && item.deletedAt && !prev.deletedAt) {
      // Deterministic tie-breaker: deletion wins when timestamps match.
      byId.set(item.id, item);
    }
  }

  const all = Array.from(byId.values());
  const active = all.filter((item) => !item.deletedAt);
  const tombstones = all
    .filter((item) => Boolean(item.deletedAt))
    .sort((a, b) => (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0))
    .slice(0, MAX_TOMBSTONES);

  return [...active, ...tombstones];
}

/**
 * Merge two full sync payloads into a canonical payload object.
 */
export function mergeSyncPayloads(localPayload, remotePayload) {
  const local = normalizePayload(localPayload);
  const remote = normalizePayload(remotePayload);

  const presets = mergeItemLists(local.presets, remote.presets).filter(
    (p) => !p.builtIn
  );
  const records = mergeItemLists(local.records, remote.records);

  const maxUpdated = Math.max(
    local.updatedAt,
    remote.updatedAt,
    ...presets.map((p) => Number(p.updatedAt) || 0),
    ...records.map((r) => Number(r.updatedAt) || 0)
  );

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: maxUpdated || Date.now(),
    presets,
    records,
  };
}

export function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: 0,
      presets: [],
      records: [],
    };
  }
  return {
    schemaVersion: Number(raw.schemaVersion) || SYNC_SCHEMA_VERSION,
    updatedAt: Number(raw.updatedAt) || 0,
    presets: Array.isArray(raw.presets) ? raw.presets : [],
    records: Array.isArray(raw.records) ? raw.records : [],
  };
}
