<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Save,
  Settings2,
} from '@lucide/vue';
import type { CalculationResult, HistoryRecord, InputMode, Preset } from '../types';
import {
  calculateScore,
  clampModuleInput,
  convertInputsMode,
  createZeroInputs,
  formatAccuracy,
  formatScore,
  getLeafModules,
  getPresetTotals,
  isParentModule,
} from '../core/calc';

const props = defineProps<{
  presets: Preset[];
  activePresetId: string;
  loadedRecord: HistoryRecord | null;
}>();

const emit = defineEmits<{
  'update:activePresetId': [id: string];
  saveRecord: [
    payload: {
      paperName: string;
      note: string;
      mode: InputMode;
      inputs: Record<string, number>;
      preset: Preset;
      result: CalculationResult;
      overwriteRecordId?: string;
    },
  ];
  goToPresets: [];
  clearLoadedRecord: [];
}>();

const mode = ref<InputMode>('wrong');
const inputs = ref<Record<string, number>>({});
const collapsedGroups = reactive<Record<string, boolean>>({});
const invalidMap = reactive<Record<string, boolean>>({});

const paperName = ref('');
const note = ref('');
const saveError = ref('');

const currentPreset = computed<Preset>(() => {
  return (
    props.presets.find((p) => p.id === props.activePresetId) || props.presets[0]
  );
});

const presetSummary = computed(() => getPresetTotals(currentPreset.value));

// Sync inputs shape when preset changes
watch(
  currentPreset,
  (preset) => {
    const next: Record<string, number> = {};
    for (const leaf of getLeafModules(preset.modules)) {
      const existing = inputs.value[leaf.id];
      next[leaf.id] = clampModuleInput(existing ?? 0, leaf.questionCount);
    }
    inputs.value = next;
  },
  { immediate: true }
);

// Populate form when user clicks "载入到计算器" from HistoryView
watch(
  () => props.loadedRecord,
  (rec) => {
    if (!rec) return;
    mode.value = rec.mode;
    const next: Record<string, number> = {};
    for (const leaf of getLeafModules(currentPreset.value.modules)) {
      next[leaf.id] = clampModuleInput(
        rec.inputs[leaf.id] ?? 0,
        leaf.questionCount
      );
    }
    inputs.value = next;
    paperName.value = rec.paperName;
    note.value = rec.note;
    saveError.value = '';
  }
);

const result = computed(() =>
  calculateScore(currentPreset.value, inputs.value, mode.value)
);

const resultByModuleId = computed(() => {
  const map = new Map<string, (typeof result.value.modules)[number]>();
  for (const mod of result.value.modules) {
    map.set(mod.moduleId, mod);
    if (mod.children) {
      for (const child of mod.children) {
        map.set(child.moduleId, child);
      }
    }
  }
  return map;
});

function switchMode(nextMode: InputMode) {
  if (mode.value === nextMode) return;
  inputs.value = convertInputsMode(
    currentPreset.value,
    inputs.value,
    mode.value,
    nextMode
  );
  Object.keys(invalidMap).forEach((k) => delete invalidMap[k]);
  mode.value = nextMode;
}

function setLeafInput(moduleId: string, questionCount: number, rawValue: unknown) {
  const parsed = Number(rawValue);
  const outOfRange =
    rawValue !== '' &&
    (!Number.isFinite(parsed) || parsed < 0 || parsed > questionCount);
  invalidMap[moduleId] = outOfRange;
  inputs.value = {
    ...inputs.value,
    [moduleId]: clampModuleInput(rawValue, questionCount),
  };
}

function stepLeafInput(moduleId: string, questionCount: number, delta: number) {
  const curr = inputs.value[moduleId] ?? 0;
  setLeafInput(moduleId, questionCount, curr + delta);
}

function resetAllInputs() {
  inputs.value = createZeroInputs(currentPreset.value);
  Object.keys(invalidMap).forEach((k) => delete invalidMap[k]);
  emit('clearLoadedRecord');
}

function toggleGroup(id: string) {
  collapsedGroups[id] = !collapsedGroups[id];
}

function focusNextInput(event: KeyboardEvent) {
  const current = event.target as HTMLElement | null;
  if (!current) return;
  const all = Array.from(
    document.querySelectorAll<HTMLInputElement>('input.stepper-input')
  );
  const idx = all.indexOf(current as HTMLInputElement);
  if (idx >= 0 && idx + 1 < all.length) {
    all[idx + 1].focus();
    all[idx + 1].select();
  }
}

function selectAllOnFocus(event: FocusEvent) {
  const target = event.target as HTMLInputElement | null;
  target?.select();
}

function handleSave(overwrite = false) {
  saveError.value = '';
  const trimmedName = paperName.value.trim();
  if (!trimmedName) {
    saveError.value = '请先输入试卷名称（例如：2025国考地市级真题）';
    return;
  }

  emit('saveRecord', {
    paperName: trimmedName,
    note: note.value.trim(),
    mode: mode.value,
    inputs: { ...inputs.value },
    preset: currentPreset.value,
    result: result.value,
    overwriteRecordId: overwrite && props.loadedRecord ? props.loadedRecord.id : undefined,
  });

  if (!overwrite) {
    paperName.value = '';
    note.value = '';
  }
  emit('clearLoadedRecord');
}
</script>

<template>
  <div class="calc-layout">
    <!-- Left: Module Inputs -->
    <div class="card">
      <div class="card-header">
        <div style="font-weight: 700; font-size: 15px">答题情况录入</div>
        <div style="display: flex; gap: 8px; align-items: center">
          <button class="btn btn-sm" type="button" @click="resetAllInputs">
            <RotateCcw :size="14" />
            <span>全部归零</span>
          </button>
          <button class="btn btn-sm" type="button" @click="emit('goToPresets')">
            <Settings2 :size="14" />
            <span>自定义分值预设</span>
          </button>
        </div>
      </div>

      <div class="card-body">
        <div class="calc-toolbar">
          <div>
            <label class="field-label">当前分值预设</label>
            <select
              class="select"
              :value="currentPreset.id"
              @change="
                emit(
                  'update:activePresetId',
                  ($event.target as HTMLSelectElement).value
                )
              "
            >
              <option v-for="p in presets" :key="p.id" :value="p.id">
                {{ p.name }}（{{ getPresetTotals(p).totalQuestions }}题 ·
                {{ formatScore(getPresetTotals(p).maxScore) }}分）
              </option>
            </select>
          </div>

          <div>
            <label class="field-label">录入模式</label>
            <div class="mode-switch" role="group" aria-label="录入模式">
              <button
                type="button"
                class="mode-btn"
                :class="{ active: mode === 'wrong' }"
                @click="switchMode('wrong')"
              >
                填错题数
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: mode === 'correct' }"
                @click="switchMode('correct')"
              >
                填正确数
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="loadedRecord"
          class="alert-box alert-info"
          style="
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
          "
        >
          <span>
            正在编辑历史记录：<strong>{{ loadedRecord.paperName }}</strong>
          </span>
          <button
            class="btn btn-sm"
            type="button"
            @click="emit('clearLoadedRecord')"
          >
            退出编辑态
          </button>
        </div>

        <div class="module-list">
          <div
            v-for="mod in currentPreset.modules"
            :key="mod.id"
            class="module-group"
          >
            <!-- Parent module with children (e.g. 判断推理) -->
            <template v-if="isParentModule(mod)">
              <div
                class="module-row parent-row"
                @click="toggleGroup(mod.id)"
              >
                <div class="module-title-wrap">
                  <div class="module-name">
                    <ChevronRight
                      v-if="collapsedGroups[mod.id]"
                      :size="16"
                    />
                    <ChevronDown v-else :size="16" />
                    <span>{{ mod.name }}</span>
                    <span class="pill pill-neutral">
                      {{ resultByModuleId.get(mod.id)?.questionCount ?? 0 }}题
                    </span>
                  </div>
                  <div class="module-meta">
                    对 {{ resultByModuleId.get(mod.id)?.correctCount ?? 0 }} 题 ·
                    错 {{ resultByModuleId.get(mod.id)?.wrongCount ?? 0 }} 题 ·
                    正确率
                    {{
                      formatAccuracy(
                        resultByModuleId.get(mod.id)?.accuracy ?? 0
                      )
                    }}
                  </div>
                </div>

                <div style="font-size: 12px; color: var(--text-muted)">
                  {{ collapsedGroups[mod.id] ? '点击展开子模块' : '按子模块录入' }}
                </div>

                <div class="module-score-col tabular">
                  <div class="module-score-val">
                    {{
                      formatScore(resultByModuleId.get(mod.id)?.score ?? 0)
                    }}
                    <span
                      style="
                        font-weight: 400;
                        font-size: 12px;
                        color: var(--text-muted);
                      "
                    >
                      /
                      {{
                        formatScore(
                          resultByModuleId.get(mod.id)?.maxScore ?? 0
                        )
                      }}
                    </span>
                  </div>
                  <div class="module-score-sub">模块合计</div>
                </div>
              </div>

              <div v-show="!collapsedGroups[mod.id]">
                <div
                  v-for="child in mod.children"
                  :key="child.id"
                  class="module-row child-row"
                >
                  <div class="module-title-wrap">
                    <div class="module-name">{{ child.name }}</div>
                    <div class="module-meta tabular">
                      共 {{ child.questionCount }} 题 · 每题
                      {{ formatScore(child.scorePerQuestion) }} 分 ·
                      对
                      {{ resultByModuleId.get(child.id)?.correctCount ?? 0 }} /
                      错 {{ resultByModuleId.get(child.id)?.wrongCount ?? 0 }}
                    </div>
                  </div>

                  <div>
                    <div class="stepper">
                      <button
                        type="button"
                        class="stepper-btn"
                        :disabled="(inputs[child.id] ?? 0) <= 0"
                        @click="stepLeafInput(child.id, child.questionCount, -1)"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputmode="numeric"
                        min="0"
                        :max="child.questionCount"
                        class="stepper-input tabular"
                        :class="{ invalid: invalidMap[child.id] }"
                        :value="inputs[child.id] ?? 0"
                        :aria-label="`${child.name}${mode === 'wrong' ? '错题数' : '正确数'}`"
                        @focus="selectAllOnFocus"
                        @input="
                          setLeafInput(
                            child.id,
                            child.questionCount,
                            ($event.target as HTMLInputElement).value
                          )
                        "
                        @keydown.enter.prevent="focusNextInput"
                      />
                      <button
                        type="button"
                        class="stepper-btn"
                        :disabled="(inputs[child.id] ?? 0) >= child.questionCount"
                        @click="stepLeafInput(child.id, child.questionCount, 1)"
                      >
                        +
                      </button>
                    </div>
                    <div
                      v-if="invalidMap[child.id]"
                      style="font-size: 11px; color: var(--danger); margin-top: 2px"
                    >
                      范围 0~{{ child.questionCount }}
                    </div>
                  </div>

                  <div class="module-score-col tabular">
                    <div class="module-score-val">
                      {{
                        formatScore(resultByModuleId.get(child.id)?.score ?? 0)
                      }}
                      <span
                        style="
                          font-weight: 400;
                          font-size: 12px;
                          color: var(--text-muted);
                        "
                      >
                        /
                        {{
                          formatScore(
                            resultByModuleId.get(child.id)?.maxScore ?? 0
                          )
                        }}
                      </span>
                    </div>
                    <div class="module-score-sub">
                      {{
                        formatAccuracy(
                          resultByModuleId.get(child.id)?.accuracy ?? 0
                        )
                      }}
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Flat module -->
            <template v-else>
              <div class="module-row">
                <div class="module-title-wrap">
                  <div class="module-name">{{ mod.name }}</div>
                  <div class="module-meta tabular">
                    共 {{ mod.questionCount }} 题 · 每题
                    {{ formatScore(mod.scorePerQuestion) }} 分 ·
                    对 {{ resultByModuleId.get(mod.id)?.correctCount ?? 0 }} /
                    错 {{ resultByModuleId.get(mod.id)?.wrongCount ?? 0 }}
                  </div>
                </div>

                <div>
                  <div class="stepper">
                    <button
                      type="button"
                      class="stepper-btn"
                      :disabled="(inputs[mod.id] ?? 0) <= 0"
                      @click="stepLeafInput(mod.id, mod.questionCount, -1)"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputmode="numeric"
                      min="0"
                      :max="mod.questionCount"
                      class="stepper-input tabular"
                      :class="{ invalid: invalidMap[mod.id] }"
                      :value="inputs[mod.id] ?? 0"
                      :aria-label="`${mod.name}${mode === 'wrong' ? '错题数' : '正确数'}`"
                      @focus="selectAllOnFocus"
                      @input="
                        setLeafInput(
                          mod.id,
                          mod.questionCount,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                      @keydown.enter.prevent="focusNextInput"
                    />
                    <button
                      type="button"
                      class="stepper-btn"
                      :disabled="(inputs[mod.id] ?? 0) >= mod.questionCount"
                      @click="stepLeafInput(mod.id, mod.questionCount, 1)"
                    >
                      +
                    </button>
                  </div>
                  <div
                    v-if="invalidMap[mod.id]"
                    style="font-size: 11px; color: var(--danger); margin-top: 2px"
                  >
                    范围 0~{{ mod.questionCount }}
                  </div>
                </div>

                <div class="module-score-col tabular">
                  <div class="module-score-val">
                    {{ formatScore(resultByModuleId.get(mod.id)?.score ?? 0) }}
                    <span
                      style="
                        font-weight: 400;
                        font-size: 12px;
                        color: var(--text-muted);
                      "
                    >
                      /
                      {{
                        formatScore(
                          resultByModuleId.get(mod.id)?.maxScore ?? 0
                        )
                      }}
                    </span>
                  </div>
                  <div class="module-score-sub">
                    {{
                      formatAccuracy(
                        resultByModuleId.get(mod.id)?.accuracy ?? 0
                      )
                    }}
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <p
          style="
            margin: 12px 0 0;
            font-size: 12px;
            color: var(--text-muted);
          "
        >
          提示：当前为「{{
            mode === 'wrong' ? '错题数模式（默认0代表全对）' : '正确数模式（默认0代表全错）'
          }}」，按 Enter 键可快速跳到下一模块输入框。
        </p>
      </div>
    </div>

    <!-- Right: Live Summary + Save Record -->
    <div class="summary-sticky">
      <div class="score-hero">
        <div class="score-hero-label">
          预估总分（{{ presetSummary.totalQuestions }} 题 · 预设满分
          {{ formatScore(presetSummary.maxScore) }}）
        </div>
        <div class="score-hero-number tabular">
          <strong>{{ formatScore(result.totalScore) }}</strong>
          <span>/ {{ formatScore(result.maxScore) }} 分</span>
        </div>
        <div class="score-stats-grid tabular">
          <div class="score-stat-item">
            <span>做对题数</span>
            <strong>{{ result.totalCorrect }}</strong>
          </div>
          <div class="score-stat-item">
            <span>做错题数</span>
            <strong>{{ result.totalWrong }}</strong>
          </div>
          <div class="score-stat-item">
            <span>总正确率</span>
            <strong>{{ formatAccuracy(result.accuracy) }}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span style="font-weight: 700; font-size: 14px">各模块得分一览</span>
        </div>
        <div class="card-body breakdown-mini">
          <div v-for="mod in result.modules" :key="mod.moduleId">
            <div class="breakdown-mini-row tabular">
              <span style="font-weight: 500">{{ mod.moduleName }}</span>
              <span>
                <strong>{{ formatScore(mod.score) }}</strong>
                <span style="color: var(--text-muted); font-size: 12px">
                  / {{ formatScore(mod.maxScore) }}（{{
                    formatAccuracy(mod.accuracy)
                  }}）
                </span>
              </span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: `${Math.min(100, mod.accuracy)}%` }"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span style="font-weight: 700; font-size: 14px">保存本次套卷记录</span>
        </div>
        <div
          class="card-body"
          style="display: flex; flex-direction: column; gap: 10px"
        >
          <div>
            <label class="field-label">试卷名称 *</label>
            <input
              v-model="paperName"
              class="input"
              type="text"
              placeholder="例如：2025国考地市级真题 / 模考第8季"
              @keyup.enter="handleSave(Boolean(loadedRecord))"
            />
          </div>
          <div>
            <label class="field-label">备注（选填）</label>
            <textarea
              v-model="note"
              class="textarea"
              rows="2"
              placeholder="记录用时、失分原因或心态复盘..."
            />
          </div>

          <div v-if="saveError" class="alert-box alert-danger">
            {{ saveError }}
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button
              v-if="loadedRecord"
              class="btn btn-primary"
              style="flex: 1"
              type="button"
              @click="handleSave(true)"
            >
              <Save :size="15" />
              <span>更新原记录</span>
            </button>
            <button
              class="btn"
              :class="{ 'btn-primary': !loadedRecord }"
              style="flex: 1"
              type="button"
              @click="handleSave(false)"
            >
              <Save :size="15" />
              <span>{{ loadedRecord ? '另存为新记录' : '保存到历史记录' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
