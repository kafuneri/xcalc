<script setup lang="ts">
const props = defineProps<{
  value: number;
  max: number;
  invalid?: boolean;
  label: string;
}>();

const emit = defineEmits<{
  change: [rawValue: unknown];
  step: [delta: number];
  enter: [event: KeyboardEvent];
}>();

function selectAll(event: FocusEvent) {
  (event.target as HTMLInputElement | null)?.select();
}
</script>

<template>
  <div>
    <div class="stepper">
      <button
        type="button"
        class="stepper-btn step-5"
        title="减 5"
        :disabled="props.value <= 0"
        @click="emit('step', -5)"
      >
        −5
      </button>
      <button
        type="button"
        class="stepper-btn"
        title="减 1"
        :disabled="props.value <= 0"
        @click="emit('step', -1)"
      >
        −1
      </button>
      <input
        type="number"
        inputmode="numeric"
        min="0"
        :max="props.max"
        class="stepper-input tabular"
        :class="{ invalid: props.invalid }"
        :value="props.value"
        :aria-label="props.label"
        @focus="selectAll"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="emit('enter', $event)"
      />
      <button
        type="button"
        class="stepper-btn"
        title="加 1"
        :disabled="props.value >= props.max"
        @click="emit('step', 1)"
      >
        +1
      </button>
      <button
        type="button"
        class="stepper-btn step-5"
        title="加 5"
        :disabled="props.value >= props.max"
        @click="emit('step', 5)"
      >
        +5
      </button>
    </div>
    <div
      v-if="props.invalid"
      style="font-size: 11px; color: var(--danger); margin-top: 2px"
    >
      范围 0~{{ props.max }}
    </div>
  </div>
</template>
