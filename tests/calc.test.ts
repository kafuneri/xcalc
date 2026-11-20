import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../src/presets/builtin';
import {
  calculateScore,
  convertInputsMode,
  getPresetTotals,
  hasEnteredInputs,
  migrateInputsBetweenPresets,
} from '../src/core/calc';
import {
  PAPER_REGIONS_ALPHA,
  PAPER_REGIONS_PINNED,
  buildPresetPaperName,
} from '../src/presets/paperName';
import { sha256HexFallback } from '../src/core/sync';
import { getSiteConfig, parseTopLinks } from '../src/core/siteConfig';
import { mergeSyncPayloads } from '../shared/syncMerge.js';

describe('built-in presets sanity check', () => {
  it('sums exactly to 100 points for all built-in presets', () => {
    const totals = BUILTIN_PRESETS.map((p) => ({
      id: p.id,
      ...getPresetTotals(p),
    }));

    expect(totals).toEqual([
      { id: 'builtin-guokao-2025-130', totalQuestions: 130, maxScore: 100 },
      { id: 'builtin-yijiu-130', totalQuestions: 130, maxScore: 100 },
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
      'mod-politics': 5,
      'mod-commonsense': 5,
      'mod-verbal': 4,
      'mod-quant': 3,
      'mod-reasoning-graph': 2,
      'mod-reasoning-def': 1,
      'mod-reasoning-analogy': 1,
      'mod-reasoning-logic': 2,
      'mod-data': 2,
    };

    const result = calculateScore(preset130, wrongInputs, 'wrong');
    expect(result.totalWrong).toBe(25);
    expect(result.totalCorrect).toBe(105);
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

  it('preserves entered counts by module name when switching between guokao and yijiu', () => {
    const guokao = BUILTIN_PRESETS[0];
    const yijiu = BUILTIN_PRESETS[1];
    const wrongInputs = {
      'mod-politics': 4,
      'mod-commonsense': 6,
      'mod-verbal': 5,
      'mod-quant': 3,
      'mod-reasoning-graph': 2,
      'mod-reasoning-def': 1,
      'mod-reasoning-analogy': 1,
      'mod-reasoning-logic': 2,
      'mod-data': 2,
    };

    const migrated = migrateInputsBetweenPresets(guokao, yijiu, wrongInputs);
    expect(migrated).toEqual({
      'mod-yj-politics': 4,
      'mod-yj-commonsense': 6,
      'mod-yj-verbal': 5,
      'mod-yj-quant': 3,
      'mod-yj-graph': 2,
      'mod-yj-def': 1,
      'mod-yj-analogy': 1,
      'mod-yj-logic': 2,
      'mod-yj-data': 2,
    });

    const yijiuResult = calculateScore(yijiu, migrated, 'wrong');
    // 16*0.6(9.6) + 9*0.6(5.4) + 25*0.8(20) + 7*0.9(6.3) + (8+9+4+8)*0.8(23.2) + 18*0.9(16.2) = 80.7
    expect(yijiuResult.totalScore).toBe(80.7);
  });

  it('detects whether any non-zero input has been entered', () => {
    expect(hasEnteredInputs({})).toBe(false);
    expect(hasEnteredInputs({ a: 0, b: 0 })).toBe(false);
    expect(hasEnteredInputs({ a: 0, b: 3 })).toBe(true);
  });
});

describe('preset paper name builder', () => {
  it('builds partial or full paper names cleanly and keeps pinned regions', () => {
    expect(
      buildPresetPaperName({
        year: '2025',
        region: '国考',
        level: '地市级',
        paperType: '行测真题',
        index: '（一）',
      })
    ).toBe('2025年国考地市级行测真题（一）');

    expect(
      buildPresetPaperName({
        year: '',
        region: '河北省考',
        level: '',
        paperType: '行测模拟题',
        index: '',
      })
    ).toBe('河北省考行测模拟题');

    expect(PAPER_REGIONS_PINNED).toEqual(['国考', '河北省考', '天津市考', '北京市考']);
    expect(PAPER_REGIONS_ALPHA).toContain('黑龙江');
    expect(PAPER_REGIONS_ALPHA).toContain('浙江');
  });
});

describe('sha256HexFallback', () => {
  it('matches Web Crypto SHA-256 bit-for-bit across ASCII, UTF-8, and multi-block inputs', async () => {
    const samples = [
      '',
      'abc',
      'kafuneri::xingce-sync-v1::123456',
      '行测分数计算器::中文多字节测试::' + 'x'.repeat(200),
    ];

    // Verify known NIST vector for "abc" as an anchor
    expect(sha256HexFallback(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );

    for (const s of samples) {
      const bytes = new TextEncoder().encode(s);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const expected = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(sha256HexFallback(bytes)).toBe(expected);
    }
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

describe('siteConfig env parsing', () => {
  it('hides personal footer and top links when env vars are unset', () => {
    const cfg = getSiteConfig({});
    expect(cfg.topLinks).toEqual([]);
    expect(cfg.vercountEnabled).toBe(false);
    expect(cfg.hasFooter).toBe(false);
  });

  it('parses top links and beian fields cleanly', () => {
    expect(
      parseTopLinks('GitHub|https://github.com/test, BadEntry, Home|https://example.com')
    ).toEqual([
      { label: 'GitHub', url: 'https://github.com/test' },
      { label: 'Home', url: 'https://example.com' },
    ]);

    const cfg = getSiteConfig({
      VITE_TOP_LINKS: 'GitHub|https://github.com/test',
      VITE_VERCOUNT_SRC: 'https://vercount.example.com/js',
      VITE_MPS_BEIAN_TEXT: '京公网安备11000000000001',
      VITE_MPS_BEIAN_CODE: '11000000000001',
      VITE_ICP_BEIAN_TEXT: '京ICP备2025000001号',
    });

    expect(cfg.hasFooter).toBe(true);
    expect(cfg.vercountEnabled).toBe(true);
    expect(cfg.mpsBeianUrl).toContain('code=11000000000001');
    expect(cfg.icpBeianText).toBe('京ICP备2025000001号');
  });
});
