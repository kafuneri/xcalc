import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../src/presets/builtin';
import {
  calculateScore,
  convertInputsMode,
  getPresetTotals,
} from '../src/core/calc';
import { mergeSyncPayloads } from '../shared/syncMerge.js';

describe('built-in presets sanity check', () => {
  it('sums exactly to 100 points for all built-in presets', () => {
    const totals = BUILTIN_PRESETS.map((p) => ({
      id: p.id,
      ...getPresetTotals(p),
    }));

    expect(totals).toEqual([
      { id: 'builtin-guokao-2025-130', totalQuestions: 130, maxScore: 100 },
      { id: 'builtin-guokao-2025-135', totalQuestions: 135, maxScore: 100 },
      { id: 'builtin-shengkao-120', totalQuestions: 120, maxScore: 100 },
    ]);
  });
});

describe('calculateScore', () => {
  const preset130 = BUILTIN_PRESETS[0];

  it('gives full score when 0 wrong in wrong-mode', () => {
    const result = calculateScore(preset130, {}, 'wrong');
    expect(result.totalQuestions).toBe(130);
    expect(result.totalCorrect).toBe(130);
    expect(result.totalWrong).toBe(0);
    expect(result.totalScore).toBe(100);
    expect(result.accuracy).toBe(100);
  });

  it('computes leaf and parent module scores without floating point drift', () => {
    const wrongInputs = {
      'mod-politics': 5, // 15 * 0.7 = 10.5
      'mod-commonsense': 5, // 10 * 0.5 = 5
      'mod-verbal': 4, // 26 * 0.8 = 20.8
      'mod-quant': 3, // 7 * 1.0 = 7
      'mod-reasoning-graph': 2, // 8 * 0.6 = 4.8
      'mod-reasoning-def': 1, // 9 * 0.8 = 7.2
      'mod-reasoning-analogy': 1, // 4 * 0.5 = 2
      'mod-reasoning-logic': 2, // 8 * 0.8 = 6.4
      'mod-data': 2, // 18 * 1.0 = 18
    };

    const result = calculateScore(preset130, wrongInputs, 'wrong');
    // Total wrong = 25, correct = 105
    expect(result.totalWrong).toBe(25);
    expect(result.totalCorrect).toBe(105);
    // 10.5 + 5 + 20.8 + 7 + (4.8 + 7.2 + 2 + 6.4 = 20.4) + 18 = 81.7
    expect(result.totalScore).toBe(81.7);

    const reasoning = result.modules.find((m) => m.moduleId === 'mod-reasoning');
    expect(reasoning?.questionCount).toBe(35);
    expect(reasoning?.correctCount).toBe(29);
    expect(reasoning?.wrongCount).toBe(6);
    expect(reasoning?.score).toBe(20.4);
    expect(reasoning?.children?.map((c) => c.score)).toEqual([4.8, 7.2, 2, 6.4]);
  });

  it('produces identical result after converting inputs from wrong to correct mode', () => {
    const wrongInputs = {
      'mod-politics': 4,
      'mod-verbal': 6,
      'mod-reasoning-graph': 3,
      'mod-data': 1,
    };

    const wrongEval = calculateScore(preset130, wrongInputs, 'wrong');
    const correctInputs = convertInputsMode(preset130, wrongInputs, 'wrong', 'correct');
    const correctEval = calculateScore(preset130, correctInputs, 'correct');

    expect(correctEval.totalScore).toBe(wrongEval.totalScore);
    expect(correctEval.totalCorrect).toBe(wrongEval.totalCorrect);
    expect(correctEval.totalWrong).toBe(wrongEval.totalWrong);
  });

  it('clamps out-of-range inputs safely', () => {
    const result = calculateScore(
      preset130,
      { 'mod-politics': 999, 'mod-data': -5 },
      'wrong'
    );
    const politics = result.modules.find((m) => m.moduleId === 'mod-politics');
    const data = result.modules.find((m) => m.moduleId === 'mod-data');
    expect(politics?.wrongCount).toBe(20);
    expect(politics?.score).toBe(0);
    expect(data?.wrongCount).toBe(0);
    expect(data?.score).toBe(20);
  });
});

describe('mergeSyncPayloads', () => {
  it('merges disjoint and updated records using LWW and propagates tombstones', () => {
    const local = {
      schemaVersion: 1,
      updatedAt: 200,
      presets: [
        { id: 'p1', name: 'local-newer', builtIn: false, modules: [], updatedAt: 200 },
      ],
      records: [
        { id: 'r1', paperName: 'local-only', updatedAt: 150 },
        { id: 'r2', paperName: 'deleted-locally', updatedAt: 250, deletedAt: 250 },
      ] as any,
    };

    const remote = {
      schemaVersion: 1,
      updatedAt: 220,
      presets: [
        { id: 'p1', name: 'remote-older', builtIn: false, modules: [], updatedAt: 100 },
        { id: 'p2', name: 'remote-only', builtIn: false, modules: [], updatedAt: 120 },
      ],
      records: [
        { id: 'r2', paperName: 'old-version', updatedAt: 100 },
        { id: 'r3', paperName: 'remote-only', updatedAt: 220 },
      ] as any,
    };

    const merged = mergeSyncPayloads(local, remote);
    expect(merged.presets.map((p) => `${p.id}:${p.name}`).sort()).toEqual([
      'p1:local-newer',
      'p2:remote-only',
    ]);
    expect(merged.records.find((r) => r.id === 'r1')?.paperName).toBe('local-only');
    expect(merged.records.find((r) => r.id === 'r2')?.deletedAt).toBe(250);
    expect(merged.records.find((r) => r.id === 'r3')?.paperName).toBe('remote-only');
  });
});
