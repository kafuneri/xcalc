<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Cloud, CloudOff, Eye, EyeOff, RefreshCw, X } from '@lucide/vue';
import type { HealthStatus, SyncProfile } from '../types';

const props = defineProps<{
  open: boolean;
  profile: SyncProfile;
  health: HealthStatus;
  syncing: boolean;
  syncError: string;
}>();

const emit = defineEmits<{
  close: [];
  connect: [spaceName: string, passphrase: string];
  syncNow: [];
  disconnect: [];
}>();

const spaceName = ref('');
const passphrase = ref('');
const showPass = ref(false);
const localError = ref('');

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      spaceName.value = props.profile.spaceName;
      passphrase.value = props.profile.passphrase;
      localError.value = '';
    }
  }
);

const canConnect = computed(() => {
  return spaceName.value.trim().length >= 2 && passphrase.value.length >= 6;
});

const envBadge = computed(() => {
  if (props.health.platform === 'local-mock') {
    return {
      text: '当前运行：本地开发模拟 KV (.local-kv.json)',
      cls: 'alert-info',
    };
  }
  if (props.health.platform === 'edgeone' && props.health.kvReady) {
    return {
      text: '当前运行：腾讯云 EdgeOne KV 已就绪 (XC_KV)',
      cls: 'alert-success',
    };
  }
  if (props.health.platform === 'edgeone' && !props.health.kvReady) {
    return {
      text: '检测到 EdgeOne 环境，但尚未在控制台绑定名为 XC_KV 的 KV 命名空间。',
      cls: 'alert-warning',
    };
  }
  return {
    text: '未检测到云端函数接口（纯静态环境）。数据仅保存在当前浏览器本地。',
    cls: 'alert-warning',
  };
});

const lastSyncedText = computed(() => {
  if (!props.profile.lastSyncedAt) return '尚未同步';
  return new Date(props.profile.lastSyncedAt).toLocaleString('zh-CN');
});

function handleConnect() {
  localError.value = '';
  const name = spaceName.value.trim();
  if (name.length < 2) {
    localError.value = '空间名称 / 昵称至少需要 2 个字符';
    return;
  }
  if (passphrase.value.length < 6) {
    localError.value = '为了防止他人撞库访问你的数据，同步口令至少需要 6 位';
    return;
  }
  emit('connect', name, passphrase.value);
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-panel">
      <div class="card-header">
        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700">
          <Cloud :size="18" />
          <span>多用户云端同步（EdgeOne KV）</span>
        </div>
        <button class="btn btn-sm btn-icon" @click="emit('close')" aria-label="关闭">
          <X :size="16" />
        </button>
      </div>

      <div class="card-body" style="display: flex; flex-direction: column; gap: 14px">
        <div class="alert-box" :class="envBadge.cls">
          {{ envBadge.text }}
        </div>

        <div class="alert-box alert-info">
          <strong>免注册多用户隔离：</strong>你和朋友可各自输入专属的「空间名称 + 口令」。前端会在本地计算 SHA-256 哈希后作为云端存储键，不同人的预设和历史试卷彼此完全隔离，换设备输入相同信息即可恢复。
        </div>

        <div>
          <label class="field-label">空间名称 / 昵称（至少 2 个字符）</label>
          <input
            v-model="spaceName"
            class="input"
            type="text"
            placeholder="例如：kafuneri 或 zhangsan"
            autocomplete="username"
          />
        </div>

        <div>
          <label class="field-label">同步口令（至少 6 位，服务端不存明文）</label>
          <div style="display: flex; gap: 8px">
            <input
              v-model="passphrase"
              class="input"
              :type="showPass ? 'text' : 'password'"
              placeholder="设置个人专属同步口令"
              autocomplete="current-password"
              @keyup.enter="handleConnect"
            />
            <button
              class="btn btn-icon"
              type="button"
              :title="showPass ? '隐藏口令' : '显示口令'"
              @click="showPass = !showPass"
            >
              <EyeOff v-if="showPass" :size="16" />
              <Eye v-else :size="16" />
            </button>
          </div>
        </div>

        <div v-if="localError || syncError" class="alert-box alert-danger">
          {{ localError || syncError }}
        </div>

        <div
          v-if="profile.enabled"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 12px;
            color: var(--text-muted);
          "
        >
          <span>当前绑定空间：<strong>{{ profile.spaceName }}</strong></span>
          <span>最近同步：{{ lastSyncedText }}</span>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end">
          <button
            v-if="profile.enabled"
            class="btn btn-danger-ghost"
            type="button"
            :disabled="syncing"
            @click="emit('disconnect')"
          >
            <CloudOff :size="15" />
            <span>断开云同步</span>
          </button>

          <button
            v-if="profile.enabled"
            class="btn"
            type="button"
            :disabled="syncing || !health.kvReady"
            @click="emit('syncNow')"
          >
            <RefreshCw :size="15" />
            <span>{{ syncing ? '同步中...' : '立即同步' }}</span>
          </button>

          <button
            class="btn btn-primary"
            type="button"
            :disabled="syncing || !canConnect || !health.kvReady"
            @click="handleConnect"
          >
            <Cloud :size="15" />
            <span>{{ profile.enabled ? '更新并同步' : '开启并合并云端数据' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
