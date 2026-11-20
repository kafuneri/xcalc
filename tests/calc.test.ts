import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../src/presets/builtin';
import {
  calculateScore,
  convertInputsMode,
  getPresetTotals,
  getRecordExamCategory,
  hasEnteredInputs,
  inferExamCategory,
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
  it('sums exactly to 100 points for xingce and 150 points for zhice across all 10 built-in presets', () => {
    const totals = BUILTIN_PRESETS.map((p) => ({
      id: p.id,
      category: inferExamCategory(p),
      ...getPresetTotals(p),
    }));

    expect(totals).toEqual([
      { id: 'preset-mwm5xsp6-dgd6k', category: 'xingce', totalQuestions: 130, maxScore: 100 },
      { id: 'preset-2025gk-ds-130', category: 'xingce', totalQuestions: 130, maxScore: 100 },
      { id: 'preset-2025gk-fs-135', category: 'xingce', totalQuestions: 135, maxScore: 100 },
      { id: 'preset-2024gk-ds-130', category: 'xingce', totalQuestions: 130, maxScore: 100 },
      { id: 'preset-2024gk-fs-135', category: 'xingce', totalQuestions: 135, maxScore: 100 },
      { id: 'preset-sydw-a-100', category: 'zhice', totalQuestions: 100, maxScore: 150 },
      { id: 'preset-sydw-b-100', category: 'zhice', totalQuestions: 100, maxScore: 150 },
      { id: 'preset-sydw-c-100', category: 'zhice', totalQuestions: 100, maxScore: 150 },
      { id: 'preset-sydw-d-100', category: 'zhice', totalQuestions: 100, maxScore: 150 },
      { id: 'preset-sydw-e-100', category: 'zhice', totalQuestions: 100, maxScore: 150 },
    ]);
  });
});

describe('calculateScore', () => {
  const preset130 = BUILTIN_PRESETS.find((p) => p.id === 'preset-2025gk-ds-130')!;

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
      'mod-25ds-politics': 5,
      'mod-25ds-commonsense': 5,
      'mod-25ds-verbal': 4,
      'mod-25ds-quant': 3,
      'sub-25ds-graph': 2,
      'sub-25ds-def': 1,
      'sub-25ds-analogy': 1,
      'sub-25ds-logic': 2,
      'mod-25ds-data': 2,
    };

    const result = calculateScore(preset130, wrongInputs, 'wrong');
    expect(result.totalWrong).toBe(25);
    expect(result.totalCorrect).toBe(105);
    // lost: 5*0.65(3.25) + 5*0.5(2.5) + 4*0.8(3.2) + 3*1(3) + 2*0.7(1.4) + 1*0.75(0.75) + 1*0.6(0.6) + 2*0.8(1.6) + 2*1(2) = 18.3 -> 81.7
    expect(result.totalScore).toBe(81.7);

    const reasoning = result.modules.find((m) => m.moduleId === 'mod-25ds-reasoning');
    expect(reasoning?.questionCount).toBe(35);
    expect(reasoning?.correctCount).toBe(29);
    expect(reasoning?.wrongCount).toBe(6);
    expect(reasoning?.score).toBe(21.15);
    expect(reasoning?.children?.map((c) => c.score)).toEqual([5.6, 6.75, 2.4, 6.4]);
  });

  it('produces identical result after converting inputs from wrong to correct mode', () => {
    const wrongInputs = {
      'mod-25ds-politics': 4,
      'mod-25ds-verbal': 6,
      'sub-25ds-graph': 3,
      'mod-25ds-data': 1,
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
      { 'mod-25ds-politics': 999, 'mod-25ds-data': -5 },
      'wrong'
    );
    const politics = result.modules.find((m) => m.moduleId === 'mod-25ds-politics');
    const data = result.modules.find((m) => m.moduleId === 'mod-25ds-data');
    expect(politics?.wrongCount).toBe(20);
    expect(politics?.score).toBe(0);
    expect(data?.wrongCount).toBe(0);
    expect(data?.score).toBe(20);
  });

  it('preserves entered counts by module name when switching between guokao and yijiu', () => {
    const guokao = BUILTIN_PRESETS.find((p) => p.id === 'preset-2025gk-ds-130')!;
    const yijiu = BUILTIN_PRESETS[0];
    const wrongInputs = {
      'mod-25ds-politics': 4,
      'mod-25ds-commonsense': 6,
      'mod-25ds-verbal': 5,
      'mod-25ds-quant': 3,
      'sub-25ds-graph': 2,
      'sub-25ds-def': 1,
      'sub-25ds-analogy': 1,
      'sub-25ds-logic': 2,
      'mod-25ds-data': 2,
    };

    const migrated = migrateInputsBetweenPresets(guokao, yijiu, wrongInputs);
    expect(migrated).toEqual({
      'mod-mwm5xsp6-05atn': 4,
      'mod-mwm5xsp6-t7c4o': 6,
      'mod-mwm5xsp6-ce9q8': 5,
      'mod-mwm5xsp6-33g8b': 3,
      'sub-mwm5xsp6-b39ik': 2,
      'sub-mwm5xsp6-5fbqp': 1,
      'sub-mwm5xsp6-qefnz': 1,
      'sub-mwm5xsp6-nk401': 2,
      'mod-mwm5xsp6-g4mo9': 2,
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

describe('zhice preset evaluation & category inference', () => {
  it('infers zhice category and evaluates zhice D-class preset cleanly', () => {
    const zhiceD = BUILTIN_PRESETS.find((p) => p.id === 'preset-sydw-d-100')!;
    const wrongInputs = {
      'mod-sydwd-commonsense': 5,
      'sub-sydwd-cloze': 3,
      'sub-sydwd-reading': 2,
      'sub-sydwd-def': 1,
      'sub-sydwd-analogy': 2,
      'sub-sydwd-logic': 1,
      'sub-sydwd-quant': 2,
      'sub-sydwd-data': 1,
      'mod-sydwd-strategy': 5,
    };
    const res = calculateScore(zhiceD, wrongInputs, 'wrong');
    expect(res.maxScore).toBe(150);
    expect(res.totalQuestions).toBe(100);
    expect(
      getRecordExamCategory({
        paperName: '2025年事业单位联考D类职测真题',
        presetSnapshot: { ...zhiceD, category: undefined },
      })
    ).toBe('zhice');
  });
});
