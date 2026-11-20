<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FolderInput,
  Search,
  Trash2,
} from '@lucide/vue';
import type { HistoryRecord } from '../types';
import { formatAccuracy, formatScore } from '../core/calc';
import { getLocalDateString } from '../presets/paperName';

const props = defineProps<{
  records: HistoryRecord[];
}>();

const emit = defineEmits<{
  loadRecord: [record: HistoryRecord];
  deleteRecord: [id: string];
  updateMeta: [
    payload: { id: string; paperName: string; note: string; examDate: string },
  ];
  exportBackup: [];
}>();

const searchQuery = ref('');
const expandedIds = reactive<Record<string, boolean>>({});
const editingMetaId = ref<string | null>(null);
const editPaperName = ref('');
const editExamDate = ref('');
const editNote = ref('');

function getRecordDateKey(rec: HistoryRecord): string {
  return rec.examDate || getLocalDateString(rec.createdAt);
}

const filteredRecords = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const active = props.records
    .filter((r) => !r.deletedAt)
    .sort((a, b) => {
      const dateCmp = getRecordDateKey(b).localeCompare(getRecordDateKey(a));
      if (dateCmp !== 0) return dateCmp;
      return b.createdAt - a.createdAt;
    });
  if (!q) return active;
  return active.filter(
    (r) =>
      r.paperName.toLowerCase().includes(q) ||
      r.note.toLowerCase().includes(q) ||
      r.presetSnapshot.name.toLowerCase().includes(q) ||
      getRecordDateKey(r).includes(q)
  );
});

function toggleExpand(id: string) {
  expandedIds[id] = !expandedIds[id];
}

function startEditMeta(rec: HistoryRecord) {
  editingMetaId.value = rec.id;
  editPaperName.value = rec.paperName;
  editExamDate.value = getRecordDateKey(rec);
  editNote.value = rec.note;
}

function saveEditMeta(id: string) {
  const name = editPaperName.value.trim();
  if (!name) return;
  emit('updateMeta', {
    id,
    paperName: name,
    note: editNote.value.trim(),
    examDate: editExamDate.value || getLocalDateString(),
  });
  editingMetaId.value = null;
}

function confirmDelete(rec: HistoryRecord) {
  if (window.confirm(`确定删除「${rec.paperName}」的这条成绩记录吗？`)) {
    emit('deleteRecord', rec.id);
  }
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <div class="card">
      <div class="card-body" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <div style="position: relative; flex: 1; min-width: 220px">
          <Search
            :size="15"
            style="
              position: absolute;
              left: 10px;
              top: 50%;
              transform: translateY(-50%);
              color: var(--text-muted);
            "
          />
          <input
            v-model="searchQuery"
            class="input"
            style="padding-left: 32px"
            type="text"
            placeholder="搜索试卷名称、日期、备注或预设名称..."
          />
        </div>

        <span class="pill pill-neutral tabular">
          共 {{ filteredRecords.length }} 条记录
        </span>

        <button class="btn btn-sm" type="button" @click="emit('exportBackup')">
          <Download :size="14" />
          <span>导出 JSON 备份</span>
        </button>
      </div>
    </div>

    <div
      v-if="filteredRecords.length === 0"
      class="card"
      style="text-align: center; padding: 48px 20px; color: var(--text-muted)"
    >
      <p style="margin: 0 0 6px; font-size: 15px; font-weight: 600">
        {{ searchQuery ? '没有匹配的历史记录' : '暂无历史套卷记录' }}
      </p>
      <p style="margin: 0; font-size: 13px">
        在「分数计算」页面填写答题情况及试卷名称后保存，即可查看并回顾各模块明细。
      </p>
    </div>

    <div
      v-for="rec in filteredRecords"
      :key="rec.id"
      class="history-card"
    >
      <div class="history-card-top">
        <div style="flex: 1; min-width: 220px">
          <template v-if="editingMetaId === rec.id">
            <div style="display: flex; flex-direction: column; gap: 8px; max-width: 460px">
              <input v-model="editPaperName" class="input" placeholder="试卷名称" />
              <input v-model="editExamDate" class="input tabular" type="date" />
              <input v-model="editNote" class="input" placeholder="备注" />
              <div style="display: flex; gap: 6px">
                <button
                  class="btn btn-sm btn-primary"
                  type="button"
                  @click="saveEditMeta(rec.id)"
                >
                  保存修改
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  @click="editingMetaId = null"
                >
                  取消
                </button>
              </div>
            </div>
          </template>

          <template v-else>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
              <strong style="font-size: 16px">{{ rec.paperName }}</strong>
              <span class="pill pill-neutral">{{ rec.presetSnapshot.name }}</span>
            </div>
            <div
              class="tabular"
              style="
                margin-top: 4px;
                font-size: 12px;
                color: var(--text-muted);
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
              "
            >
              <span>{{ getRecordDateKey(rec) }}</span>
              <span v-if="rec.note" style="color: var(--text-secondary)">
                备注：{{ rec.note }}
              </span>
            </div>
          </template>
        </div>

        <div
          class="tabular"
          style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap"
        >
          <div style="text-align: right">
            <div class="history-score-badge">
              {{ formatScore(rec.result.totalScore) }}
              <span style="font-size: 13px; font-weight: 500; color: var(--text-muted)">
                / {{ formatScore(rec.result.maxScore) }}
              </span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted)">
              对 {{ rec.result.totalCorrect }} · 错 {{ rec.result.totalWrong }} ·
              正确率 {{ formatAccuracy(rec.result.accuracy) }}
            </div>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <button
              class="btn btn-sm"
              type="button"
              @click="toggleExpand(rec.id)"
            >
              <ChevronDown v-if="expandedIds[rec.id]" :size="14" />
              <ChevronRight v-else :size="14" />
              <span>{{ expandedIds[rec.id] ? '收起明细' : '模块明细' }}</span>
            </button>

            <button
              class="btn btn-sm"
              type="button"
              title="修改名称、日期与备注"
              @click="startEditMeta(rec)"
            >
              <Edit3 :size="14" />
            </button>

            <button
              class="btn btn-sm"
              type="button"
              @click="emit('loadRecord', rec)"
            >
              <FolderInput :size="14" />
              <span>载入计算器</span>
            </button>

            <button
              class="btn btn-sm btn-danger-ghost"
              type="button"
              title="删除记录"
              @click="confirmDelete(rec)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="expandedIds[rec.id]" style="overflow-x: auto">
        <table class="history-table tabular">
          <thead>
            <tr>
              <th>模块 / 子模块</th>
              <th class="num">总题数</th>
              <th class="num">做对</th>
              <th class="num">做错</th>
              <th class="num">正确率</th>
              <th class="num">得分 / 满分</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="mod in rec.result.modules" :key="mod.moduleId">
              <tr style="font-weight: 600">
                <td>{{ mod.moduleName }}</td>
                <td class="num">{{ mod.questionCount }}</td>
                <td class="num">{{ mod.correctCount }}</td>
                <td class="num">{{ mod.wrongCount }}</td>
                <td class="num">{{ formatAccuracy(mod.accuracy) }}</td>
                <td class="num">
                  {{ formatScore(mod.score) }} / {{ formatScore(mod.maxScore) }}
                </td>
              </tr>
              <tr
                v-for="child in mod.children || []"
                :key="child.moduleId"
                style="color: var(--text-secondary)"
              >
                <td style="padding-left: 28px">└ {{ child.moduleName }}</td>
                <td class="num">{{ child.questionCount }}</td>
                <td class="num">{{ child.correctCount }}</td>
                <td class="num">{{ child.wrongCount }}</td>
                <td class="num">{{ formatAccuracy(child.accuracy) }}</td>
                <td class="num">
                  {{ formatScore(child.score) }} /
                  {{ formatScore(child.maxScore) }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
