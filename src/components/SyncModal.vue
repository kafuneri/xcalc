<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Cloud, CloudOff, Eye, EyeOff, KeyRound, RefreshCw, X } from '@lucide/vue';
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
  changePassphrase: [oldPassphrase: string, newPassphrase: string];
}>();

const spaceName = ref('');
const passphrase = ref('');
const showPass = ref(false);
const localError = ref('');
const showRekey = ref(false);
const oldPassInput = ref('');
const newPassInput = ref('');
const confirmNewPass = ref('');

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      spaceName.value = props.profile.spaceName;
      passphrase.value = props.profile.passphrase;
      localError.value = '';
      showRekey.value = false;
      oldPassInput.value = props.profile.passphrase;
      newPassInput.value = '';
      confirmNewPass.value = '';
    }
  }
);

function isValidPassphrase(val: string): boolean {
  return val.length >= 8 && /[A-Za-z]/.test(val) && /\d/.test(val);
}

const canConnect = computed(() => {
  return spaceName.value.trim().length >= 2 && isValidPassphrase(passphrase.value);
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
      text: '腾讯云同步服务已就绪',
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
  if (!isValidPassphrase(passphrase.value)) {
    localError.value = '为了防止他人撞库访问你的数据，同步口令至少需要 8 位，且必须同时包含数字和字母';
    return;
  }
  emit('connect', name, passphrase.value);
}

function handleRekey() {
  localError.value = '';
  if (oldPassInput.value.length < 6) {
    localError.value = '原同步口令至少需要 6 位';
    return;
  }
  if (!isValidPassphrase(newPassInput.value)) {
    localError.value = '新同步口令至少需要 8 位，且必须同时包含数字和字母';
    return;
  }
  if (newPassInput.value !== confirmNewPass.value) {
    localError.value = '两次输入的新同步口令不一致';
    return;
  }
  if (newPassInput.value === oldPassInput.value) {
    localError.value = '新同步口令不能与原口令相同';
    return;
  }
  emit('changePassphrase', oldPassInput.value, newPassInput.value);
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-panel">
      <div class="card-header">
        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700">
          <Cloud :size="18" />
          <span>多端云同步</span>
        </div>
        <button class="btn btn-sm btn-icon" @click="emit('close')" aria-label="关闭">
          <X :size="16" />
        </button>
      </div>

      <div class="card-body" style="display: flex; flex-direction: column; gap: 14px">
        <div class="alert-box" :class="envBadge.cls">
          {{ envBadge.text }}
        </div>

        <div class="alert-box alert-danger">
          <strong>测试功能提示：</strong>云端同步目前处于测试阶段，云端存储数据不做持久性或稳定性保证，请注意定期通过本地「导出备份」留存数据副本。
        </div>

        <div class="alert-box alert-info">
          <strong>使用说明：</strong>输入自定义的「空间名称 + 同步口令」即可开启云同步。不同空间的数据相互独立，在另一台设备输入相同名称与口令即可恢复全部记录与预设。
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
          <label class="field-label">同步口令（至少 8 位且含数字和字母，加密传输且不存明文）</label>
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
            @click="showRekey = !showRekey"
          >
            <KeyRound :size="15" />
            <span>{{ showRekey ? '收起改密' : '修改口令' }}</span>
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

        <div
          v-if="profile.enabled && showRekey"
          style="
            border-top: 1px dashed var(--border);
            padding-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          "
        >
          <div style="font-size: 13px; font-weight: 600">
            修改当前空间「{{ profile.spaceName }}」同步口令（原口令将立即失效）
          </div>
          <div>
            <label class="field-label">原同步口令</label>
            <input
              v-model="oldPassInput"
              class="input"
              :type="showPass ? 'text' : 'password'"
              placeholder="输入当前正在使用的口令"
            />
          </div>
          <div>
            <label class="field-label">新同步口令（至少 8 位，且含数字和字母）</label>
            <input
              v-model="newPassInput"
              class="input"
              :type="showPass ? 'text' : 'password'"
              placeholder="输入新同步口令"
            />
          </div>
          <div>
            <label class="field-label">确认新口令</label>
            <input
              v-model="confirmNewPass"
              class="input"
              :type="showPass ? 'text' : 'password'"
              placeholder="再次输入新同步口令"
              @keyup.enter="handleRekey"
            />
          </div>
          <div style="display: flex; justify-content: flex-end">
            <button
              class="btn btn-primary"
              type="button"
              :disabled="syncing"
              @click="handleRekey"
            >
              <KeyRound :size="15" />
              <span>{{ syncing ? '迁移中...' : '确认修改口令并迁移数据' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
