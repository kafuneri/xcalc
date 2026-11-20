/**
 * Shared AI analysis caller used by both EdgeOne Edge Functions (edge-functions/api/analyze.js)
 * and Vite local dev middleware (vite.config.ts).
 *
 * Server-mode fallback priority (when serverModel === 'auto'):
 *   1. Zhipu BigModel direct (open.bigmodel.cn, glm-4.7-flash with thinking disabled)
 *   2. Cloudflare Workers AI direct (@cf/google/gemma-4-26b-a4b-it with enable_thinking: false)
 *   3. EdgeOne Makers AI Gateway -> Google AI Studio ONLY (google/gemini-*, never @makers/*)
 *   4. Optional direct Google Gemini fallback only when EdgeOne Makers Gateway is not configured
 */

function buildSystemPrompt(examType) {
  const examName =
    examType === 'zhice'
      ? '事业单位联考《职业能力倾向测验》（职测，常见满分 150 分、限时 90 分钟，分 A/B/C/D/E 类）'
      : '公务员考试《行政职业能力测验》（行测，常见满分 100 分）';

  return [
    `你是一名经验丰富的公考与事业单位考试教研教练，本次分析对象为${examName}。`,
    '用户会提供一份已经由程序精确统计好的历史套卷摘要（包含总体均值、各模块/子模块正确率、平均失分、标准差波动以及最近几套试卷的备注）。',
    '请严格基于给出的数字进行分析，不要重新臆测或改算总分/正确率，并输出结构清晰、简洁务实的中文复盘建议（控制在 500~800 字内）：',
    '1. 【优势与基本盘】指出当前最稳的 1~2 个优势模块，说明考场如何保持。',
    '2. 【薄弱项与波动诊断】结合失分空间、提分优先级和标准差，指出最拖后腿或最不稳定的模块/子模块，结合试卷备注分析原因（如时间不足、题型卡壳、粗心等）。',
    '3. 【考场策略与下周训练处方】给出具体的做题顺序/时间分配微调建议，以及未来 7 天可落地的专项训练动作（明确抓大放小，不要建议在常识/政治理论死磕整块刷题）。',
    '输出格式要求：使用标准 Markdown 标题（###）与无序/有序列表，禁止使用 Markdown 表格（|---|）和 LaTeX 数学公式（如 $\\rightarrow$，请直接用 → 符号）。',
  ].join('\n');
}

export function buildAnalysisMessages(digest) {
  const examLabel = digest?.examType === 'zhice' ? '职测' : '行测';
  return {
    systemPrompt: buildSystemPrompt(digest?.examType),
    userPrompt: `以下是我近期的${examLabel}做题统计摘要（JSON）：\n${JSON.stringify(digest, null, 2)}`,
  };
}

function formatFetchError(err, timeoutMs, contextLabel) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    const wrapped = new Error(`${contextLabel} 请求超时（>${Math.round(timeoutMs / 1000)}秒）`);
    wrapped.status = 504;
    return wrapped;
  }
  const causeMsg = err?.cause?.code || err?.cause?.message || '';
  const baseMsg = err?.message || '网络请求失败';
  const fullMsg = causeMsg && !baseMsg.includes(causeMsg) ? `${baseMsg} (${causeMsg})` : baseMsg;
  const wrapped = new Error(`${contextLabel} 网络异常: ${fullMsg}`);
  wrapped.status = Number(err?.status) || 502;
  return wrapped;
}

function formatHttpError(status, rawText, contextLabel) {
  let parsed = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // non-JSON response
  }

  const cfErr = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
  const code = parsed?.error?.code ?? cfErr?.code ?? parsed?.code ?? '';
  const msg =
    parsed?.error?.message ||
    cfErr?.message ||
    parsed?.message ||
    parsed?.Message ||
    (rawText ? rawText.slice(0, 220).trim() : '') ||
    `HTTP ${status}`;

  const codeTag = code ? `, code=${code}` : '';
  const err = new Error(`${contextLabel} 失败 [HTTP ${status}${codeTag}]: ${msg}`);
  err.status = status;
  return err;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const finalParts = parts.filter((p) => !p.thought && typeof p.text === 'string');
  const chosen = finalParts.length > 0 ? finalParts : parts;
  return chosen
    .map((p) => p.text || '')
    .join('')
    .trim();
}

async function callGeminiModel({ apiKey, model, systemPrompt, userPrompt, timeoutMs = 18000 }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const contextLabel = `Gemini (${model})`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch (err) {
    throw formatFetchError(err, timeoutMs, contextLabel);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw formatHttpError(res.status, rawText, contextLabel);
  }

  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error(`${contextLabel} 返回非 JSON 响应`);
    err.status = 502;
    throw err;
  }

  const content = extractGeminiText(data);
  if (!content) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    const err = new Error(`${contextLabel} 返回正文为空 (finishReason=${finishReason})`);
    err.status = 502;
    throw err;
  }
  return { provider: 'gemini', model, content };
}

async function callOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  providerLabel,
  timeoutMs = 20000,
  maxTokens = 2048,
  extraBody = {},
}) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const endpoint = normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;
  const contextLabel = `${providerLabel || 'OpenAI'} (${model})`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...extraBody,
      }),
    });
  } catch (err) {
    throw formatFetchError(err, timeoutMs, contextLabel);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw formatHttpError(res.status, rawText, contextLabel);
  }

  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error(`${contextLabel} 返回非 JSON 响应`);
    err.status = 502;
    throw err;
  }

  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    const finishReason = data?.choices?.[0]?.finish_reason || 'unknown';
    const err = new Error(`${contextLabel} 返回正文为空 (finish_reason=${finishReason})`);
    err.status = 502;
    throw err;
  }
  return { provider: providerLabel || 'openai-compatible', model, content };
}

async function callGeminiWithFallback({ apiKey, systemPrompt, userPrompt }) {
  const candidates = [
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
  ];
  let lastError = null;

  for (const model of candidates) {
    try {
      return await callGeminiModel({ apiKey, model, systemPrompt, userPrompt });
    } catch (err) {
      lastError = err;
      const status = Number(err?.status) || 0;
      if (
        status !== 0 &&
        status !== 429 &&
        status !== 502 &&
        status !== 503 &&
        status !== 504 &&
        status !== 404
      ) {
        throw err;
      }
    }
  }
  throw lastError || new Error('Gemini 模型调用失败');
}

async function callMakersGoogleSingle({ baseUrl, apiKey, model, timeoutMs, systemPrompt, userPrompt }) {
  return callOpenAiCompatible({
    baseUrl: baseUrl || 'https://ai-gateway.edgeone.link/v1',
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    providerLabel: 'edgeone-makers-google',
    timeoutMs,
    maxTokens: 2048,
  });
}

async function callMakersGoogleFallback({ baseUrl, apiKey, systemPrompt, userPrompt }) {
  // Strictly target google/* models so bound Google AI Studio Key is used (never @makers/* free quota)
  const candidates = [
    { model: 'google/gemini-4-hydrogen', timeoutMs: 14000 },
    { model: 'google/gemini-3.8-flash', timeoutMs: 14000 },
    { model: 'google/gemini-3.6-flash', timeoutMs: 14000 },
    { model: 'google/gemini-3.5-flash-lite', timeoutMs: 20000 },
  ];
  const failures = [];

  for (const candidate of candidates) {
    try {
      return await callMakersGoogleSingle({
        baseUrl,
        apiKey,
        model: candidate.model,
        timeoutMs: candidate.timeoutMs,
        systemPrompt,
        userPrompt,
      });
    } catch (err) {
      failures.push(err?.message || candidate.model);
      const status = Number(err?.status) || 0;
      if (
        status !== 0 &&
        status !== 429 &&
        status !== 502 &&
        status !== 503 &&
        status !== 504 &&
        status !== 404
      ) {
        throw err;
      }
    }
  }
  const combined = new Error(failures.join(' | ') || 'EdgeOne Makers Gemini 网关调用失败');
  combined.status = 502;
  throw combined;
}

/**
 * Execute AI analysis using either BYOK headers or tiered/pinned server credentials.
 */
export async function runAiAnalysis({ digest, serverModel = 'auto', byok, serverEnv }) {
  const { systemPrompt, userPrompt } = buildAnalysisMessages(digest);

  if (byok?.mode === 'gemini-byok') {
    if (!byok.apiKey) {
      const err = new Error('请先填写你的 Gemini API Key');
      err.status = 400;
      throw err;
    }
    return callGeminiWithFallback({
      apiKey: byok.apiKey,
      systemPrompt,
      userPrompt,
    });
  }

  if (byok?.mode === 'openai-byok') {
    if (!byok.apiKey || !byok.baseUrl || !byok.model) {
      const err = new Error('请填写完整的 Base URL、Model 与 API Key');
      err.status = 400;
      throw err;
    }
    return callOpenAiCompatible({
      baseUrl: byok.baseUrl,
      apiKey: byok.apiKey,
      model: byok.model,
      systemPrompt,
      userPrompt,
      providerLabel: 'custom-openai',
      timeoutMs: 25000,
      maxTokens: 2048,
    });
  }

  const zhipuKey = (serverEnv?.ZHIPU_API_KEY || '').trim();
  const zhipuBase = (serverEnv?.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').trim();
  const cfAccountId = (serverEnv?.CF_ACCOUNT_ID || '').trim();
  const cfApiToken = (serverEnv?.CF_API_TOKEN || '').trim();
  const gatewayKey = (serverEnv?.AI_GATEWAY_API_KEY || '').trim();
  const gatewayBase = (serverEnv?.AI_GATEWAY_BASE_URL || 'https://ai-gateway.edgeone.link/v1').trim();
  const geminiKey = (serverEnv?.GEMINI_API_KEY || '').trim();

  const runZhipu = () => {
    if (!zhipuKey) {
      const err = new Error('服务端未配置 ZHIPU_API_KEY，无法直连智谱 glm-4.7-flash');
      err.status = 503;
      throw err;
    }
    return callOpenAiCompatible({
      baseUrl: zhipuBase,
      apiKey: zhipuKey,
      model: 'glm-4.7-flash',
      systemPrompt,
      userPrompt,
      providerLabel: 'zhipu',
      timeoutMs: 15000,
      maxTokens: 2048,
      extraBody: { thinking: { type: 'disabled' } },
    });
  };

  const runCloudflare = (timeoutMs = 28000) => {
    if (!cfAccountId || !cfApiToken) {
      const err = new Error('服务端未配置 CF_ACCOUNT_ID 或 CF_API_TOKEN，无法调用 Cloudflare Workers AI');
      err.status = 503;
      throw err;
    }
    return callOpenAiCompatible({
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccountId)}/ai/v1`,
      apiKey: cfApiToken,
      model: '@cf/google/gemma-4-26b-a4b-it',
      systemPrompt,
      userPrompt,
      providerLabel: 'cloudflare-workers-ai',
      timeoutMs,
      maxTokens: 2048,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });
  };

  const selected = String(serverModel || 'auto').trim();

  // Explicit single-model or single-tier selection (fail directly with real error, no cross-provider fallback)
  if (selected === 'zhipu:glm-4.7-flash') {
    return runZhipu();
  }
  if (selected === 'cf:@cf/google/gemma-4-26b-a4b-it') {
    return runCloudflare(45000);
  }
  if (selected === 'makers:auto') {
    if (!gatewayKey) {
      const err = new Error('服务端未配置 AI_GATEWAY_API_KEY，无法调用 EdgeOne Makers Gemini 网关');
      err.status = 503;
      throw err;
    }
    return callMakersGoogleFallback({
      baseUrl: gatewayBase,
      apiKey: gatewayKey,
      systemPrompt,
      userPrompt,
    });
  }
  if (selected.startsWith('makers:google/')) {
    if (!gatewayKey) {
      const err = new Error('服务端未配置 AI_GATEWAY_API_KEY，无法调用 EdgeOne Makers Gemini 网关');
      err.status = 503;
      throw err;
    }
    const targetModel = selected.slice('makers:'.length);
    return callMakersGoogleSingle({
      baseUrl: gatewayBase,
      apiKey: gatewayKey,
      model: targetModel,
      timeoutMs: 45000,
      systemPrompt,
      userPrompt,
    });
  }

  // Default 'auto': 1 -> 2 -> 3 fallback chain
  const hasCloudflare = Boolean(cfAccountId && cfApiToken);
  if (!zhipuKey && !hasCloudflare && !gatewayKey && !geminiKey) {
    const err = new Error('服务端未配置 AI 密钥，请切换为「自定义 API Key」或联系站点管理员配置环境变量。');
    err.status = 503;
    throw err;
  }

  const errors = [];

  if (zhipuKey) {
    try {
      return await runZhipu();
    } catch (err) {
      errors.push(err?.message || '智谱调用失败');
    }
  }

  if (hasCloudflare) {
    try {
      return await runCloudflare(28000);
    } catch (err) {
      errors.push(err?.message || 'Cloudflare AI 调用失败');
    }
  }

  if (gatewayKey) {
    try {
      return await callMakersGoogleFallback({
        baseUrl: gatewayBase,
        apiKey: gatewayKey,
        systemPrompt,
        userPrompt,
      });
    } catch (err) {
      errors.push(err?.message || 'Makers Gemini 调用失败');
    }
  }

  if (!gatewayKey && geminiKey) {
    try {
      return await callGeminiWithFallback({
        apiKey: geminiKey,
        systemPrompt,
        userPrompt,
      });
    } catch (err) {
      errors.push(err?.message || 'Gemini 直连调用失败');
    }
  }

  const finalErr = new Error(errors.join(' | ') || 'AI 分析服务暂不可用');
  finalErr.status = 502;
  throw finalErr;
}
