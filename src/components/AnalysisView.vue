<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  AlertTriangle,
  Award,
  RefreshCw,
  Settings,
  Sparkles,
  TrendingUp,
} from '@lucide/vue';
import type {
  AiAnalysisConfig,
  AiAnalysisResult,
  ExamCategory,
  HealthStatus,
  HistoryRecord,
  ModuleAnalytics,
  SyncProfile,
} from '../types';
import {
  analyzeHistoryRecords,
  buildAiSummaryDigest,
  buildRecordsFingerprint,
} from '../core/analytics';
import { formatAccuracy, formatScore } from '../core/calc';
import {
  loadAiConfig,
  loadAiResultCache,
  saveAiConfig,
  saveAiResultCache,
} from '../core/storage';
import { deriveSyncKey, requestAiAnalysis } from '../core/sync';
import { renderSafeMarkdown } from '../core/markdown';

const props = defineProps<{
  examCategory: ExamCategory;
  records: HistoryRecord[];
  health: HealthStatus;
  syncProfile: SyncProfile;
}>();

const report = computed(() => analyzeHistoryRecords(props.records));
const fingerprint = computed(() =>
  buildRecordsFingerprint(props.records, props.examCategory)
);

const showSubModules = ref(true);
const showAiSettings = ref(false);
const aiConfig = ref<AiAnalysisConfig>(loadAiConfig());
const aiCache = ref<AiAnalysisResult | null>(loadAiResultCache());
const aiLoading = ref(false);
const aiError = ref('');

watch(
  aiConfig,
  (val) => {
    saveAiConfig(val);
  },
  { deep: true }
);

const displayedModules = computed<ModuleAnalytics[]>(() => {
  if (showSubModules.value) {
    return report.value.leafModules;
  }
  // Collapse sub-modules back into their parent summary when toggled
  const seenParents = new Set<string>();
  const rows: ModuleAnalytics[] = [];
  for (const mod of report.value.leafModules) {
    if (mod.isSubModule && mod.parentName) {
      if (!seenParents.has(mod.parentName)) {
        seenParents.add(mod.parentName);
        const parentRow = report.value.parentModules.find(
          (p) => p.moduleName === mod.parentName
        );
        if (parentRow) rows.push(parentRow);
      }
    } else {
      rows.push(mod);
    }
  }
  return rows;
});

const matchingCachedResult = computed(() => {
  if (!aiCache.value) return null;
  return aiCache.value.fingerprint === fingerprint.value ? aiCache.value : null;
});

const activeAiDisplay = computed(() => {
  if (matchingCachedResult.value) return matchingCachedResult.value;
  if (
    aiCache.value &&
    aiCache.value.fingerprint.startsWith(`${props.examCategory}::`)
  ) {
    return aiCache.value;
  }
  return null;
});

const renderedAiHtml = computed(() =>
  activeAiDisplay.value ? renderSafeMarkdown(activeAiDisplay.value.content) : ''
);

const canCallServerAi = computed(() => {
  if (aiConfig.value.mode !== 'server') return true;
  return Boolean(props.health.aiReady);
});

function statusBadge(status: ModuleAnalytics['status']) {
  switch (status) {
    case 'strength':
      return { text: '优势项', cls: 'pill-success' };
    case 'weakness':
      return { text: '弱势项', cls: 'pill-danger' };
    case 'volatile':
      return { text: '波动较大', cls: 'pill-warning' };
    default:
      return { text: '稳态项', cls: 'pill-neutral' };
  }
}

function formatDelta(delta: number | null, suffix = ''): string {
  if (delta === null) return '样本不足';
  const rounded = Math.round(delta * 10) / 10;
  if (rounded > 0) return `+${rounded}${suffix}`;
  return `${rounded}${suffix}`;
}

async function handleRunAiAnalysis() {
  if (report.value.recordCount === 0) return;
  aiLoading.value = true;
  aiError.value = '';

  try {
    let syncKey: string | undefined;
    if (
      props.syncProfile.enabled &&
      props.syncProfile.spaceName &&
      props.syncProfile.passphrase
    ) {
      syncKey = await deriveSyncKey(
        props.syncProfile.spaceName,
        props.syncProfile.passphrase
      );
    }

    const digest = buildAiSummaryDigest(
      report.value,
      props.records,
      props.examCategory
    );
    const res = await requestAiAnalysis({
      digest,
      aiConfig: aiConfig.value,
      syncKey,
    });

    const saved: AiAnalysisResult = {
      fingerprint: fingerprint.value,
      provider: res.provider,
      model: res.model,
      content: res.content,
      createdAt: Date.now(),
    };
    aiCache.value = saved;
    saveAiResultCache(saved);
  } catch (err) {
    aiError.value = err instanceof Error ? err.message : 'AI 分析请求失败';
  } finally {
    aiLoading.value = false;
  }
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <div
      v-if="report.recordCount === 0"
      class="card"
      style="text-align: center; padding: 48px 20px; color: var(--text-muted)"
    >
      <p style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: var(--text)">
        暂无可用于分析的历史试卷记录
      </p>
      <p style="margin: 0; font-size: 13px">
        请先在「分数计算」页面保存至少 1 套试卷记录，系统将自动计算各模块优劣势、提分性价比并支持 AI 深度复盘。
      </p>
    </div>

    <template v-else>
      <!-- Top KPI Overview -->
      <div class="kpi-grid tabular">
        <div class="card kpi-card">
          <span class="kpi-label">平均成绩（共 {{ report.recordCount }} 套）</span>
          <strong class="kpi-value">{{ formatScore(report.avgScore) }} 分</strong>
          <span class="kpi-sub">
            平均正确率 {{ formatAccuracy(report.avgAccuracy) }}
          </span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">历史最高分</span>
          <strong class="kpi-value" style="color: var(--success)">
            {{ formatScore(report.bestScore) }} 分
          </strong>
          <span class="kpi-sub">最近一次 {{ formatScore(report.latestScore) }} 分</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">近期分数趋势</span>
          <strong
            class="kpi-value"
            :style="{
              color:
                report.recentScoreDelta === null
                  ? 'var(--text)'
                  : report.recentScoreDelta >= 0
                    ? 'var(--success)'
                    : 'var(--danger)',
            }"
          >
            {{ formatDelta(report.recentScoreDelta, ' 分') }}
          </strong>
          <span class="kpi-sub">对比此前套卷均值变化</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">最值得优先提分模块</span>
          <strong class="kpi-value" style="font-size: 20px; color: var(--primary)">
            {{ report.priorities[0]?.moduleName || '均已满分' }}
          </strong>
          <span class="kpi-sub">
            {{
              report.priorities[0]
                ? `场均失分 ${formatScore(report.priorities[0].avgLostScore)} 分 · 正确率 ${formatAccuracy(report.priorities[0].avgAccuracy)}`
                : '继续保持'
            }}
          </span>
        </div>
      </div>

      <!-- Layer 1: Deterministic Strengths & Weaknesses -->
      <div class="analysis-two-col">
        <div class="card">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 700">
              <Award :size="16" style="color: var(--success)" />
              <span>优势项（稳分基本盘）</span>
            </div>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 10px">
            <div
              v-for="mod in report.strengths.slice(0, 4)"
              :key="`str-${mod.moduleName}`"
              class="diag-item"
            >
              <div class="diag-item-head tabular">
                <div>
                  <strong>{{ mod.moduleName }}</strong>
                  <span
                    v-if="mod.parentName"
                    style="font-size: 12px; color: var(--text-muted); margin-left: 6px"
                  >
                    ({{ mod.parentName }})
                  </span>
                </div>
                <span class="pill" :class="statusBadge(mod.status).cls">
                  {{ formatAccuracy(mod.avgAccuracy) }}
                </span>
              </div>
              <div class="diag-meta tabular">
                场均 {{ formatScore(mod.avgScore) }} / {{ formatScore(mod.avgMaxScore) }} 分 ·
                波动标准差 {{ mod.stdDevAccuracy.toFixed(1) }}%
              </div>
              <p class="diag-tip">{{ mod.ruleAdvice }}</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 700">
              <AlertTriangle :size="16" style="color: var(--warning)" />
              <span>提分优先项（按失分 × 可控度排序）</span>
            </div>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 10px">
            <div
              v-if="report.priorities.length === 0"
              style="font-size: 13px; color: var(--text-muted)"
            >
              各模块均已满分，暂无明显短板。
            </div>
            <div
              v-for="(mod, idx) in report.priorities.slice(0, 4)"
              :key="`weak-${mod.moduleName}`"
              class="diag-item"
            >
              <div class="diag-item-head tabular">
                <div style="display: flex; align-items: center; gap: 6px">
                  <span class="rank-num">P{{ idx + 1 }}</span>
                  <strong>{{ mod.moduleName }}</strong>
                  <span
                    v-if="mod.parentName"
                    style="font-size: 12px; color: var(--text-muted)"
                  >
                    ({{ mod.parentName }})
                  </span>
                </div>
                <span class="pill" :class="statusBadge(mod.status).cls">
                  {{ statusBadge(mod.status).text }} · {{ formatAccuracy(mod.avgAccuracy) }}
                </span>
              </div>
              <div class="diag-meta tabular">
                场均失分 {{ formatScore(mod.avgLostScore) }} 分（满分
                {{ formatScore(mod.avgMaxScore) }}）· 最近
                {{ formatAccuracy(mod.latestAccuracy) }}
              </div>
              <p class="diag-tip">{{ mod.ruleAdvice }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Full Module Table -->
      <div class="card">
        <div class="card-header">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700">
            <TrendingUp :size="16" />
            <span>全模块量化明细（跨预设按模块名自动合并）</span>
          </div>
          <button
            class="btn btn-sm"
            type="button"
            @click="showSubModules = !showSubModules"
          >
            {{ showSubModules ? '合并子模块显示' : '展开全部子模块' }}
          </button>
        </div>
        <div style="overflow-x: auto">
          <table class="history-table tabular">
            <thead>
              <tr>
                <th>模块名称</th>
                <th class="num">统计套数</th>
                <th class="num">平均正确率</th>
                <th class="num">场均得分 / 满分</th>
                <th class="num">场均失分</th>
                <th class="num">波动(标准差)</th>
                <th>诊断状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="mod in displayedModules" :key="`tbl-${mod.moduleName}`">
                <td>
                  <strong>{{ mod.moduleName }}</strong>
                  <span
                    v-if="mod.parentName"
                    style="font-size: 11px; color: var(--text-muted); margin-left: 4px"
                  >
                    {{ mod.parentName }}
                  </span>
                </td>
                <td class="num">{{ mod.sampleCount }}</td>
                <td class="num">{{ formatAccuracy(mod.avgAccuracy) }}</td>
                <td class="num">
                  {{ formatScore(mod.avgScore) }} / {{ formatScore(mod.avgMaxScore) }}
                </td>
                <td class="num">{{ formatScore(mod.avgLostScore) }}</td>
                <td class="num">{{ mod.stdDevAccuracy.toFixed(1) }}%</td>
                <td>
                  <span class="pill" :class="statusBadge(mod.status).cls">
                    {{ statusBadge(mod.status).text }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Layer 2: On-demand AI Depth Review -->
      <div class="card">
        <div class="card-header">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700">
            <Sparkles :size="16" style="color: var(--primary)" />
            <span>AI 深度复盘建议（按需触发）</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button
              class="btn btn-sm"
              type="button"
              @click="showAiSettings = !showAiSettings"
            >
              <Settings :size="14" />
              <span>模型接口设置</span>
            </button>
            <button
              class="btn btn-sm btn-primary"
              type="button"
              :disabled="aiLoading || !canCallServerAi"
              @click="handleRunAiAnalysis"
            >
              <RefreshCw :size="14" :class="{ spin: aiLoading }" />
              <span>
                {{
                  aiLoading
                    ? '生成复盘中...'
                    : matchingCachedResult
                      ? '重新生成 AI 复盘'
                      : '生成 AI 深度复盘'
                }}
              </span>
            </button>
          </div>
        </div>

        <div class="card-body" style="display: flex; flex-direction: column; gap: 12px">
          <div v-if="showAiSettings" class="name-preset-box" style="display: flex; flex-direction: column; gap: 10px">
            <div>
              <label class="field-label">调用方式</label>
              <select v-model="aiConfig.mode" class="select">
                <option value="server">
                  使用站点服务端配置（{{ health.aiReady ? '已就绪' : '未配置密钥' }}）
                </option>
                <option value="gemini-byok">自定义 Gemini API Key（仅存本地浏览器）</option>
                <option value="openai-byok">自定义 OpenAI 兼容接口（DeepSeek 等，仅存本地）</option>
              </select>
            </div>

            <div v-if="aiConfig.mode === 'server'">
              <label class="field-label">
                内置模型选择（默认自动容灾；指定单个模型时若失败直接报错，不跨源回退）
              </label>
              <select v-model="aiConfig.serverModel" class="select">
                <option value="auto">
                  自动容灾（智谱 glm-4.7-flash → Cloudflare Gemma-4 → Makers Gemini）
                </option>
                <option value="zhipu:glm-4.7-flash">
                  1. 智谱 · glm-4.7-flash（直连 · 关思考）
                </option>
                <option value="cf:@cf/google/gemma-4-26b-a4b-it">
                  2. Cloudflare · @cf/google/gemma-4-26b-a4b-it（关思考）
                </option>
                <option value="makers:auto">
                  3. EdgeOne Makers · Gemini 全链自动回退（仅 google/*）
                </option>
                <option value="makers:google/gemini-4-hydrogen">
                  3a. EdgeOne Makers · google/gemini-4-hydrogen
                </option>
                <option value="makers:google/gemini-3.8-flash">
                  3b. EdgeOne Makers · google/gemini-3.8-flash
                </option>
                <option value="makers:google/gemini-3.6-flash">
                  3c. EdgeOne Makers · google/gemini-3.6-flash
                </option>
                <option value="makers:google/gemini-3.5-flash-lite">
                  3d. EdgeOne Makers · google/gemini-3.5-flash-lite
                </option>
              </select>
            </div>

            <div v-if="aiConfig.mode === 'gemini-byok'">
              <label class="field-label">Gemini API Key（优先调用 gemini-4-hydrogen，拥堵时自动回退 Flash 备选模型）</label>
              <input
                v-model="aiConfig.geminiKey"
                class="input"
                type="password"
                placeholder="输入 AIza... 或 AQ... 开头的 Gemini API Key"
              />
            </div>

            <div v-if="aiConfig.mode === 'openai-byok'" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px">
              <div>
                <label class="field-label">Base URL</label>
                <input
                  v-model="aiConfig.openaiBaseUrl"
                  class="input"
                  type="text"
                  placeholder="https://api.deepseek.com/v1"
                />
              </div>
              <div>
                <label class="field-label">Model 名称</label>
                <input
                  v-model="aiConfig.openaiModel"
                  class="input"
                  type="text"
                  placeholder="deepseek-chat"
                />
              </div>
              <div>
                <label class="field-label">API Key</label>
                <input
                  v-model="aiConfig.openaiKey"
                  class="input"
                  type="password"
                  placeholder="sk-..."
                />
              </div>
            </div>
          </div>

          <div class="alert-box alert-warning ai-disclaimer">
            <strong>免责与可用性声明：</strong>
            1）AI 复盘结论及备考建议由大语言模型基于统计摘要自动生成，仅作备考思路辅助参考，不具备教研权威性或必然准确性，切勿轻信或作为唯一决策依据，请结合真题解析与自身薄弱点审慎甄别；
            2）内置接口均基于第三方免费/公共 AI 配额与网络链路提供服务，不对其可用性、响应时延与并发稳定性作保障（高峰限流、跨境网络波动或额度耗尽时可能调用失败），如遇异常可稍后重试或自行配置 API Key。
          </div>

          <div
            v-if="aiConfig.mode === 'server' && aiConfig.serverModel !== 'auto'"
            class="alert-box alert-info"
            style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap"
          >
            <span>
              当前已指定测试内置模型：<code>{{ aiConfig.serverModel }}</code>（失败时不回退，直接展示真实错误）
            </span>
            <button
              class="btn btn-sm"
              type="button"
              @click="aiConfig.serverModel = 'auto'"
            >
              恢复自动容灾
            </button>
          </div>

          <div
            v-if="aiConfig.mode === 'server' && !health.aiReady"
            class="alert-box alert-warning"
          >
            当前服务端尚未配置 AI 密钥。可点击右上角「模型接口设置」切换为自己的 Gemini / DeepSeek / OpenAI 兼容 Key，或在部署环境中配置 <code>ZHIPU_API_KEY</code>、<code>CF_ACCOUNT_ID</code>/<code>CF_API_TOKEN</code> 或 <code>AI_GATEWAY_API_KEY</code>。
          </div>

          <div v-if="aiError" class="alert-box alert-danger">
            {{ aiError }}
          </div>

          <div v-if="activeAiDisplay" class="ai-result-box">
            <div class="ai-result-meta tabular">
              <span>
                来源：<strong>{{ activeAiDisplay.provider }}</strong> ·
                <code>{{ activeAiDisplay.model }}</code>
                <span
                  v-if="!matchingCachedResult"
                  class="pill pill-warning"
                  style="margin-left: 6px"
                >
                  试卷记录已变更，可点击重新生成
                </span>
              </span>
              <span>
                {{ new Date(activeAiDisplay.createdAt).toLocaleString('zh-CN') }}
              </span>
            </div>
            <div class="ai-result-content ai-markdown" v-html="renderedAiHtml" />
          </div>

          <p
            v-else-if="!aiLoading"
            style="margin: 0; font-size: 13px; color: var(--text-muted)"
          >
            点击「生成 AI 深度复盘」后，仅会把上面已精确算好的各模块统计摘要与最近 8 套试卷备注发送给模型，用于生成考场做题顺序与 7 天针对性训练方案。
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
