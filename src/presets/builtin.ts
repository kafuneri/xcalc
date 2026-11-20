import type { Preset } from '../types';

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'builtin-guokao-2025-130',
    name: '2025国考 · 地市级 / 行政执法',
    description:
      '按2025年国考改革后130题结构预设：政治理论独立单列20题，判断推理细分为图形、定义、类比、逻辑四项，总计100分。',
    builtIn: true,
    updatedAt: 1,
    modules: [
      {
        id: 'mod-politics',
        name: '政治理论',
        questionCount: 20,
        scorePerQuestion: 0.7,
      },
      {
        id: 'mod-commonsense',
        name: '常识判断',
        questionCount: 15,
        scorePerQuestion: 0.5,
      },
      {
        id: 'mod-verbal',
        name: '言语理解与表达',
        questionCount: 30,
        scorePerQuestion: 0.8,
      },
      {
        id: 'mod-quant',
        name: '数量关系',
        questionCount: 10,
        scorePerQuestion: 1.0,
      },
      {
        id: 'mod-reasoning',
        name: '判断推理',
        questionCount: 35,
        scorePerQuestion: 0,
        children: [
          {
            id: 'mod-reasoning-graph',
            name: '图形推理',
            questionCount: 10,
            scorePerQuestion: 0.6,
          },
          {
            id: 'mod-reasoning-def',
            name: '定义判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-reasoning-analogy',
            name: '类比推理',
            questionCount: 5,
            scorePerQuestion: 0.5,
          },
          {
            id: 'mod-reasoning-logic',
            name: '逻辑判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
        ],
      },
      {
        id: 'mod-data',
        name: '资料分析',
        questionCount: 20,
        scorePerQuestion: 1.0,
      },
    ],
  },
  {
    id: 'builtin-yijiu-130',
    name: '壹玖',
    description:
      '补习班简易估分模型（130题 · 100分）：政理/常识0.6，言语/判断(含图形/定义/类比/逻辑)0.8，数量/资料0.9。',
    builtIn: true,
    updatedAt: 1,
    modules: [
      {
        id: 'mod-yj-politics',
        name: '政治理论',
        questionCount: 20,
        scorePerQuestion: 0.6,
      },
      {
        id: 'mod-yj-commonsense',
        name: '常识判断',
        questionCount: 15,
        scorePerQuestion: 0.6,
      },
      {
        id: 'mod-yj-verbal',
        name: '言语理解与表达',
        questionCount: 30,
        scorePerQuestion: 0.8,
      },
      {
        id: 'mod-yj-quant',
        name: '数量关系',
        questionCount: 10,
        scorePerQuestion: 0.9,
      },
      {
        id: 'mod-yj-reasoning',
        name: '判断推理',
        questionCount: 35,
        scorePerQuestion: 0,
        children: [
          {
            id: 'mod-yj-graph',
            name: '图形推理',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-yj-def',
            name: '定义判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-yj-analogy',
            name: '类比推理',
            questionCount: 5,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-yj-logic',
            name: '逻辑判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
        ],
      },
      {
        id: 'mod-yj-data',
        name: '资料分析',
        questionCount: 20,
        scorePerQuestion: 0.9,
      },
    ],
  },
  {
    id: 'builtin-guokao-2025-135',
    name: '2025国考 · 副省级',
    description:
      '副省级试卷135题结构（数量关系15题），政治理论按0.6分、数量按0.8分平衡，合计100分。',
    builtIn: true,
    updatedAt: 1,
    modules: [
      {
        id: 'mod-135-politics',
        name: '政治理论',
        questionCount: 20,
        scorePerQuestion: 0.6,
      },
      {
        id: 'mod-135-commonsense',
        name: '常识判断',
        questionCount: 15,
        scorePerQuestion: 0.5,
      },
      {
        id: 'mod-135-verbal',
        name: '言语理解与表达',
        questionCount: 30,
        scorePerQuestion: 0.8,
      },
      {
        id: 'mod-135-quant',
        name: '数量关系',
        questionCount: 15,
        scorePerQuestion: 0.8,
      },
      {
        id: 'mod-135-reasoning',
        name: '判断推理',
        questionCount: 35,
        scorePerQuestion: 0,
        children: [
          {
            id: 'mod-135-graph',
            name: '图形推理',
            questionCount: 10,
            scorePerQuestion: 0.6,
          },
          {
            id: 'mod-135-def',
            name: '定义判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-135-analogy',
            name: '类比推理',
            questionCount: 5,
            scorePerQuestion: 0.5,
          },
          {
            id: 'mod-135-logic',
            name: '逻辑判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
        ],
      },
      {
        id: 'mod-135-data',
        name: '资料分析',
        questionCount: 20,
        scorePerQuestion: 1.0,
      },
    ],
  },
  {
    id: 'builtin-shengkao-120',
    name: '省考联考通用模板',
    description: '常见省考120题五大模块参考模板，支持一键复制后按本省实际题量修改。',
    builtIn: true,
    updatedAt: 1,
    modules: [
      {
        id: 'mod-120-commonsense',
        name: '常识判断',
        questionCount: 20,
        scorePerQuestion: 0.6,
      },
      {
        id: 'mod-120-verbal',
        name: '言语理解与表达',
        questionCount: 30,
        scorePerQuestion: 0.8,
      },
      {
        id: 'mod-120-quant',
        name: '数量关系',
        questionCount: 10,
        scorePerQuestion: 1.0,
      },
      {
        id: 'mod-120-reasoning',
        name: '判断推理',
        questionCount: 40,
        scorePerQuestion: 0,
        children: [
          {
            id: 'mod-120-graph',
            name: '图形推理',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-120-def',
            name: '定义判断',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-120-analogy',
            name: '类比推理',
            questionCount: 10,
            scorePerQuestion: 0.8,
          },
          {
            id: 'mod-120-logic',
            name: '逻辑判断',
            questionCount: 10,
            scorePerQuestion: 1.0,
          },
        ],
      },
      {
        id: 'mod-120-data',
        name: '资料分析',
        questionCount: 20,
        scorePerQuestion: 1.0,
      },
    ],
  },
];
