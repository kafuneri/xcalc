import type {
  AnalysisReport,
  ExamCategory,
  HistoryRecord,
  ModuleAnalytics,
  ModuleResult,
  ModuleTierStatus,
} from '../types';
import { fromScaledInt, toScaledInt } from './calc';
import { getLocalDateString } from '../presets/paperName';

interface ModuleSample {
  correct: number;
  questions: number;
  score: number;
  maxScore: number;
  accuracy: number;
  isSubModule: boolean;
  parentName?: string;
}

interface ModuleProfileRule {
  weight: number;
  strengthMin: number;
  weaknessMax: number;
  targetAccuracy: number;
  strengthTip: string;
  weaknessTip: string;
  volatileTip: string;
  normalTip: string;
}

const DEFAULT_PROFILE: ModuleProfileRule = {
  weight: 1.0,
  strengthMin: 80,
  weaknessMax: 68,
  targetAccuracy: 80,
  strengthTip: '正确率稳定在高位，继续保持现有做题节奏。',
  weaknessTip: '失分偏多，建议梳理该模块高频考点与错题复盘。',
  volatileTip: '不同试卷表现波动较大，建议排查特定子题型或考场限时节奏。',
  normalTip: '整体表现中等，可通过限时训练稳步向 80% 以上提升。',
};

const MODULE_RULES: Array<{ match: RegExp; rule: ModuleProfileRule }> = [
  {
    match: /资料分析/,
    rule: {
      weight: 1.35,
      strengthMin: 85,
      weaknessMax: 75,
      targetAccuracy: 90,
      strengthTip: '资料分析基本盘很稳，注意继续把单篇耗时压缩到 6 分钟以内。',
      weaknessTip: '资料分析提分性价比最高：优先排查找数定位失误、时间/基期陷阱与截位速算精度，目标先冲 85%+。',
      volatileTip: '资料分析分数时高时低，通常因放在卷尾时间不足或复杂计算卡壳，建议调整到前中期作答并学会适当估算。',
      normalTip: '已具备一定计算基础，减少粗心看错单位/年份的“非智力失分”即可稳定上 85%。',
    },
  },
  {
    match: /逻辑判断/,
    rule: {
      weight: 1.25,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '逻辑推理严密，能稳定拿分，可适当提速为其他模块留时间。',
      weaknessTip: '重点复盘加强/削弱论证的“搭桥、他因、因果倒置”以及一拖多分析推理的排除法。',
      volatileTip: '逻辑判断受题干长度与一拖多分析题影响大，遇到复杂匹配题先用列表/代入排除，切忌硬推超时。',
      normalTip: '巩固翻译推理规则与常见论证模型，争取把正确率稳定在 80% 以上。',
    },
  },
  {
    match: /定义判断/,
    rule: {
      weight: 1.2,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '信息抓取准确，继续保持“只看关键要件、不自行脑补”的做题习惯。',
      weaknessTip: '练习用“主客体、条件、方式、结果”四要件勾画题干，遇到否定问法（不属于/不符合）做好标记。',
      volatileTip: '部分专业学科定义容易读偏，做题时严格对比选项与题干限定词，减少主观臆断。',
      normalTip: '可进一步加快阅读筛选速度，控制 10 题在 8 分钟左右完成。',
    },
  },
  {
    match: /图形推理/,
    rule: {
      weight: 1.2,
      strengthMin: 80,
      weaknessMax: 65,
      targetAccuracy: 85,
      strengthTip: '图推敏感度高，能快速识别考点特征，注意立体拼合/截面细节即可。',
      weaknessTip: '建议按“位置→样式→属性→数量→空间”固定口诀试错，单独专项突破对称、笔画与六面体折纸。',
      volatileTip: '图推规律命中靠熟练度：若单题超过 45 秒毫无头绪，果断先蒙一个并标记，避免拖垮整张卷子节奏。',
      normalTip: '每日保持 10~15 道图推手感题，重点积累一笔画与黑白块高频变形。',
    },
  },
  {
    match: /类比推理/,
    rule: {
      weight: 1.15,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '词项关系判断敏锐，解题速度快，是高效的稳分点。',
      weaknessTip: '注意二级辨析（词性、褒贬、主动被动、命名方式、材料与功能），国考减题后容错更低，需防粗心。',
      volatileTip: '类比看似简单但陷阱多，尤其近反义与交叉/包容关系易混，造句法验证后再选。',
      normalTip: '刷真题积累常识类与成语结构类高频考点，目标冲刺 85%+。',
    },
  },
  {
    match: /判断推理/,
    rule: {
      weight: 1.25,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '判断推理整体扎实，结合子模块细分结果可进一步抠出满分空间。',
      weaknessTip: '判断推理题量大、分值重，建议结合下方图形/定义/类比/逻辑细分数据，集中补最弱的一到两项。',
      volatileTip: '判断模块整体波动明显，建议固定内部作答顺序（如类比→定义→图推→逻辑）以稳住节奏。',
      normalTip: '整体处于中上区间，优先补齐子模块中最拖后腿的一项即可明显涨分。',
    },
  },
  {
    match: /言语理解|言语运用/,
    rule: {
      weight: 1.2,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '语感与主旨提炼扎实，继续保持对转折、递进与对策句的敏感度。',
      weaknessTip: '言语分值占比高：逻辑填空多积累高频实词/成语辨析与对应提示词；片段阅读抓行文脉络，警惕“无中生有/偷换概念”。',
      volatileTip: '言语波动多发生在二选一纠结时，建议先看清提问方式再回归原文结构，避免过度联想。',
      normalTip: '精做近 5 年真题并复盘二选一错因，争取从 75% 稳步迈向 83%+。',
    },
  },
  {
    match: /逻辑填空/,
    rule: {
      weight: 1.15,
      strengthMin: 80,
      weaknessMax: 68,
      targetAccuracy: 83,
      strengthTip: '语境对应与词义辨析准确，注意保持语感与答题速度。',
      weaknessTip: '优先抓语境提示（转折/并列/解释说明）和固定搭配，集中积累高频近义实词与成语辨析。',
      volatileTip: '二选一纠结耗时偏高时，先凭第一语感排除语义轻重或感情色彩不符选项。',
      normalTip: '每日复盘 10~15 道错题实词搭配，稳步向 80% 靠拢。',
    },
  },
  {
    match: /片段阅读|语句表达/,
    rule: {
      weight: 1.2,
      strengthMin: 80,
      weaknessMax: 70,
      targetAccuracy: 85,
      strengthTip: '主旨把握与行文结构分析清晰，属于稳定得分点。',
      weaknessTip: '先看设问再读文段，重点勾画关联词与尾句对策，严格对比选项中的偷换范围与无中生有。',
      volatileTip: '语句排序/衔接题易因细节漏看失分，先确定首尾句和指代词捆绑再验证。',
      normalTip: '限定单题在 50 秒内作答，保持文段脉络提炼精度。',
    },
  },
  {
    match: /数量关系|数学运算/,
    rule: {
      weight: 0.85,
      strengthMin: 70,
      weaknessMax: 40,
      targetAccuracy: 55,
      strengthTip: '数量/数学运算已是显著拉分优势项，能在考场稳拿高分。',
      weaknessTip: '不必追求全做：先死磕工程、经济利润、容斥、牛吃草、最值等 4~5 类送分母题，其余学会挑题或合理蒙猜（保底做对一半以上）。',
      volatileTip: '考场时间分配决定了数量发挥，固定预留 10~12 分钟专挑题干短、套路熟的送分题稳拿分。',
      normalTip: '数量基础不错，注意识别出题陷阱与代入排除提速，稳扎稳打抢分。',
    },
  },
  {
    match: /数量分析/,
    rule: {
      weight: 1.25,
      strengthMin: 80,
      weaknessMax: 65,
      targetAccuracy: 85,
      strengthTip: '数量分析得分稳健，能够在限时下兼顾计算速度与精度。',
      weaknessTip: '职测 B 类等试卷中数量分析单题分值高（常达 2+ 分/题）：优先保住资料分析类计算，再挑简单数学方法题拿下。',
      volatileTip: '考场 90 分钟节奏极紧，建议将数量分析安排在常识/言语之后、避免尾盘仓促丢分。',
      normalTip: '重点训练截位直除与常用增长/比重公式，向 80%+ 推进。',
    },
  },
  {
    match: /综合分析/,
    rule: {
      weight: 1.25,
      strengthMin: 80,
      weaknessMax: 65,
      targetAccuracy: 85,
      strengthTip: '综合分析信息整合与多题型迁移能力突出，能稳居高分区。',
      weaknessTip: '综合分析单题分值重，建议拆解薄弱环节（如 C 类中的策略制定、实验设计或资料处理），按小专题集中练透设问套路。',
      volatileTip: '题型切换容易导致思路卡壳，考场建议先做最熟悉的实验/资料题，把耗时偏长的策略运算后置。',
      normalTip: '复盘近几套真题的综合分析错因，区分“审题失误”与“方法不会”，优先拿满基础分。',
    },
  },
  {
    match: /策略选择/,
    rule: {
      weight: 1.25,
      strengthMin: 80,
      weaknessMax: 65,
      targetAccuracy: 85,
      strengthTip: '教育/医疗实务情境判断规范，符合岗位核心原则，是重要高分盘。',
      weaknessTip: '策略选择每题 2 分且极具提分性价比：紧扣岗位核心原则（教师关爱学生/家校沟通/循循善诱；医疗以患者安全/合规流程/人文沟通为先），对照真题标准答案校准价值观与处理顺序。',
      volatileTip: '避免仅凭个人日常经验作答，多复盘真题“最优解”排序逻辑，注意轻重缓急与职责边界。',
      normalTip: '梳理高频实务场景错题（沟通冲突、突发处置、隐私与合规），冲刺 85%+ 正确率。',
    },
  },
  {
    match: /政治理论/,
    rule: {
      weight: 0.7,
      strengthMin: 75,
      weaknessMax: 55,
      targetAccuracy: 75,
      strengthTip: '政治理论素养过硬，能够在新大纲下稳定拿分。',
      weaknessTip: '利用碎片时间系统梳理最新重要会议精神、方针政策及核心表述关键词，侧重理解性对比而非死记硬背。',
      volatileTip: '政治理论受当年时政热点覆盖影响较大，考前一个月集中过一遍权威高频专题梳理。',
      normalTip: '保持每天 10~15 分钟时政与理论原文阅读即可，避免挤占资料/判断的大量刷题时间。',
    },
  },
  {
    match: /常识判断/,
    rule: {
      weight: 0.45,
      strengthMin: 65,
      weaknessMax: 45,
      targetAccuracy: 60,
      strengthTip: '知识面广，常识模块已超过平均水准。',
      weaknessTip: '常识覆盖面极广、短期投入产出比偏低，不建议花整块时间死背；重点过一遍高频法律（行政法/民法）与科技生活常识即可，考场控制在 6~8 分钟快速过完。',
      volatileTip: '常识本身随机性高，做题时第一直觉作答即可，切忌反复纠结浪费核心模块时间。',
      normalTip: '常识保持正常水平即可，把省下的复习精力优先投入资料分析与判断推理。',
    },
  },
];

function findRule(moduleName: string): ModuleProfileRule {
  for (const entry of MODULE_RULES) {
    if (entry.match.test(moduleName)) return entry.rule;
  }
  return DEFAULT_PROFILE;
}

function normalizeModuleName(name: string): string {
  return name.trim();
}

function getRecordDateKey(rec: HistoryRecord): string {
  return rec.examDate || getLocalDateString(rec.createdAt);
}

function sortRecordsChronologically(records: HistoryRecord[]): HistoryRecord[] {
  return [...records]
    .filter((r) => !r.deletedAt)
    .sort((a, b) => {
      const dateCmp = getRecordDateKey(a).localeCompare(getRecordDateKey(b));
      if (dateCmp !== 0) return dateCmp;
      return a.createdAt - b.createdAt;
    });
}

function computeStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeTrendDelta(values: number[]): number | null {
  if (values.length < 2) return null;
  if (values.length < 4) {
    return values[values.length - 1] - values[0];
  }
  if (values.length < 6) {
    const recentSlice = values.slice(-2);
    const prevSlice = values.slice(0, -2);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;
    const prevAvg = prevSlice.reduce((a, b) => a + b, 0) / prevSlice.length;
    return recentAvg - prevAvg;
  }
  const recentSlice = values.slice(-3);
  const prevSlice = values.slice(-6, -3);
  const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;
  const prevAvg = prevSlice.reduce((a, b) => a + b, 0) / prevSlice.length;
  return recentAvg - prevAvg;
}

function collectRecordSamples(
  mod: ModuleResult,
  leafMap: Map<string, ModuleSample[]>,
  parentMap: Map<string, ModuleSample[]>,
  parentName?: string
): void {
  const name = normalizeModuleName(mod.moduleName);
  const hasChildren = Array.isArray(mod.children) && mod.children.length > 0;
  const sample: ModuleSample = {
    correct: mod.correctCount,
    questions: mod.questionCount,
    score: mod.score,
    maxScore: mod.maxScore,
    accuracy: mod.accuracy,
    isSubModule: Boolean(parentName),
    parentName,
  };

  if (hasChildren) {
    const arr = parentMap.get(name) || [];
    arr.push(sample);
    parentMap.set(name, arr);
    for (const child of mod.children!) {
      collectRecordSamples(child, leafMap, parentMap, name);
    }
  } else {
    const arr = leafMap.get(name) || [];
    arr.push(sample);
    leafMap.set(name, arr);
  }
}

function buildModuleAnalytics(
  moduleName: string,
  samples: ModuleSample[]
): ModuleAnalytics {
  const sampleCount = samples.length;
  let totalQuestions = 0;
  let totalCorrect = 0;
  let scoreScaledSum = 0;
  let maxScoreScaledSum = 0;

  for (const s of samples) {
    totalQuestions += s.questions;
    totalCorrect += s.correct;
    scoreScaledSum += toScaledInt(s.score);
    maxScoreScaledSum += toScaledInt(s.maxScore);
  }

  const accuracies = samples.map((s) => s.accuracy);
  const avgAccuracy =
    totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
  const avgScore = fromScaledInt(Math.round(scoreScaledSum / sampleCount));
  const avgMaxScore = fromScaledInt(Math.round(maxScoreScaledSum / sampleCount));
  const avgLostScore = Math.max(
    0,
    fromScaledInt(toScaledInt(avgMaxScore) - toScaledInt(avgScore))
  );

  const minAccuracy = Math.min(...accuracies);
  const maxAccuracy = Math.max(...accuracies);
  const stdDevAccuracy = computeStdDev(accuracies);
  const latestAccuracy = accuracies[accuracies.length - 1];
  const trendDelta = computeTrendDelta(accuracies);

  const rule = findRule(moduleName);
  const recoverableScore = Math.max(
    0,
    Math.round(((rule.targetAccuracy - avgAccuracy) / 100) * avgMaxScore * 100) / 100
  );
  const priorityScore =
    Math.round(recoverableScore * rule.weight * 100) / 100;

  const avgQuestions = sampleCount > 0 ? totalQuestions / sampleCount : 0;
  const volatileThreshold = avgQuestions <= 5 ? 16 : avgQuestions <= 10 ? 12 : 10;
  const isVolatile = sampleCount >= 3 && stdDevAccuracy >= volatileThreshold;

  let status: ModuleTierStatus = 'normal';
  let baseAdvice = rule.normalTip;

  if (avgAccuracy >= rule.strengthMin) {
    status = 'strength';
    baseAdvice = rule.strengthTip;
  } else if (avgAccuracy < rule.weaknessMax) {
    status = 'weakness';
    baseAdvice = rule.weaknessTip;
  }

  let trendPrefix = '';
  if (sampleCount >= 2) {
    const latestDiff = latestAccuracy - avgAccuracy;
    if (latestDiff <= -10) {
      trendPrefix = `【近期滑坡】最新降至 ${latestAccuracy.toFixed(1)}%（低于均值 ${Math.abs(latestDiff).toFixed(1)}%），建议优先排查耗时或粗心；`;
    } else if (latestDiff >= 10) {
      trendPrefix = `【近期回暖】最新已升至 ${latestAccuracy.toFixed(1)}%（高于均值 ${latestDiff.toFixed(1)}%），继续稳住手感；`;
    }
  }

  const ruleAdvice = isVolatile
    ? `${trendPrefix}${baseAdvice}（波动提示：${rule.volatileTip}）`
    : `${trendPrefix}${baseAdvice}`;

  return {
    moduleName,
    isSubModule: Boolean(samples[0]?.isSubModule),
    parentName: samples.find((s) => s.parentName)?.parentName,
    sampleCount,
    totalQuestions,
    totalCorrect,
    avgAccuracy,
    avgScore,
    avgMaxScore,
    avgLostScore,
    minAccuracy,
    maxAccuracy,
    stdDevAccuracy,
    latestAccuracy,
    trendDelta,
    controllabilityWeight: rule.weight,
    targetAccuracy: rule.targetAccuracy,
    recoverableScore,
    priorityScore,
    isVolatile,
    status,
    ruleAdvice,
  };
}

export function analyzeHistoryRecords(records: HistoryRecord[]): AnalysisReport {
  const ordered = sortRecordsChronologically(records);
  if (ordered.length === 0) {
    return {
      recordCount: 0,
      avgScore: 0,
      bestScore: 0,
      latestScore: 0,
      avgAccuracy: 0,
      recentScoreDelta: null,
      leafModules: [],
      parentModules: [],
      strengths: [],
      priorities: [],
    };
  }

  const scores = ordered.map((r) => r.result.totalScore);
  const accuracies = ordered.map((r) => r.result.accuracy);
  const scoreScaledSum = scores.reduce((sum, s) => sum + toScaledInt(s), 0);

  const avgScore = fromScaledInt(Math.round(scoreScaledSum / ordered.length));
  const bestScore = Math.max(...scores);
  const latestScore = scores[scores.length - 1];
  const avgAccuracy =
    accuracies.reduce((sum, a) => sum + a, 0) / ordered.length;
  const recentScoreDelta = computeTrendDelta(scores);

  const leafMap = new Map<string, ModuleSample[]>();
  const parentMap = new Map<string, ModuleSample[]>();

  for (const rec of ordered) {
    for (const mod of rec.result.modules) {
      collectRecordSamples(mod, leafMap, parentMap);
    }
  }

  const leafModules = Array.from(leafMap.entries()).map(([name, samples]) =>
    buildModuleAnalytics(name, samples)
  );
  const parentModules = Array.from(parentMap.entries()).map(([name, samples]) =>
    buildModuleAnalytics(name, samples)
  );

  const strengths = [...leafModules]
    .filter((m) => m.status === 'strength')
    .sort((a, b) => b.avgAccuracy - a.avgAccuracy);

  // If no module strictly hits strength threshold (e.g. beginner stage), surface top 2 by accuracy
  const finalStrengths =
    strengths.length > 0
      ? strengths
      : [...leafModules]
          .sort((a, b) => b.avgAccuracy - a.avgAccuracy)
          .slice(0, 2);

  const recoverablePriorities = [...leafModules]
    .filter((m) => m.recoverableScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const priorities =
    recoverablePriorities.length > 0
      ? recoverablePriorities
      : [...leafModules]
          .filter((m) => m.avgLostScore > 0)
          .sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    recordCount: ordered.length,
    avgScore,
    bestScore,
    latestScore,
    avgAccuracy,
    recentScoreDelta,
    leafModules,
    parentModules,
    strengths: finalStrengths,
    priorities,
  };
}

/**
 * Deterministic fingerprint for the current active history records so cached AI reports
 * stay valid until the user adds, edits, or deletes a record.
 */
export function buildRecordsFingerprint(
  records: HistoryRecord[],
  examCategory: ExamCategory = 'xingce'
): string {
  const ordered = sortRecordsChronologically(records);
  const recPart = ordered
    .map((r) => `${r.id}:${r.updatedAt}:${r.result.totalScore}`)
    .join('|');
  return `${examCategory}::${recPart}`;
}

/**
 * Build a compact structured summary (typically < 600 tokens) for AI depth commentary.
 */
export function buildAiSummaryDigest(
  report: AnalysisReport,
  records: HistoryRecord[],
  examCategory: ExamCategory = 'xingce'
): Record<string, unknown> {
  const ordered = sortRecordsChronologically(records);
  const recentRecords = ordered.slice(-8).map((r) => ({
    date: getRecordDateKey(r),
    paper: r.paperName,
    preset: r.presetSnapshot.name,
    score: r.result.totalScore,
    maxScore: r.result.maxScore,
    accuracy: Number(r.result.accuracy.toFixed(1)),
    note: r.note ? r.note.slice(0, 120) : '',
  }));

  return {
    examType: examCategory,
    examLabel: examCategory === 'zhice' ? '事业单位联考《职测》（满分150分·90分钟）' : '公考《行测》（满分100分）',
    summary: {
      recordCount: report.recordCount,
      avgScore: report.avgScore,
      bestScore: report.bestScore,
      latestScore: report.latestScore,
      avgAccuracy: Number(report.avgAccuracy.toFixed(1)),
      recentScoreDelta:
        report.recentScoreDelta === null
          ? null
          : Number(report.recentScoreDelta.toFixed(2)),
    },
    modules: report.leafModules.map((m) => ({
      name: m.parentName ? `${m.parentName}-${m.moduleName}` : m.moduleName,
      samples: m.sampleCount,
      avgAccuracy: Number(m.avgAccuracy.toFixed(1)),
      avgScore: m.avgScore,
      avgMaxScore: m.avgMaxScore,
      avgLostScore: m.avgLostScore,
      stdDev: Number(m.stdDevAccuracy.toFixed(1)),
      latestAccuracy: Number(m.latestAccuracy.toFixed(1)),
      targetAccuracy: m.targetAccuracy,
      recoverableScore: m.recoverableScore,
      isVolatile: m.isVolatile,
      status: m.status,
      priorityScore: m.priorityScore,
    })),
    recentPapers: recentRecords,
  };
}
