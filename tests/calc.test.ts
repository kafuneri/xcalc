import { describe, expect, it, vi } from 'vitest';
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
import {
  analyzeHistoryRecords,
  buildAiSummaryDigest,
  buildRecordsFingerprint,
} from '../src/core/analytics';
import { renderSafeMarkdown } from '../src/core/markdown';
import { mergeSyncPayloads } from '../shared/syncMerge.js';
import { runAiAnalysis, runAiAnalysisStream } from '../shared/aiAnalysis.js';

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
      { id: 'preset-2025hb-130', category: 'xingce', totalQuestions: 130, maxScore: 100 },
      { id: 'preset-2024hb-130', category: 'xingce', totalQuestions: 130, maxScore: 100 },
      { id: 'preset-2025tj-120', category: 'xingce', totalQuestions: 120, maxScore: 100 },
      { id: 'preset-2024tj-120', category: 'xingce', totalQuestions: 120, maxScore: 100 },
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
        region: '河北',
        level: '',
        paperType: '行测模拟题',
        index: '',
      })
    ).toBe('河北省考行测模拟题');

    expect(
      buildPresetPaperName({
        year: '2026',
        region: '北京',
        level: '',
        paperType: '行测真题',
        index: '',
      })
    ).toBe('2026年北京市考行测真题');

    expect(PAPER_REGIONS_PINNED).toEqual(['国考', '河北', '天津', '北京']);
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

describe('analytics engine (path 3 layer 1)', () => {
  it('aggregates across guokao and yijiu presets and prioritizes high-ROI weaknesses', () => {
    const guokao = BUILTIN_PRESETS.find((p) => p.id === 'preset-2025gk-ds-130')!;
    const yijiu = BUILTIN_PRESETS[0];

    const r1Inputs = {
      'mod-25ds-politics': 4,
      'mod-25ds-commonsense': 8, // weak commonsense (low ROI weight)
      'mod-25ds-verbal': 3, // strong verbal (90%)
      'mod-25ds-quant': 4,
      'sub-25ds-graph': 5, // weak graph (50%)
      'sub-25ds-def': 1,
      'sub-25ds-analogy': 0,
      'sub-25ds-logic': 2,
      'mod-25ds-data': 6, // weak data analysis (70%, highest ROI weight 1.35!)
    };
    const r2Inputs = {
      'mod-mwm5xsp6-05atn': 4,
      'mod-mwm5xsp6-t7c4o': 7,
      'mod-mwm5xsp6-ce9q8': 2,
      'mod-mwm5xsp6-33g8b': 4,
      'sub-mwm5xsp6-b39ik': 4,
      'sub-mwm5xsp6-5fbqp': 1,
      'sub-mwm5xsp6-qefnz': 0,
      'sub-mwm5xsp6-nk401': 2,
      'mod-mwm5xsp6-g4mo9': 5,
    };

    const records = [
      {
        id: 'rec-1',
        paperName: '2025年国考地市级行测真题',
        note: '资料分析最后没做完',
        examDate: '2026-11-10',
        createdAt: 1000,
        updatedAt: 1000,
        mode: 'wrong' as const,
        inputs: r1Inputs,
        presetSnapshot: guokao,
        result: calculateScore(guokao, r1Inputs, 'wrong'),
      },
      {
        id: 'rec-2',
        paperName: '2025年省考模拟（壹玖）',
        note: '图推卡住两题',
        examDate: '2026-11-15',
        createdAt: 2000,
        updatedAt: 2000,
        mode: 'wrong' as const,
        inputs: r2Inputs,
        presetSnapshot: yijiu,
        result: calculateScore(yijiu, r2Inputs, 'wrong'),
      },
    ];

    const report = analyzeHistoryRecords(records);
    expect(report.recordCount).toBe(2);
    // Verbal (91.7%) and Definition/Analogy should rank as strengths
    expect(report.strengths.map((s) => s.moduleName)).toContain('言语理解与表达');
    // Data analysis lost ~5.25 pts with 1.35 weight -> top priority
    expect(report.priorities[0].moduleName).toBe('资料分析');
    expect(report.leafModules.find((m) => m.moduleName === '图形推理')?.sampleCount).toBe(2);

    const fp = buildRecordsFingerprint(records, 'xingce');
    expect(fp).toContain('xingce::');
    expect(fp).toContain('rec-1:1000');
    expect(fp).toContain('rec-2:2000');

    const digest = buildAiSummaryDigest(report, records, 'xingce');
    expect(digest.examType).toBe('xingce');
    expect((digest.recentPapers as unknown[]).length).toBe(2);
    expect(getRecordExamCategory(records[0])).toBe('xingce');
  });

  it('infers zhice category and evaluates zhice presets cleanly', () => {
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
    const rec = {
      id: 'rec-zhice-1',
      paperName: '2025年事业单位联考D类职测真题',
      note: '策略选择失分偏多',
      examDate: '2026-11-19',
      createdAt: 3000,
      updatedAt: 3000,
      mode: 'wrong' as const,
      inputs: wrongInputs,
      presetSnapshot: { ...zhiceD, category: undefined },
      result: res,
    };
    expect(getRecordExamCategory(rec)).toBe('zhice');
    const report = analyzeHistoryRecords([rec]);
    expect(report.priorities[0].moduleName).toBe('策略选择');
  });
});

describe('renderSafeMarkdown', () => {
  it('renders headings, bold, lists, and escapes raw HTML against XSS', () => {
    const md = [
      '### 1. 【优势与基本盘】',
      '* **核心模块**：`言语理解` 很稳',
      '  * 子项说明',
      '1. **第一点**：保持节奏',
      '<script>alert(1)</script>',
    ].join('\n');

    const html = renderSafeMarkdown(md);
    expect(html).toContain('<h3>1. 【优势与基本盘】</h3>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>核心模块</strong>');
    expect(html).toContain('<code>言语理解</code>');
    expect(html).toContain('<ol>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('runAiAnalysis priority chain', () => {
  it('falls back Cloudflare Gemma-4 (network err) -> Makers Gemini 3.5 Lite (502) -> Zhipu', async () => {
    const calls: Array<{ url: string; model: string; body: Record<string, unknown> }> = [];
    const origFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      calls.push({ url: String(url), model: String(parsed.model || ''), body: parsed });

      if (String(url).includes('api.cloudflare.com')) {
        throw new Error('network unreachable');
      }
      if (String(url).includes('ai-gateway.edgeone.link')) {
        return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 502 });
      }
      if (String(url).includes('open.bigmodel.cn')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok from zhipu' } }] }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 500 });
    }) as typeof fetch;

    try {
      const res = await runAiAnalysis({
        digest: { examType: 'xingce', summary: {}, modules: [], recentPapers: [] },
        byok: { mode: 'server' },
        serverEnv: {
          ZHIPU_API_KEY: 'z-key',
          CF_ACCOUNT_ID: 'cf-acc',
          CF_API_TOKEN: 'cf-tok',
          AI_GATEWAY_API_KEY: 'gw-key',
        },
      });

      expect(res.provider).toBe('zhipu');
      expect(res.model).toBe('glm-4.7-flash');
      expect(res.content).toBe('ok from zhipu');
      expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(calls[2].body.thinking).toEqual({ type: 'disabled' });
      expect(calls.map((c) => c.model)).toEqual([
        '@cf/google/gemma-4-26b-a4b-it',
        'google/gemini-3.5-flash-lite',
        'glm-4.7-flash',
      ]);
      expect(calls.some((c) => c.model.startsWith('@makers/'))).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fails directly with real upstream error without fallback when serverModel is explicitly pinned', async () => {
    const origFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({ error: { code: '1305', message: '该模型当前访问量过大，请您稍后再试' } }),
        { status: 429 }
      );
    }) as typeof fetch;

    try {
      await expect(
        runAiAnalysis({
          digest: { examType: 'xingce', summary: {}, modules: [], recentPapers: [] },
          serverModel: 'zhipu:glm-4.7-flash',
          byok: { mode: 'server' },
          serverEnv: {
            ZHIPU_API_KEY: 'z-key',
            CF_ACCOUNT_ID: 'cf-acc',
            CF_API_TOKEN: 'cf-tok',
            AI_GATEWAY_API_KEY: 'gw-key',
          },
        })
      ).rejects.toThrow(/HTTP 429, code=1305.*该模型当前访问量过大/);
      expect(callCount).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('works cleanly when AbortSignal.timeout is unavailable (EdgeOne runtime compatibility)', async () => {
    const origFetch = globalThis.fetch;
    const origTimeoutFn = AbortSignal.timeout;

    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
    });
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit & { eo?: { timeoutSetting?: { readTimeout?: number } } }) => {
      expect(init?.eo?.timeoutSetting?.readTimeout).toBe(25000);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok without AbortSignal.timeout' } }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const res = await runAiAnalysis({
        digest: { examType: 'xingce', summary: {}, modules: [], recentPapers: [] },
        serverModel: 'zhipu:glm-4.7-flash',
        byok: { mode: 'server' },
        serverEnv: { ZHIPU_API_KEY: 'z-key' },
      });
      expect(res.provider).toBe('zhipu');
      expect(res.content).toBe('ok without AbortSignal.timeout');
    } finally {
      globalThis.fetch = origFetch;
      Object.defineProperty(AbortSignal, 'timeout', {
        value: origTimeoutFn,
        configurable: true,
      });
    }
  });

  it('streams SSE deltas cleanly across split chunks and falls back before first token', async () => {
    const origFetch = globalThis.fetch;
    const statuses: string[] = [];
    const deltas: string[] = [];
    let metaSeen: { provider: string; model: string } | null = null;

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('api.cloudflare.com')) {
        return new Response(JSON.stringify({ errors: [{ code: 7000, message: 'busy' }] }), {
          status: 503,
        });
      }
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(ctrl) {
          // Intentionally split a data: JSON line across two TCP chunks
          ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"### 复盘"}}]}\n\n'));
          ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"con'));
          ctrl.enqueue(enc.encode('tent":"报告"}}]}\n\ndata: [DONE]\n\n'));
          ctrl.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      });
    }) as typeof fetch;

    try {
      const res = await runAiAnalysisStream({
        digest: { examType: 'xingce', summary: {}, modules: [], recentPapers: [] },
        byok: { mode: 'server' },
        serverEnv: {
          ZHIPU_API_KEY: 'z-key',
          CF_ACCOUNT_ID: 'cf-acc',
          CF_API_TOKEN: 'cf-tok',
          AI_GATEWAY_API_KEY: 'gw-key',
        },
        onStatus: (msg) => statuses.push(msg),
        onMeta: (m) => {
          metaSeen = m;
        },
        onDelta: (d) => deltas.push(d),
      });

      expect(statuses.length).toBe(2);
      expect(metaSeen).toEqual({
        provider: 'edgeone-makers-google',
        model: 'google/gemini-3.5-flash-lite',
      });
      expect(deltas).toEqual(['### 复盘', '报告']);
      expect(res.content).toBe('### 复盘报告');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
