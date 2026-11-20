<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  Lock,
  Plus,
  Save,
  Trash2,
  Upload,
} from '@lucide/vue';
import type { ExamCategory, Preset, ScoreModule } from '../types';
import {
  clonePreset,
  formatScore,
  getModuleTotals,
  getPresetTotals,
  isParentModule,
} from '../core/calc';
import { createId } from '../core/storage';

const props = defineProps<{
  examCategory: ExamCategory;
  presets: Preset[];
  activePresetId: string;
}>();

const emit = defineEmits<{
  'update:activePresetId': [id: string];
  savePreset: [preset: Preset];
  deletePreset: [id: string];
  exportBackup: [];
  importBackup: [jsonText: string];
}>();

const selectedId = ref<string>(props.activePresetId);
const draft = ref<Preset | null>(null);
const descExpanded = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const editorError = ref('');

const selectedPreset = computed<Preset>(() => {
  return (
    props.presets.find((p) => p.id === selectedId.value) || props.presets[0]
  );
});

watch(
  selectedPreset,
  (preset) => {
    draft.value = clonePreset(preset);
    editorError.value = '';
  },
  { immediate: true }
);

watch(
  () => props.activePresetId,
  (id) => {
    if (props.presets.some((p) => p.id === id)) {
      selectedId.value = id;
    } else if (props.presets[0]) {
      selectedId.value = props.presets[0].id;
    }
  }
);

const draftTotals = computed(() => {
  if (!draft.value) return { totalQuestions: 0, maxScore: 0 };
  return getPresetTotals(draft.value);
});

const expectedMaxScore = computed(() =>
  props.examCategory === 'zhice' ? 150 : 100
);

const isTargetScoreExact = computed(
  () => Math.abs(draftTotals.value.maxScore - expectedMaxScore.value) < 0.001
);

function selectPreset(id: string) {
  selectedId.value = id;
}

function createBlankPreset() {
  const isZhice = props.examCategory === 'zhice';
  const newPreset: Preset = isZhice
    ? {
        id: createId('preset'),
        name: '自定义职测预设',
        description: '',
        category: 'zhice',
        builtIn: false,
        updatedAt: Date.now(),
        modules: [
          { id: createId('mod'), name: '常识判断', questionCount: 20, scorePerQuestion: 1.0 },
          { id: createId('mod'), name: '言语理解与表达', questionCount: 25, scorePerQuestion: 1.6 },
          { id: createId('mod'), name: '数量关系', questionCount: 5, scorePerQuestion: 2.0 },
          {
            id: createId('mod'),
            name: '判断推理',
            questionCount: 35,
            scorePerQuestion: 0,
            children: [
              { id: createId('sub'), name: '图形推理', questionCount: 5, scorePerQuestion: 1.2 },
              { id: createId('sub'), name: '定义判断', questionCount: 10, scorePerQuestion: 1.4 },
              { id: createId('sub'), name: '类比推理', questionCount: 10, scorePerQuestion: 1.2 },
              { id: createId('sub'), name: '逻辑判断', questionCount: 10, scorePerQuestion: 1.8 },
            ],
          },
          { id: createId('mod'), name: '资料分析', questionCount: 15, scorePerQuestion: 2.0 },
        ],
      }
    : {
        id: createId('preset'),
        name: '自定义行测预设',
        description: '',
        category: 'xingce',
        builtIn: false,
        updatedAt: Date.now(),
        modules: [
          { id: createId('mod'), name: '政治理论', questionCount: 20, scorePerQuestion: 0.65 },
          { id: createId('mod'), name: '常识判断', questionCount: 15, scorePerQuestion: 0.5 },
          { id: createId('mod'), name: '言语理解与表达', questionCount: 30, scorePerQuestion: 0.8 },
          { id: createId('mod'), name: '数量关系', questionCount: 10, scorePerQuestion: 1.0 },
          {
            id: createId('mod'),
            name: '判断推理',
            questionCount: 35,
            scorePerQuestion: 0,
            children: [
              { id: createId('sub'), name: '图形推理', questionCount: 10, scorePerQuestion: 0.7 },
              { id: createId('sub'), name: '定义判断', questionCount: 10, scorePerQuestion: 0.75 },
              { id: createId('sub'), name: '类比推理', questionCount: 5, scorePerQuestion: 0.6 },
              { id: createId('sub'), name: '逻辑判断', questionCount: 10, scorePerQuestion: 0.8 },
            ],
          },
          { id: createId('mod'), name: '资料分析', questionCount: 20, scorePerQuestion: 1.0 },
        ],
      };
  emit('savePreset', newPreset);
  selectedId.value = newPreset.id;
}

function duplicateCurrentPreset() {
  const src = selectedPreset.value;
  const copy = clonePreset(src);
  copy.id = createId('preset');
  copy.name = `${src.name}（副本）`;
  copy.category = props.examCategory;
  copy.builtIn = false;
  copy.updatedAt = Date.now();
  delete copy.deletedAt;

  // Give cloned modules fresh IDs so custom presets stay cleanly independent
  copy.modules = copy.modules.map((m) => ({
    ...m,
    id: createId('mod'),
    children: m.children?.map((c) => ({ ...c, id: createId('sub') })),
  }));

  emit('savePreset', copy);
  selectedId.value = copy.id;
}

function addTopModule() {
  if (!draft.value || draft.value.builtIn) return;
  draft.value.modules.push({
    id: createId('mod'),
    name: `新模块 ${draft.value.modules.length + 1}`,
    questionCount: 10,
    scorePerQuestion: 0.8,
  });
}

function removeTopModule(idx: number) {
  if (!draft.value || draft.value.builtIn) return;
  draft.value.modules.splice(idx, 1);
}

function moveTopModule(idx: number, dir: -1 | 1) {
  if (!draft.value || draft.value.builtIn) return;
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= draft.value.modules.length) return;
  const arr = draft.value.modules;
  [arr[idx], arr[nextIdx]] = [arr[nextIdx], arr[idx]];
}

function addSubModule(mod: ScoreModule) {
  if (!draft.value || draft.value.builtIn) return;
  if (!Array.isArray(mod.children) || mod.children.length === 0) {
    // Convert existing flat module into first sub-module so user never loses entered counts
    const firstChild: ScoreModule = {
      id: createId('sub'),
      name: `${mod.name} · 子项1`,
      questionCount: mod.questionCount || 10,
      scorePerQuestion: mod.scorePerQuestion || 0.8,
    };
    const secondChild: ScoreModule = {
      id: createId('sub'),
      name: `${mod.name} · 子项2`,
      questionCount: 10,
      scorePerQuestion: 0.8,
    };
    mod.children = [firstChild, secondChild];
  } else {
    mod.children.push({
      id: createId('sub'),
      name: `子模块 ${mod.children.length + 1}`,
      questionCount: 5,
      scorePerQuestion: 0.8,
    });
  }
}

function removeSubModule(mod: ScoreModule, childIdx: number) {
  if (!draft.value || draft.value.builtIn || !mod.children) return;
  mod.children.splice(childIdx, 1);
  if (mod.children.length === 0) {
    delete mod.children;
  }
}

function updateModuleTotalScore(mod: ScoreModule, totalVal: string) {
  const total = Number(totalVal);
  if (!Number.isFinite(total) || total < 0 || mod.questionCount <= 0) return;
  mod.scorePerQuestion = Math.round((total / mod.questionCount) * 10000) / 10000;
}

function saveDraft() {
  if (!draft.value || draft.value.builtIn) return;
  editorError.value = '';
  const trimmedName = draft.value.name.trim();
  if (!trimmedName) {
    editorError.value = '预设名称不能为空';
    return;
  }
  if (draft.value.modules.length === 0) {
    editorError.value = '至少需要保留 1 个模块';
    return;
  }

  for (const mod of draft.value.modules) {
    if (!mod.name.trim()) {
      editorError.value = '存在名称为空的模块，请补全';
      return;
    }
    if (isParentModule(mod)) {
      let qSum = 0;
      for (const child of mod.children!) {
        if (!child.name.trim() || child.questionCount <= 0) {
          editorError.value = `子模块「${child.name || '未命名'}」题数必须大于 0`;
          return;
        }
        qSum += Math.floor(child.questionCount);
      }
      mod.questionCount = qSum;
    } else if (mod.questionCount <= 0) {
      editorError.value = `模块「${mod.name}」题数必须大于 0`;
      return;
    }
  }

  draft.value.name = trimmedName;
  draft.value.updatedAt = Date.now();
  emit('savePreset', clonePreset(draft.value));
}

function triggerImport() {
  fileInputRef.value?.click();
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      emit('importBackup', reader.result);
    }
    input.value = '';
  };
  reader.readAsText(file);
}
</script>

<template>
  <div class="presets-layout">
    <!-- Left: Preset List -->
    <div class="card">
      <div class="card-header">
        <span style="font-weight: 700; font-size: 14px">预设列表</span>
        <button class="btn btn-sm btn-primary" type="button" @click="createBlankPreset">
          <Plus :size="14" />
          <span>新建预设</span>
        </button>
      </div>

      <div>
        <div
          v-for="p in presets"
          :key="p.id"
          class="preset-item"
          :class="{ active: p.id === selectedPreset.id }"
          @click="selectPreset(p.id)"
        >
          <div
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <strong style="font-size: 13px">{{ p.name }}</strong>
            <span
              class="pill"
              :class="p.builtIn ? 'pill-neutral' : 'pill-primary'"
            >
              {{ p.builtIn ? '内置' : '自定义' }}
            </span>
          </div>
          <div
            class="tabular"
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: 12px;
              color: var(--text-muted);
            "
          >
            <span>
              {{ getPresetTotals(p).totalQuestions }} 题 ·
              {{ formatScore(getPresetTotals(p).maxScore) }} 分
            </span>
            <span v-if="p.id === activePresetId" style="color: var(--success); font-weight: 600">
              当前使用中
            </span>
          </div>
        </div>
      </div>

      <div
        style="
          padding: 12px 14px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 8px;
        "
      >
        <button
          class="btn btn-sm"
          style="flex: 1"
          type="button"
          @click="emit('exportBackup')"
        >
          <Download :size="14" />
          <span>导出备份</span>
        </button>
        <button
          class="btn btn-sm"
          style="flex: 1"
          type="button"
          @click="triggerImport"
        >
          <Upload :size="14" />
          <span>导入备份</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept="application/json"
          style="display: none"
          @change="handleFileChange"
        />
      </div>
    </div>

    <!-- Right: Preset Detail / Editor -->
    <div v-if="draft" class="card">
      <div class="card-header">
        <div style="display: flex; align-items: center; gap: 8px">
          <Lock v-if="draft.builtIn" :size="16" />
          <span style="font-weight: 700; font-size: 15px">
            {{ draft.builtIn ? '内置预设详情（只读）' : '编辑自定义预设' }}
          </span>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <button
            v-if="draft.id !== activePresetId"
            class="btn btn-sm"
            type="button"
            @click="emit('update:activePresetId', draft.id)"
          >
            <CheckCircle2 :size="14" />
            <span>设为计算器当前预设</span>
          </button>

          <button
            class="btn btn-sm"
            :class="{ 'btn-primary': draft.builtIn }"
            type="button"
            @click="duplicateCurrentPreset"
          >
            <Copy :size="14" />
            <span>{{ draft.builtIn ? '复制为自定义预设并修改' : '复制一份' }}</span>
          </button>

          <button
            v-if="!draft.builtIn"
            class="btn btn-sm btn-danger-ghost"
            type="button"
            @click="emit('deletePreset', draft.id)"
          >
            <Trash2 :size="14" />
            <span>删除</span>
          </button>
        </div>
      </div>

      <div class="card-body" style="display: flex; flex-direction: column; gap: 14px">
        <div v-if="draft.builtIn" class="alert-box alert-info">
          内置预设为只读模板。如需调整某模块题数或分值（例如把政治理论改成 0.6 分），点击右上角「复制为自定义预设并修改」即可。
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <div>
            <label class="field-label">预设名称</label>
            <input
              v-model="draft.name"
              class="input"
              :disabled="draft.builtIn"
              type="text"
            />
          </div>
          <div>
            <label class="field-label">说明备注（选填）</label>
            <textarea
              v-model="draft.description"
              class="input"
              :readonly="draft.builtIn"
              :rows="descExpanded ? 4 : 1"
              style="resize: vertical; line-height: 1.5; min-height: 38px; transition: all 0.15s ease"
              placeholder="例如：参考某机构130题估分表"
              @focus="descExpanded = true"
              @click="descExpanded = true"
              @blur="descExpanded = false"
            />
          </div>
        </div>

        <!-- Totals Banner -->
        <div
          class="alert-box tabular"
          :class="isTargetScoreExact ? 'alert-success' : 'alert-warning'"
          style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px"
        >
          <span>
            当前合计：<strong>{{ draftTotals.totalQuestions }} 题</strong> ·
            满分 <strong>{{ formatScore(draftTotals.maxScore) }} 分</strong>
          </span>
          <span v-if="isTargetScoreExact">
            满分正好 {{ expectedMaxScore }} 分
          </span>
          <span v-else>
            提醒：当前满分不是 {{ expectedMaxScore }} 分（差值
            {{ formatScore(draftTotals.maxScore - expectedMaxScore) }} 分）
          </span>
        </div>

        <!-- Module List -->
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="(mod, idx) in draft.modules"
            :key="mod.id"
            class="preset-editor-module"
          >
            <template v-if="isParentModule(mod)">
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 8px;
                  flex-wrap: wrap;
                "
              >
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 180px">
                  <input
                    v-model="mod.name"
                    class="input"
                    :disabled="draft.builtIn"
                    placeholder="大模块名称"
                  />
                  <span class="pill pill-neutral tabular" style="white-space: nowrap">
                    共 {{ getModuleTotals(mod).questionCount }} 题 /
                    {{ formatScore(getModuleTotals(mod).maxScore) }} 分
                  </span>
                </div>

                <div v-if="!draft.builtIn" style="display: flex; gap: 4px">
                  <button
                    class="btn btn-sm"
                    type="button"
                    @click="addSubModule(mod)"
                  >
                    <Plus :size="13" />
                    <span>子模块</span>
                  </button>
                  <button
                    class="btn btn-sm btn-icon"
                    type="button"
                    :disabled="idx === 0"
                    @click="moveTopModule(idx, -1)"
                  >
                    <ArrowUp :size="14" />
                  </button>
                  <button
                    class="btn btn-sm btn-icon"
                    type="button"
                    :disabled="idx === draft.modules.length - 1"
                    @click="moveTopModule(idx, 1)"
                  >
                    <ArrowDown :size="14" />
                  </button>
                  <button
                    class="btn btn-sm btn-icon btn-danger-ghost"
                    type="button"
                    @click="removeTopModule(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>

              <div class="editor-child-list">
                <div
                  v-for="(child, cIdx) in mod.children"
                  :key="child.id"
                  class="editor-row-grid"
                >
                  <div>
                    <label class="field-label">子模块名称</label>
                    <input
                      v-model="child.name"
                      class="input"
                      :disabled="draft.builtIn"
                    />
                  </div>
                  <div>
                    <label class="field-label">题数</label>
                    <input
                      v-model.number="child.questionCount"
                      class="input tabular"
                      type="number"
                      min="1"
                      :disabled="draft.builtIn"
                    />
                  </div>
                  <div>
                    <label class="field-label">每题分值</label>
                    <input
                      v-model.number="child.scorePerQuestion"
                      class="input tabular"
                      type="number"
                      step="0.05"
                      min="0"
                      :disabled="draft.builtIn"
                    />
                  </div>
                  <div>
                    <label class="field-label">小计总分</label>
                    <input
                      class="input tabular"
                      type="number"
                      step="0.5"
                      min="0"
                      :disabled="draft.builtIn"
                      :value="formatScore(getModuleTotals(child).maxScore)"
                      @change="
                        updateModuleTotalScore(
                          child,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </div>
                  <div v-if="!draft.builtIn" style="padding-bottom: 2px">
                    <button
                      class="btn btn-sm btn-icon btn-danger-ghost"
                      type="button"
                      title="删除子模块"
                      @click="removeSubModule(mod, cIdx)"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="editor-row-grid">
                <div>
                  <label class="field-label">模块名称</label>
                  <input
                    v-model="mod.name"
                    class="input"
                    :disabled="draft.builtIn"
                  />
                </div>
                <div>
                  <label class="field-label">题数</label>
                  <input
                    v-model.number="mod.questionCount"
                    class="input tabular"
                    type="number"
                    min="1"
                    :disabled="draft.builtIn"
                  />
                </div>
                <div>
                  <label class="field-label">每题分值</label>
                  <input
                    v-model.number="mod.scorePerQuestion"
                    class="input tabular"
                    type="number"
                    step="0.05"
                    min="0"
                    :disabled="draft.builtIn"
                  />
                </div>
                <div>
                  <label class="field-label">模块总分</label>
                  <input
                    class="input tabular"
                    type="number"
                    step="0.5"
                    min="0"
                    :disabled="draft.builtIn"
                    :value="formatScore(getModuleTotals(mod).maxScore)"
                    @change="
                      updateModuleTotalScore(
                        mod,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  />
                </div>
                <div
                  v-if="!draft.builtIn"
                  style="display: flex; gap: 4px; padding-bottom: 2px"
                >
                  <button
                    class="btn btn-sm"
                    type="button"
                    title="拆分为多个子模块"
                    @click="addSubModule(mod)"
                  >
                    拆分
                  </button>
                  <button
                    class="btn btn-sm btn-icon"
                    type="button"
                    :disabled="idx === 0"
                    @click="moveTopModule(idx, -1)"
                  >
                    <ArrowUp :size="14" />
                  </button>
                  <button
                    class="btn btn-sm btn-icon"
                    type="button"
                    :disabled="idx === draft.modules.length - 1"
                    @click="moveTopModule(idx, 1)"
                  >
                    <ArrowDown :size="14" />
                  </button>
                  <button
                    class="btn btn-sm btn-icon btn-danger-ghost"
                    type="button"
                    @click="removeTopModule(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div v-if="editorError" class="alert-box alert-danger">
          {{ editorError }}
        </div>

        <div
          v-if="!draft.builtIn"
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          "
        >
          <button class="btn" type="button" @click="addTopModule">
            <Plus :size="15" />
            <span>添加一级模块</span>
          </button>

          <button class="btn btn-primary" type="button" @click="saveDraft">
            <Save :size="15" />
            <span>保存预设更改</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
