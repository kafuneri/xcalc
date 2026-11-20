import { BUILTIN_PRESETS } from '../presets/builtin';
import type {
  ExamCategory,
  HistoryRecord,
  Preset,
  SyncPayload,
  SyncProfile,
} from '../types';
import { SYNC_SCHEMA_VERSION, mergeSyncPayloads, normalizePayload } from '../../shared/syncMerge.js';

const KEYS = {
  PRESETS: 'xc_calc_custom_presets_v1',
  RECORDS: 'xc_calc_history_records_v1',
  ACTIVE_PRESET: 'xc_calc_active_preset_id_v1',
  EXAM_CATEGORY: 'xc_calc_exam_category_v1',
  ACTIVE_PRESET_BY_CAT: 'xc_calc_active_presets_by_cat_v1',
  SYNC_PROFILE: 'xc_calc_sync_profile_v1',
  THEME: 'xc_calc_theme_v1',
};

const BUILTIN_ID_SET = new Set(BUILTIN_PRESETS.map((p) => p.id));

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(KEYS.PRESETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((p) => p && !p.builtIn && !BUILTIN_ID_SET.has(p.id))
      : [];
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: Preset[]): void {
  const cleaned = presets.filter((p) => !p.builtIn && !BUILTIN_ID_SET.has(p.id));
  localStorage.setItem(KEYS.PRESETS, JSON.stringify(cleaned));
}

export function getAllAvailablePresets(customPresets: Preset[]): Preset[] {
  const activeCustom = customPresets.filter(
    (p) => !p.deletedAt && !BUILTIN_ID_SET.has(p.id)
  );
  return [...BUILTIN_PRESETS, ...activeCustom];
}

export function loadExamCategory(): ExamCategory {
  const saved = localStorage.getItem(KEYS.EXAM_CATEGORY);
  return saved === 'zhice' ? 'zhice' : 'xingce';
}

export function saveExamCategory(category: ExamCategory): void {
  localStorage.setItem(KEYS.EXAM_CATEGORY, category);
}

export function loadActivePresetMap(): Partial<Record<ExamCategory, string>> {
  try {
    const raw = localStorage.getItem(KEYS.ACTIVE_PRESET_BY_CAT);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Partial<Record<ExamCategory, string>>;
      }
    }
  } catch {
    // ignore
  }
  const legacy = localStorage.getItem(KEYS.ACTIVE_PRESET);
  return legacy ? { xingce: legacy } : {};
}

export function saveActivePresetMap(map: Partial<Record<ExamCategory, string>>): void {
  localStorage.setItem(KEYS.ACTIVE_PRESET_BY_CAT, JSON.stringify(map));
}

export function loadHistoryRecords(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(KEYS.RECORDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryRecords(records: HistoryRecord[]): void {
  localStorage.setItem(KEYS.RECORDS, JSON.stringify(records));
}

export function loadActivePresetId(): string {
  return localStorage.getItem(KEYS.ACTIVE_PRESET) || BUILTIN_PRESETS[0].id;
}

export function saveActivePresetId(id: string): void {
  localStorage.setItem(KEYS.ACTIVE_PRESET, id);
}

export function loadSyncProfile(): SyncProfile {
  try {
    const raw = localStorage.getItem(KEYS.SYNC_PROFILE);
    if (!raw) {
      return { enabled: false, spaceName: '', passphrase: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      spaceName: String(parsed.spaceName || ''),
      passphrase: String(parsed.passphrase || ''),
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return { enabled: false, spaceName: '', passphrase: '' };
  }
}

export function saveSyncProfile(profile: SyncProfile): void {
  localStorage.setItem(KEYS.SYNC_PROFILE, JSON.stringify(profile));
}

export function buildSyncPayload(customPresets: Preset[], records: HistoryRecord[]): SyncPayload {
  const maxTs = Math.max(
    0,
    ...customPresets.map((p) => Number(p.updatedAt) || 0),
    ...records.map((r) => Number(r.updatedAt) || 0)
  );
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: maxTs || Date.now(),
    presets: customPresets.filter((p) => !p.builtIn),
    records,
  };
}

export function exportBackupJson(customPresets: Preset[], records: HistoryRecord[]): string {
  const payload = {
    app: 'xingce-calculator',
    exportedAt: new Date().toISOString(),
    ...buildSyncPayload(
      customPresets.filter((p) => !p.deletedAt),
      records.filter((r) => !r.deletedAt)
    ),
  };
  return JSON.stringify(payload, null, 2);
}

export function importBackupJson(
  jsonText: string,
  currentPresets: Preset[],
  currentRecords: HistoryRecord[]
): SyncPayload {
  const parsed = JSON.parse(jsonText);
  const incoming = normalizePayload(parsed);
  const current = buildSyncPayload(currentPresets, currentRecords);
  return mergeSyncPayloads(incoming, current);
}

export function loadThemePreference(): 'light' | 'dark' {
  const saved = localStorage.getItem(KEYS.THEME);
  if (saved === 'light' || saved === 'dark') return saved;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function saveThemePreference(theme: 'light' | 'dark'): void {
  localStorage.setItem(KEYS.THEME, theme);
}
