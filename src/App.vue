<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Calculator,
  Cloud,
  History,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from '@lucide/vue';
import CalculatorView from './components/CalculatorView.vue';
import PresetEditorView from './components/PresetEditorView.vue';
import HistoryView from './components/HistoryView.vue';
import SyncModal from './components/SyncModal.vue';
import type {
  CalculationResult,
  ExamCategory,
  HealthStatus,
  HistoryRecord,
  InputMode,
  Preset,
  SyncProfile,
} from './types';
import {
  clonePreset,
  getRecordExamCategory,
  inferExamCategory,
} from './core/calc';
import {
  buildSyncPayload,
  createId,
  exportBackupJson,
  getAllAvailablePresets,
  importBackupJson,
  loadActivePresetMap,
  loadCustomPresets,
  loadExamCategory,
  loadHistoryRecords,
  loadSyncProfile,
  loadThemePreference,
  saveActivePresetId,
  saveActivePresetMap,
  saveCustomPresets,
  saveExamCategory,
  saveHistoryRecords,
  saveSyncProfile,
  saveThemePreference,
} from './core/storage';
import {
  checkCloudHealth,
  deriveSyncKey,
  pullCloudData,
  pushCloudData,
} from './core/sync';
import { getSiteConfig } from './core/siteConfig';
import { mergeSyncPayloads } from '../shared/syncMerge.js';

type TabKey = 'calculator' | 'presets' | 'history';

const siteConfig = getSiteConfig();

const activeTab = ref<TabKey>('calculator');
const examCategory = ref<ExamCategory>(loadExamCategory());
const customPresets = ref<Preset[]>(loadCustomPresets());
const records = ref<HistoryRecord[]>(loadHistoryRecords());
const activePresetByCat = ref<Partial<Record<ExamCategory, string>>>(
  loadActivePresetMap()
);
const loadedRecord = ref<HistoryRecord | null>(null);

const theme = ref<'light' | 'dark'>(loadThemePreference());
const syncProfile = ref<SyncProfile>(loadSyncProfile());
const health = ref<HealthStatus>({
  ok: false,
  platform: 'static-only',
  kvReady: false,
});
const syncModalOpen = ref(false);
const syncing = ref(false);
const syncError = ref('');
const toastMsg = ref('');

let toastTimer: number | undefined;
let autoSyncTimer: number | undefined;

const availablePresets = computed(() =>
  getAllAvailablePresets(customPresets.value)
);

const scopedPresets = computed(() =>
  availablePresets.value.filter(
    (p) => inferExamCategory(p) === examCategory.value
  )
);

const activePresetId = computed<string>({
  get() {
    const preferred = activePresetByCat.value[examCategory.value];
    if (preferred && scopedPresets.value.some((p) => p.id === preferred)) {
      return preferred;
    }
    return scopedPresets.value[0]?.id || availablePresets.value[0]?.id || '';
  },
  set(id: string) {
    activePresetByCat.value = {
      ...activePresetByCat.value,
      [examCategory.value]: id,
    };
    saveActivePresetMap(activePresetByCat.value);
    saveActivePresetId(id);
  },
});

const scopedRecords = computed(() =>
  records.value.filter((r) => getRecordExamCategory(r) === examCategory.value)
);

const activeRecordCount = computed(
  () => scopedRecords.value.filter((r) => !r.deletedAt).length
);

watch(
  theme,
  (val) => {
    document.documentElement.setAttribute('data-theme', val);
    saveThemePreference(val);
  },
  { immediate: true }
);

watch(
  examCategory,
  (cat) => {
    saveExamCategory(cat);
    document.title =
      cat === 'zhice'
        ? '职测分数计算器 · 估分预设与套卷记录'
        : '行测分数计算器 · 估分预设与套卷记录';
  },
  { immediate: true }
);

function switchExamCategory(next: ExamCategory) {
  if (examCategory.value === next) return;
  loadedRecord.value = null;
  examCategory.value = next;
  showToast(
    next === 'zhice'
      ? '已切换至「职测」模式（150分制）'
      : '已切换至「行测」模式（100分制）'
  );
}

function showToast(msg: string) {
  toastMsg.value = msg;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg.value = '';
  }, 2600);
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
}

function persistLocal() {
  saveCustomPresets(customPresets.value);
  saveHistoryRecords(records.value);
}

function scheduleAutoSync() {
  if (!syncProfile.value.enabled || !health.value.kvReady) return;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    runSync(false);
  }, 1200);
}

async function runSync(showFeedback = true) {
  if (
    !syncProfile.value.enabled ||
    !syncProfile.value.spaceName ||
    !syncProfile.value.passphrase
  ) {
    return;
  }
  if (!health.value.kvReady) return;

  syncing.value = true;
  syncError.value = '';
  try {
    const syncKey = await deriveSyncKey(
      syncProfile.value.spaceName,
      syncProfile.value.passphrase
    );
    const localPayload = buildSyncPayload(customPresets.value, records.value);
    const remoteRes = await pullCloudData(syncKey);

    const merged = mergeSyncPayloads(localPayload, remoteRes.payload);
    const pushed = await pushCloudData(syncKey, merged);

    customPresets.value = pushed.presets.filter((p) => !p.builtIn);
    records.value = pushed.records;
    persistLocal();

    syncProfile.value = {
      ...syncProfile.value,
      lastSyncedAt: Date.now(),
    };
    saveSyncProfile(syncProfile.value);

    if (showFeedback) {
      showToast('云端数据已同步');
    }
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : '云端同步失败';
    if (showFeedback) {
      showToast(`同步失败：${syncError.value}`);
    }
  } finally {
    syncing.value = false;
  }
}

async function handleConnectSync(spaceName: string, passphrase: string) {
  syncProfile.value = {
    enabled: true,
    spaceName,
    passphrase,
    lastSyncedAt: syncProfile.value.lastSyncedAt,
  };
  saveSyncProfile(syncProfile.value);
  await runSync(true);
  if (!syncError.value) {
    syncModalOpen.value = false;
  }
}

function handleDisconnectSync() {
  syncProfile.value = {
    enabled: false,
    spaceName: syncProfile.value.spaceName,
    passphrase: '',
  };
  syncError.value = '';
  saveSyncProfile(syncProfile.value);
  showToast('已断开云端绑定，本地数据保留');
}

function handleSaveRecord(payload: {
  paperName: string;
  note: string;
  examDate: string;
  mode: InputMode;
  inputs: Record<string, number>;
  preset: Preset;
  result: CalculationResult;
  overwriteRecordId?: string;
}) {
  const now = Date.now();
  if (payload.overwriteRecordId) {
    const idx = records.value.findIndex(
      (r) => r.id === payload.overwriteRecordId
    );
    if (idx !== -1) {
      records.value[idx] = {
        ...records.value[idx],
        paperName: payload.paperName,
        note: payload.note,
        examDate: payload.examDate,
        updatedAt: now,
        mode: payload.mode,
        inputs: payload.inputs,
        presetSnapshot: clonePreset(payload.preset),
        result: payload.result,
      };
      persistLocal();
      scheduleAutoSync();
      showToast('已更新历史记录');
      return;
    }
  }

  const newRecord: HistoryRecord = {
    id: createId('rec'),
    paperName: payload.paperName,
    note: payload.note,
    examDate: payload.examDate,
    createdAt: now,
    updatedAt: now,
    mode: payload.mode,
    inputs: payload.inputs,
    presetSnapshot: clonePreset(payload.preset),
    result: payload.result,
  };

  records.value.unshift(newRecord);
  persistLocal();
  scheduleAutoSync();
  showToast(`已保存「${payload.paperName}」`);
}

function handleLoadRecord(rec: HistoryRecord) {
  const targetCategory = getRecordExamCategory(rec);
  if (examCategory.value !== targetCategory) {
    examCategory.value = targetCategory;
  }

  const snapshot = clonePreset(rec.presetSnapshot);
  // Ensure the record's preset exists in availablePresets so inputs match accurately
  const exists = availablePresets.value.some((p) => p.id === snapshot.id);
  if (!exists && !snapshot.builtIn) {
    snapshot.category = snapshot.category || targetCategory;
    snapshot.updatedAt = Date.now();
    delete snapshot.deletedAt;
    customPresets.value.push(snapshot);
    persistLocal();
  }
  activePresetId.value = exists
    ? snapshot.id
    : scopedPresets.value[0]?.id || availablePresets.value[0].id;
  if (customPresets.value.some((p) => p.id === snapshot.id && !p.deletedAt)) {
    activePresetId.value = snapshot.id;
  }
  loadedRecord.value = { ...rec };
  activeTab.value = 'calculator';
  showToast(`已载入「${rec.paperName}」`);
}

function handleDeleteRecord(id: string) {
  const idx = records.value.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const now = Date.now();
  records.value[idx] = {
    ...records.value[idx],
    updatedAt: now,
    deletedAt: now,
  };
  persistLocal();
  scheduleAutoSync();
  showToast('记录已删除');
}

function handleUpdateRecordMeta(payload: {
  id: string;
  paperName: string;
  note: string;
  examDate: string;
}) {
  const idx = records.value.findIndex((r) => r.id === payload.id);
  if (idx === -1) return;
  records.value[idx] = {
    ...records.value[idx],
    paperName: payload.paperName,
    note: payload.note,
    examDate: payload.examDate,
    updatedAt: Date.now(),
  };
  persistLocal();
  scheduleAutoSync();
  showToast('已更新试卷名称与备注');
}

function handleSavePreset(preset: Preset) {
  if (preset.builtIn) return;
  const idx = customPresets.value.findIndex((p) => p.id === preset.id);
  if (idx === -1) {
    customPresets.value.push(preset);
  } else {
    customPresets.value[idx] = preset;
  }
  persistLocal();
  scheduleAutoSync();
  showToast(`预设「${preset.name}」已保存`);
}

function handleDeletePreset(id: string) {
  const idx = customPresets.value.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const now = Date.now();
  customPresets.value[idx] = {
    ...customPresets.value[idx],
    updatedAt: now,
    deletedAt: now,
  };
  if (activePresetId.value === id) {
    activePresetId.value =
      scopedPresets.value.find((p) => p.id !== id)?.id ||
      availablePresets.value[0].id;
  }
  persistLocal();
  scheduleAutoSync();
  showToast('已删除自定义预设');
}

function handleExportBackup() {
  const content = exportBackupJson(customPresets.value, records.value);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xingce-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出 JSON 备份');
}

function handleImportBackup(jsonText: string) {
  try {
    const merged = importBackupJson(jsonText, customPresets.value, records.value);
    customPresets.value = merged.presets;
    records.value = merged.records;
    persistLocal();
    scheduleAutoSync();
    showToast('备份导入并合并成功');
  } catch {
    showToast('导入失败：JSON 文件格式无效');
  }
}

const syncPillState = computed(() => {
  if (syncError.value) {
    return { text: '同步异常', cls: 'error' };
  }
  if (syncing.value) {
    return { text: '同步中...', cls: '' };
  }
  if (syncProfile.value.enabled && health.value.kvReady) {
    return { text: `云同步 · ${syncProfile.value.spaceName}`, cls: 'synced' };
  }
  if (syncProfile.value.enabled && !health.value.kvReady) {
    return { text: '仅本地（云端未就绪）', cls: '' };
  }
  return { text: '云端同步', cls: '' };
});

onMounted(async () => {
  health.value = await checkCloudHealth();
  if (syncProfile.value.enabled && health.value.kvReady) {
    await runSync(false);
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-icon">
            <Calculator :size="20" />
          </div>
          <div>
            <div class="brand-title-row">
              <h1 class="brand-title">
                {{ examCategory === 'zhice' ? '职测分数计算器' : '行测分数计算器' }}
              </h1>
              <div class="exam-mode-switch" role="group" aria-label="考试模式切换">
                <button
                  type="button"
                  class="exam-mode-btn"
                  :class="{ active: examCategory === 'xingce' }"
                  @click="switchExamCategory('xingce')"
                >
                  行测
                </button>
                <button
                  type="button"
                  class="exam-mode-btn"
                  :class="{ active: examCategory === 'zhice' }"
                  @click="switchExamCategory('zhice')"
                >
                  职测
                </button>
              </div>
            </div>
            <div v-if="siteConfig.topLinks.length > 0" class="brand-links">
              <template
                v-for="(link, idx) in siteConfig.topLinks"
                :key="link.url + idx"
              >
                <span v-if="idx > 0" class="brand-links-sep">·</span>
                <a :href="link.url" target="_blank" rel="noreferrer">
                  {{ link.label }}
                </a>
              </template>
            </div>
            <p v-else class="brand-sub">
              自定义分值预设 · 双模式算分 · 云端记录
            </p>
          </div>
        </div>

        <nav class="nav-tabs" aria-label="主导航">
          <button
            type="button"
            class="nav-tab"
            :class="{ active: activeTab === 'calculator' }"
            @click="activeTab = 'calculator'"
          >
            <Calculator :size="15" />
            <span>分数计算</span>
          </button>
          <button
            type="button"
            class="nav-tab"
            :class="{ active: activeTab === 'presets' }"
            @click="activeTab = 'presets'"
          >
            <SlidersHorizontal :size="15" />
            <span>预设管理</span>
          </button>
          <button
            type="button"
            class="nav-tab"
            :class="{ active: activeTab === 'history' }"
            @click="activeTab = 'history'"
          >
            <History :size="15" />
            <span>历史记录</span>
            <span v-if="activeRecordCount > 0" class="badge-count tabular">
              {{ activeRecordCount }}
            </span>
          </button>
        </nav>

        <div class="topbar-actions">
          <button
            type="button"
            class="sync-pill"
            :class="syncPillState.cls"
            @click="syncModalOpen = true"
          >
            <Cloud :size="14" />
            <span>{{ syncPillState.text }}</span>
          </button>

          <button
            type="button"
            class="btn btn-icon"
            :title="theme === 'light' ? '切换深色模式' : '切换浅色模式'"
            @click="toggleTheme"
          >
            <Moon v-if="theme === 'light'" :size="16" />
            <Sun v-else :size="16" />
          </button>
        </div>
      </div>
    </header>

    <main class="main-container">
      <CalculatorView
        v-show="activeTab === 'calculator'"
        :exam-category="examCategory"
        :presets="scopedPresets"
        :active-preset-id="activePresetId"
        :loaded-record="loadedRecord"
        @update:active-preset-id="activePresetId = $event"
        @save-record="handleSaveRecord"
        @go-to-presets="activeTab = 'presets'"
        @clear-loaded-record="loadedRecord = null"
      />

      <PresetEditorView
        v-if="activeTab === 'presets'"
        :exam-category="examCategory"
        :presets="scopedPresets"
        :active-preset-id="activePresetId"
        @update:active-preset-id="activePresetId = $event"
        @save-preset="handleSavePreset"
        @delete-preset="handleDeletePreset"
        @export-backup="handleExportBackup"
        @import-backup="handleImportBackup"
      />

      <HistoryView
        v-if="activeTab === 'history'"
        :exam-category="examCategory"
        :records="scopedRecords"
        @load-record="handleLoadRecord"
        @delete-record="handleDeleteRecord"
        @update-meta="handleUpdateRecordMeta"
        @export-backup="handleExportBackup"
      />
    </main>

    <!-- 备案号与站点访问量统计页脚（通过 VITE_* 环境变量按需启用） -->
    <footer v-if="siteConfig.hasFooter" class="site-footer">
      <div class="site-footer-inner">
        <div
          v-if="siteConfig.mpsBeianText || siteConfig.icpBeianText"
          class="beian-links"
        >
          <span v-if="siteConfig.mpsBeianText" class="nav-item">
            <a
              class="nav-link"
              :href="siteConfig.mpsBeianUrl"
              rel="noreferrer"
              target="_blank"
            >
              <img
                src="https://beian.mps.gov.cn/web/assets/logo01.6189a29f.png"
                alt="公安备案图标"
                class="beian-icon"
              />
              <span>{{ siteConfig.mpsBeianText }}</span>
            </a>
          </span>
          <span v-if="siteConfig.icpBeianText" class="nav-item">
            <a
              class="nav-link"
              :href="siteConfig.icpBeianUrl"
              rel="noreferrer"
              target="_blank"
            >
              <ShieldCheck :size="15" style="color: #409eff; flex-shrink: 0" aria-hidden="true" />
              <span>{{ siteConfig.icpBeianText }}</span>
            </a>
          </span>
        </div>

        <div v-if="siteConfig.vercountEnabled" class="vercount-stats tabular">
          本站总访问量
          <span id="vercount_value_site_pv" class="vercount-num">--</span> 次 ·
          本站总访客数
          <span id="vercount_value_site_uv" class="vercount-num">--</span> 人
        </div>
      </div>
    </footer>

    <SyncModal
      :open="syncModalOpen"
      :profile="syncProfile"
      :health="health"
      :syncing="syncing"
      :sync-error="syncError"
      @close="syncModalOpen = false"
      @connect="handleConnectSync"
      @sync-now="runSync(true)"
      @disconnect="handleDisconnectSync"
    />

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>
