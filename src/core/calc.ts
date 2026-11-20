import type {
  CalculationResult,
  InputMode,
  ModuleResult,
  Preset,
  ScoreModule,
} from '../types';

const SCORE_SCALE = 10000;

export function toScaledInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * SCORE_SCALE);
}

export function fromScaledInt(scaled: number): number {
  return Math.round(scaled) / SCORE_SCALE;
}

export function formatScore(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  // Keep up to 2 decimals cleanly, preserving 3-4 decimals if explicitly configured
  const fourDecimals = Math.round(value * 10000) / 10000;
  return String(fourDecimals);
}

export function formatAccuracy(accuracy: number): string {
  return `${(Math.round(accuracy * 10) / 10).toFixed(1)}%`;
}

export function isParentModule(mod: ScoreModule): boolean {
  return Array.isArray(mod.children) && mod.children.length > 0;
}

export function getLeafModules(modules: ScoreModule[]): ScoreModule[] {
  const leaves: ScoreModule[] = [];
  for (const mod of modules) {
    if (isParentModule(mod)) {
      leaves.push(...getLeafModules(mod.children!));
    } else {
      leaves.push(mod);
    }
  }
  return leaves;
}

export function getPresetTotals(preset: Pick<Preset, 'modules'>): {
  totalQuestions: number;
  maxScore: number;
} {
  let totalQuestions = 0;
  let maxScoreScaled = 0;

  for (const mod of getLeafModules(preset.modules)) {
    const q = Math.max(0, Math.floor(Number(mod.questionCount) || 0));
    const spqScaled = Math.max(0, toScaledInt(Number(mod.scorePerQuestion) || 0));
    totalQuestions += q;
    maxScoreScaled += q * spqScaled;
  }

  return {
    totalQuestions,
    maxScore: fromScaledInt(maxScoreScaled),
  };
}

export function getModuleTotals(mod: ScoreModule): {
  questionCount: number;
  maxScore: number;
} {
  if (isParentModule(mod)) {
    let questionCount = 0;
    let maxScoreScaled = 0;
    for (const child of mod.children!) {
      const sub = getModuleTotals(child);
      questionCount += sub.questionCount;
      maxScoreScaled += toScaledInt(sub.maxScore);
    }
    return { questionCount, maxScore: fromScaledInt(maxScoreScaled) };
  }

  const q = Math.max(0, Math.floor(Number(mod.questionCount) || 0));
  const spqScaled = Math.max(0, toScaledInt(Number(mod.scorePerQuestion) || 0));
  return {
    questionCount: q,
    maxScore: fromScaledInt(q * spqScaled),
  };
}

/**
 * Clamp and sanitize an integer input for a leaf module.
 */
export function clampModuleInput(value: unknown, questionCount: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const intVal = Math.floor(num);
  if (intVal < 0) return 0;
  if (intVal > questionCount) return questionCount;
  return intVal;
}

/**
 * Convert all existing leaf inputs when switching between 'wrong' and 'correct' modes.
 */
export function convertInputsMode(
  preset: Pick<Preset, 'modules'>,
  inputs: Record<string, number>,
  fromMode: InputMode,
  toMode: InputMode
): Record<string, number> {
  if (fromMode === toMode) return { ...inputs };

  const converted: Record<string, number> = {};
  for (const leaf of getLeafModules(preset.modules)) {
    const q = Math.max(0, Math.floor(Number(leaf.questionCount) || 0));
    const current = clampModuleInput(inputs[leaf.id] ?? 0, q);
    converted[leaf.id] = q - current;
  }
  return converted;
}

interface InternalModuleEval {
  result: ModuleResult;
  scoreScaled: number;
  maxScoreScaled: number;
}

function evaluateModule(
  mod: ScoreModule,
  inputs: Record<string, number>,
  mode: InputMode
): InternalModuleEval {
  if (isParentModule(mod)) {
    let questionCount = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let scoreScaled = 0;
    let maxScoreScaled = 0;
    const children: ModuleResult[] = [];

    for (const child of mod.children!) {
      const evaluated = evaluateModule(child, inputs, mode);
      children.push(evaluated.result);
      questionCount += evaluated.result.questionCount;
      correctCount += evaluated.result.correctCount;
      wrongCount += evaluated.result.wrongCount;
      scoreScaled += evaluated.scoreScaled;
      maxScoreScaled += evaluated.maxScoreScaled;
    }

    const accuracy = questionCount > 0 ? (correctCount / questionCount) * 100 : 0;

    return {
      scoreScaled,
      maxScoreScaled,
      result: {
        moduleId: mod.id,
        moduleName: mod.name,
        questionCount,
        correctCount,
        wrongCount,
        score: fromScaledInt(scoreScaled),
        maxScore: fromScaledInt(maxScoreScaled),
        accuracy,
        children,
      },
    };
  }

  const questionCount = Math.max(0, Math.floor(Number(mod.questionCount) || 0));
  const rawInput = clampModuleInput(inputs[mod.id] ?? 0, questionCount);
  const correctCount = mode === 'wrong' ? questionCount - rawInput : rawInput;
  const wrongCount = questionCount - correctCount;

  const spqScaled = Math.max(0, toScaledInt(Number(mod.scorePerQuestion) || 0));
  const scoreScaled = correctCount * spqScaled;
  const maxScoreScaled = questionCount * spqScaled;
  const accuracy = questionCount > 0 ? (correctCount / questionCount) * 100 : 0;

  return {
    scoreScaled,
    maxScoreScaled,
    result: {
      moduleId: mod.id,
      moduleName: mod.name,
      questionCount,
      correctCount,
      wrongCount,
      score: fromScaledInt(scoreScaled),
      maxScore: fromScaledInt(maxScoreScaled),
      accuracy,
    },
  };
}

export function calculateScore(
  preset: Pick<Preset, 'modules'>,
  inputs: Record<string, number>,
  mode: InputMode
): CalculationResult {
  let totalQuestions = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let totalScoreScaled = 0;
  let maxScoreScaled = 0;
  const modules: ModuleResult[] = [];

  for (const mod of preset.modules) {
    const evaluated = evaluateModule(mod, inputs, mode);
    modules.push(evaluated.result);
    totalQuestions += evaluated.result.questionCount;
    totalCorrect += evaluated.result.correctCount;
    totalWrong += evaluated.result.wrongCount;
    totalScoreScaled += evaluated.scoreScaled;
    maxScoreScaled += evaluated.maxScoreScaled;
  }

  const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

  return {
    totalQuestions,
    totalCorrect,
    totalWrong,
    totalScore: fromScaledInt(totalScoreScaled),
    maxScore: fromScaledInt(maxScoreScaled),
    accuracy,
    modules,
  };
}

export function createZeroInputs(preset: Pick<Preset, 'modules'>): Record<string, number> {
  const inputs: Record<string, number> = {};
  for (const leaf of getLeafModules(preset.modules)) {
    inputs[leaf.id] = 0;
  }
  return inputs;
}

export function clonePreset(preset: Preset): Preset {
  return JSON.parse(JSON.stringify(preset)) as Preset;
}
