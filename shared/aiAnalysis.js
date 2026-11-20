/**
 * Shared AI analysis caller used by both EdgeOne Edge Functions (edge-functions/api/analyze.js)
 * and Vite local dev middleware (vite.config.ts).
 *
 * Server-mode fallback priority (when serverModel === 'auto'):
 *   1. Cloudflare Workers AI direct (@cf/google/gemma-4-26b-a4b-it with enable_thinking: false, 5s TTFB)
 *   2. EdgeOne Makers AI Gateway -> google/gemini-3.5-flash-lite (10s TTFB, never @makers/*)
 *   3. NVIDIA NIM direct (nvidia/nemotron-3.5-super-vl-120b-a12b with enable_thinking: false, 3s TTFB)
 *   4. Zhipu BigModel direct (open.bigmodel.cn, glm-4.7-flash with thinking disabled)
 *   5. Optional direct Google Gemini fallback only when EdgeOne Makers Gateway is not configured
 */

function buildSystemPrompt(examType) {
  const isZhice = examType === 'zhice';
  const examName = isZhice
    ? '事业单位联考《职业能力倾向测验》（职测，满分 150 分，限时 90 分钟）'
    : '公务员考试《行政职业能力测验》（行测，满分 100 分，限时 120 分钟）';
  const timeBudget = isZhice ? '90 分钟' : '120 分钟';

  return [
    `你是公考与事业单位考试教研教练，本次分析对象为${examName}。`,
    '用户提供的 JSON 是程序精确统计的历史摘要。请按以下 3 个小节输出中文复盘，每小节均用列表分点表达：',
    '',
    '### 一、整体走势与优势基本盘（约 180 字）',
    '- 先说明近期总分走势（结合最高分、均分、最新分与近期分差）。',
    '- 指出最稳的 2~3 个优势模块/子模块（如资料分析、言语、逻辑判断等高正确率项）及考场稳分要点。',
    '',
    '### 二、薄弱项与波动诊断（约 250 字）',
    '- 按平均失分与提分优先级指出最拖后腿的薄弱项，按标准差指出波动最大的子模块。',
    '- 对比各模块“最新正确率”与“平均正确率”，点出近期明显滑坡的模块。',
    '- 若有试卷备注则结合备注归因；若备注为空，只需简短注明“暂无试卷备注”，仅基于同步走弱的模块做审慎判断。',
    '',
    '### 三、考场策略与 7 天训练处方（约 320 字）',
    `- 做题顺序与时间分配：将资料分析、言语、判断优势项等高性价比模块放在前中段大脑清醒时完成；数量关系放后段抓高频基础题（工程/行程/利润/方程等）并设单题超时线；各模块用时加 3~5 分钟涂卡，总计贴合 ${timeBudget}。`,
    '- 未来 7 天训练动作：分项给出具体题量或天数安排；常识与政治理论仅用碎片时间过高频考点，不要建议整块死磕刷题。',
    '',
    '【硬性约束】',
    '1. 严格使用 JSON 中的原始数字（可保留 1 位小数），禁止改算总分或正确率。',
    '2. 正文全程用自然中文表达，禁止出现任何 JSON 英文键名（如 avgAccuracy、stdDev、recentScoreDelta）或照抄上述要求。',
    '3. 全文控制在 600~900 字并完整收尾；只用 ### 标题和 - / 1. 列表，禁止使用 Markdown 表格（|---|）和 LaTeX 符号（严禁出现 \\rightarrow 或 $），箭头一律用 →。',
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

function buildFetchInit(options, timeoutMs, controller) {
  const eoTimeout = {
    connectTimeout: Math.min(10000, timeoutMs),
    readTimeout: timeoutMs,
    writeTimeout: Math.max(60000, timeoutMs),
  };
  return {
    ...options,
    eo: {
      ...(options.eo || {}),
      timeoutSetting: eoTimeout,
    },
    ...(controller ? { signal: controller.signal } : {}),
  };
}

/**
 * EdgeOne Edge Functions runtime lacks AbortSignal.timeout(), so use
 * standard AbortController + setTimeout race wrapped around fetch + res.text().
 */
async function fetchTextWithTimeout(url, options, timeoutMs, contextLabel) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timerId = null;

  const fetchPromise = (async () => {
    const res = await fetch(url, buildFetchInit(options, timeoutMs, controller));
    const rawText = await res.text();
    return { res, rawText };
  })();

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (err) {
    throw formatFetchError(err, timeoutMs, contextLabel);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

function formatHttpError(status, rawText, contextLabel) {
  let parsed = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // non-JSON response
  }

  const trimmed = (rawText || '').trim();
  const isHtml = /^<!doctype|^<html/i.test(trimmed);
  let fallbackSnippet = trimmed ? trimmed.slice(0, 220) : '';
  if (isHtml) {
    const titleMatch = trimmed.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'HTML Error';
    fallbackSnippet =
      status === 504
        ? `${title} 网关读取上游响应超时 (HTTP 504)`
        : `${title} 返回了非 JSON 错误页 (HTTP ${status})`;
  }

  const cfErr = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
  const code = parsed?.error?.code ?? cfErr?.code ?? parsed?.code ?? '';
  const msg =
    parsed?.error?.message ||
    cfErr?.message ||
    parsed?.message ||
    parsed?.Message ||
    fallbackSnippet ||
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

function extractGeminiDelta(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

async function consumeSseStream(
  res,
  { firstTokenTimeoutMs, timeoutMs, contextLabel, extractDelta, onFirstToken, onDelta }
) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const raw = await res.text();
    const err = new Error(`${contextLabel} 未返回可读流响应`);
    err.status = 502;
    if (raw) err.raw = raw;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let fullContent = '';
  let committed = false;

  const readChunkWithIdleTimeout = () => {
    const activeTimeout = committed ? timeoutMs : (firstTokenTimeoutMs || timeoutMs);
    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        try {
          reader.cancel();
        } catch {
          // ignore
        }
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        err.activeTimeout = activeTimeout;
        reject(err);
      }, activeTimeout);
    });
    return Promise.race([reader.read(), timeoutPromise]).finally(() => {
      if (timerId !== null) clearTimeout(timerId);
    });
  };

  const processLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr || payloadStr === '[DONE]') return;

    let chunkObj;
    try {
      chunkObj = JSON.parse(payloadStr);
    } catch {
      return;
    }

    if (chunkObj?.error) {
      const msg = chunkObj.error.message || JSON.stringify(chunkObj.error);
      const err = new Error(`${contextLabel} 流式错误: ${msg}`);
      err.status = 502;
      err.committed = committed;
      throw err;
    }

    const delta = extractDelta(chunkObj);
    if (typeof delta === 'string' && delta.length > 0) {
      if (!committed) {
        committed = true;
        onFirstToken?.();
      }
      fullContent += delta;
      onDelta?.(delta);
    }
  };

  try {
    while (true) {
      let readResult;
      try {
        readResult = await readChunkWithIdleTimeout();
      } catch (err) {
        const formatted = formatFetchError(
          err,
          err?.activeTimeout || timeoutMs,
          contextLabel
        );
        formatted.committed = committed;
        throw formatted;
      }

      const { done, value } = readResult;
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }

    lineBuffer += decoder.decode();
    if (lineBuffer.trim()) {
      processLine(lineBuffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const trimmed = fullContent.trim();
  if (!trimmed) {
    const err = new Error(`${contextLabel} 流式返回正文为空`);
    err.status = 502;
    err.committed = committed;
    throw err;
  }

  return trimmed;
}

async function invokeGeminiTarget(target, { systemPrompt, userPrompt, stream, onMeta, onDelta }) {
  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const baseUrl = (target.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/models/${encodeURIComponent(target.model)}:${action}`;
  const contextLabel = `Gemini (${target.model})`;
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': target.apiKey,
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
  };

  if (!stream) {
    const { res, rawText } = await fetchTextWithTimeout(
      endpoint,
      requestOptions,
      target.timeoutMs,
      contextLabel
    );
    if (!res.ok) throw formatHttpError(res.status, rawText, contextLabel);

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
    return { provider: target.provider, model: target.model, content };
  }

  const initTimeoutMs = target.firstTokenTimeoutMs || target.timeoutMs;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let initTimer = null;
  let res;
  try {
    res = await Promise.race([
      fetch(endpoint, buildFetchInit(requestOptions, target.timeoutMs, controller)),
      new Promise((_, reject) => {
        initTimer = setTimeout(() => {
          if (controller) {
            try {
              controller.abort();
            } catch {
              // ignore
            }
          }
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        }, initTimeoutMs);
      }),
    ]);
  } catch (err) {
    throw formatFetchError(err, initTimeoutMs, contextLabel);
  } finally {
    if (initTimer !== null) clearTimeout(initTimer);
  }

  const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
  if (!res.ok) {
    const rawText = await res.text();
    throw formatHttpError(res.status, rawText, contextLabel);
  }

  if (!contentType.includes('text/event-stream')) {
    const rawText = await res.text();
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
      const err = new Error(`${contextLabel} 返回正文为空`);
      err.status = 502;
      throw err;
    }
    onMeta?.({ provider: target.provider, model: target.model });
    onDelta?.(content);
    return { provider: target.provider, model: target.model, content };
  }

  const content = await consumeSseStream(res, {
    firstTokenTimeoutMs: target.firstTokenTimeoutMs,
    timeoutMs: target.timeoutMs,
    contextLabel,
    extractDelta: extractGeminiDelta,
    onFirstToken: () => onMeta?.({ provider: target.provider, model: target.model }),
    onDelta,
  });
  return { provider: target.provider, model: target.model, content };
}

async function invokeOpenAiTarget(target, { systemPrompt, userPrompt, stream, onMeta, onDelta }) {
  const normalizedBase = target.baseUrl.replace(/\/+$/, '');
  const endpoint = normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;
  const contextLabel = `${target.provider} (${target.model})`;
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      model: target.model,
      temperature: 0.4,
      max_tokens: target.maxTokens || 2048,
      stream: Boolean(stream),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(target.extraBody || {}),
    }),
  };

  if (!stream) {
    const { res, rawText } = await fetchTextWithTimeout(
      endpoint,
      requestOptions,
      target.timeoutMs,
      contextLabel
    );
    if (!res.ok) throw formatHttpError(res.status, rawText, contextLabel);

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
    return { provider: target.provider, model: target.model, content };
  }

  const initTimeoutMs = target.firstTokenTimeoutMs || target.timeoutMs;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let initTimer = null;
  let res;
  try {
    res = await Promise.race([
      fetch(endpoint, buildFetchInit(requestOptions, target.timeoutMs, controller)),
      new Promise((_, reject) => {
        initTimer = setTimeout(() => {
          if (controller) {
            try {
              controller.abort();
            } catch {
              // ignore
            }
          }
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        }, initTimeoutMs);
      }),
    ]);
  } catch (err) {
    throw formatFetchError(err, initTimeoutMs, contextLabel);
  } finally {
    if (initTimer !== null) clearTimeout(initTimer);
  }

  const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
  if (!res.ok) {
    const rawText = await res.text();
    throw formatHttpError(res.status, rawText, contextLabel);
  }

  if (!contentType.includes('text/event-stream')) {
    const rawText = await res.text();
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
    onMeta?.({ provider: target.provider, model: target.model });
    onDelta?.(content);
    return { provider: target.provider, model: target.model, content };
  }

  const content = await consumeSseStream(res, {
    firstTokenTimeoutMs: target.firstTokenTimeoutMs,
    timeoutMs: target.timeoutMs,
    contextLabel,
    extractDelta: (chunk) => {
      const val = chunk?.choices?.[0]?.delta?.content;
      return typeof val === 'string' ? val : '';
    },
    onFirstToken: () => onMeta?.({ provider: target.provider, model: target.model }),
    onDelta,
  });
  return { provider: target.provider, model: target.model, content };
}

function parsePositiveMs(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function parseJsonObj(val) {
  if (!val || typeof val !== 'string') return undefined;
  try {
    const parsed = JSON.parse(val);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveNumberedSlots(serverEnv) {
  const slots = [];
  for (let i = 1; i <= 10; i++) {
    const baseUrl = (serverEnv?.[`AI_${i}_BASE_URL`] || '').trim();
    const apiKey = (serverEnv?.[`AI_${i}_API_KEY`] || '').trim();
    const model = (serverEnv?.[`AI_${i}_MODEL`] || '').trim();
    if (!baseUrl || !apiKey || !model) continue;
    const firstTokenTimeoutMs = parsePositiveMs(serverEnv?.[`AI_${i}_FIRST_TOKEN_MS`], 10000);
    const timeoutMs = parsePositiveMs(serverEnv?.[`AI_${i}_TIMEOUT_MS`], 25000);
    const extraBody = parseJsonObj(serverEnv?.[`AI_${i}_EXTRA_BODY`]);
    const label = (serverEnv?.[`AI_${i}_LABEL`] || '').trim() || `${i}. ${model}`;
    slots.push({
      slotIndex: i,
      slotValue: `slot:${i}`,
      kind: 'openai',
      provider: `ai-${i}`,
      baseUrl,
      apiKey,
      model,
      firstTokenTimeoutMs,
      timeoutMs,
      maxTokens: 2048,
      ...(extraBody ? { extraBody } : {}),
      label,
    });
  }
  return slots;
}

export function listPublicServerSlots(serverEnv) {
  const numbered = resolveNumberedSlots(serverEnv);
  if (numbered.length > 0) {
    return numbered.map((s) => ({
      value: s.slotValue,
      index: s.slotIndex,
      model: s.model,
      label: s.label,
      firstTokenMs: s.firstTokenTimeoutMs,
    }));
  }
  try {
    const { targets } = buildTargetPlan({ serverModel: 'auto', serverEnv });
    return targets.map((t, idx) => ({
      value: `slot:${idx + 1}`,
      index: idx + 1,
      model: t.model,
      label: t.label || `${idx + 1}. ${t.model}`,
      firstTokenMs: t.firstTokenTimeoutMs || t.timeoutMs || 10000,
    }));
  } catch {
    return [];
  }
}

function buildTargetPlan({ serverModel = 'auto', byok, serverEnv }) {
  if (byok?.mode === 'gemini-byok') {
    if (!byok.apiKey || !byok.model) {
      const err = new Error('请先填写 Gemini 的 Model 与 API Key');
      err.status = 400;
      throw err;
    }
    const baseUrl = (byok.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').trim();
    return {
      stopOnNonRetriable: false,
      targets: [
        {
          kind: 'gemini',
          provider: 'gemini',
          baseUrl,
          model: byok.model.trim(),
          apiKey: byok.apiKey.trim(),
          timeoutMs: 25000,
          label: `Gemini (${byok.model.trim()})`,
        },
      ],
    };
  }

  if (byok?.mode === 'openai-byok') {
    if (!byok.apiKey || !byok.baseUrl || !byok.model) {
      const err = new Error('请填写完整的 Base URL、Model 与 API Key');
      err.status = 400;
      throw err;
    }
    return {
      stopOnNonRetriable: false,
      targets: [
        {
          kind: 'openai',
          provider: 'custom-openai',
          baseUrl: byok.baseUrl,
          apiKey: byok.apiKey,
          model: byok.model,
          timeoutMs: 25000,
          maxTokens: 2048,
          label: `自定义接口 (${byok.model})`,
        },
      ],
    };
  }

  const parseMs = parsePositiveMs;
  const numberedTargets = resolveNumberedSlots(serverEnv);
  const selectedSlot = String(serverModel || 'auto').trim();

  if (selectedSlot.startsWith('slot:') && numberedTargets.length > 0) {
    const matched = numberedTargets.find((s) => s.slotValue === selectedSlot);
    if (!matched) {
      const err = new Error(`未找到服务端配置槽位 ${selectedSlot}`);
      err.status = 400;
      throw err;
    }
    return {
      stopOnNonRetriable: false,
      targets: [
        {
          ...matched,
          firstTokenTimeoutMs: Math.max(matched.firstTokenTimeoutMs, 25000),
          timeoutMs: Math.max(matched.timeoutMs, 45000),
        },
      ],
    };
  }

  if (selectedSlot === 'auto' && numberedTargets.length > 0) {
    return { stopOnNonRetriable: false, targets: numberedTargets };
  }

  const findSlotByHost = (hostSubstr) =>
    numberedTargets.find((t) => t.baseUrl.toLowerCase().includes(hostSubstr));

  const zhipuSlot = findSlotByHost('bigmodel.cn');
  const zhipuKey = (serverEnv?.ZHIPU_API_KEY || zhipuSlot?.apiKey || '').trim();
  const zhipuBase = (serverEnv?.ZHIPU_BASE_URL || zhipuSlot?.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').trim();
  const zhipuModel = (serverEnv?.ZHIPU_MODEL || zhipuSlot?.model || 'glm-4.7-flash').trim();
  const zhipuFirstTokenMs = parseMs(serverEnv?.ZHIPU_FIRST_TOKEN_MS, zhipuSlot?.firstTokenTimeoutMs || 10000);
  const zhipuTimeoutMs = parseMs(serverEnv?.ZHIPU_TIMEOUT_MS, zhipuSlot?.timeoutMs || 15000);

  const cfSlot = findSlotByHost('cloudflare.com');
  const cfAccountId = (serverEnv?.CF_ACCOUNT_ID || '').trim();
  const cfApiToken = (serverEnv?.CF_API_TOKEN || cfSlot?.apiKey || '').trim();
  const cfBase = (
    serverEnv?.CF_BASE_URL ||
    cfSlot?.baseUrl ||
    (cfAccountId ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccountId)}/ai/v1` : '')
  ).trim();
  const cfModel = (serverEnv?.CF_MODEL || cfSlot?.model || '@cf/google/gemma-4-26b-a4b-it').trim();
  const cfFirstTokenMs = parseMs(serverEnv?.CF_FIRST_TOKEN_MS, cfSlot?.firstTokenTimeoutMs || 5000);
  const cfTimeoutMs = parseMs(serverEnv?.CF_TIMEOUT_MS, cfSlot?.timeoutMs || 25000);

  const gwSlot = findSlotByHost('edgeone.link');
  const gatewayKey = (serverEnv?.AI_GATEWAY_API_KEY || gwSlot?.apiKey || '').trim();
  const gatewayBase = (serverEnv?.AI_GATEWAY_BASE_URL || gwSlot?.baseUrl || 'https://ai-gateway.edgeone.link/v1').trim();
  const gatewayModel = (serverEnv?.AI_GATEWAY_MODEL || gwSlot?.model || 'google/gemini-3.5-flash-lite').trim();
  const gatewayFirstTokenMs = parseMs(serverEnv?.AI_GATEWAY_FIRST_TOKEN_MS, gwSlot?.firstTokenTimeoutMs || 10000);
  const gatewayTimeoutMs = parseMs(serverEnv?.AI_GATEWAY_TIMEOUT_MS, gwSlot?.timeoutMs || 20000);

  const geminiKey = (serverEnv?.GEMINI_API_KEY || '').trim();

  const nvSlot = findSlotByHost('nvidia.com');
  const nvidiaKey = (serverEnv?.NVIDIA_API_KEY || nvSlot?.apiKey || '').trim();
  const nvidiaBase = (serverEnv?.NVIDIA_BASE_URL || nvSlot?.baseUrl || 'https://integrate.api.nvidia.com/v1').trim();
  const nvidiaModel = (serverEnv?.NVIDIA_MODEL || nvSlot?.model || 'nvidia/nemotron-3.5-super-vl-120b-a12b').trim();
  const nvidiaFirstTokenMs = parseMs(serverEnv?.NVIDIA_FIRST_TOKEN_MS, nvSlot?.firstTokenTimeoutMs || 3000);
  const nvidiaTimeoutMs = parseMs(serverEnv?.NVIDIA_TIMEOUT_MS, nvSlot?.timeoutMs || 20000);

  const makeNvidiaTarget = (
    model = 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    firstTokenTimeoutMs = 3000,
    timeoutMs = 20000
  ) => {
    if (!nvidiaKey) {
      const err = new Error('服务端未配置 NVIDIA_API_KEY，无法调用 NVIDIA NIM');
      err.status = 503;
      throw err;
    }
    return {
      kind: 'openai',
      provider: 'nvidia-nim',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKey,
      model,
      firstTokenTimeoutMs,
      timeoutMs,
      maxTokens: 2048,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
      label: `NVIDIA ${model}`,
    };
  };

  const makeZhipuTarget = (firstTokenTimeoutMs = 6000, timeoutMs = 15000) => {
    if (!zhipuKey) {
      const err = new Error('服务端未配置 ZHIPU_API_KEY，无法直连智谱 glm-4.7-flash');
      err.status = 503;
      throw err;
    }
    return {
      kind: 'openai',
      provider: 'zhipu',
      baseUrl: zhipuBase,
      apiKey: zhipuKey,
      model: zhipuModel,
      firstTokenTimeoutMs,
      timeoutMs,
      maxTokens: 2048,
      extraBody: { thinking: { type: 'disabled' } },
      label: `智谱 ${zhipuModel}`,
    };
  };

  const makeCfTarget = (firstTokenTimeoutMs = cfFirstTokenMs, timeoutMs = cfTimeoutMs) => {
    if (!cfBase || !cfApiToken) {
      const err = new Error('服务端未配置 CF_ACCOUNT_ID 或 CF_API_TOKEN，无法调用 Cloudflare Workers AI');
      err.status = 503;
      throw err;
    }
    return {
      kind: 'openai',
      provider: 'cloudflare-workers-ai',
      baseUrl: cfBase,
      apiKey: cfApiToken,
      model: cfModel,
      firstTokenTimeoutMs,
      timeoutMs,
      maxTokens: 2048,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
      label: `Cloudflare ${cfModel}`,
    };
  };

  const makeMakersGoogleTarget = (model, firstTokenTimeoutMs = 15000, timeoutMs = 25000) => ({
    kind: 'openai',
    provider: 'edgeone-makers-google',
    baseUrl: gatewayBase,
    apiKey: gatewayKey,
    model,
    firstTokenTimeoutMs,
    timeoutMs,
    maxTokens: 2048,
    label: `Makers ${model}`,
  });

  const selected = String(serverModel || 'auto').trim();

  if (selected === 'nvidia:nemotron-3.5-super-vl-120b-a12b') {
    return { stopOnNonRetriable: false, targets: [makeNvidiaTarget('nvidia/nemotron-3.5-super-vl-120b-a12b', 15000, 25000)] };
  }
  if (selected === 'nvidia:minimaxai/minimax-m3.1-flash') {
    return { stopOnNonRetriable: false, targets: [makeNvidiaTarget('minimaxai/minimax-m3.1-flash', 25000, 45000)] };
  }
  if (selected === 'nvidia:nvidia/nemotron-3-ultra-550b-a55b') {
    return { stopOnNonRetriable: false, targets: [makeNvidiaTarget('nvidia/nemotron-3-ultra-550b-a55b', 25000, 45000)] };
  }
  if (selected === 'zhipu:glm-4.7-flash') {
    return { stopOnNonRetriable: false, targets: [makeZhipuTarget(25000, 25000)] };
  }
  if (selected === 'cf:@cf/google/gemma-4-26b-a4b-it') {
    return { stopOnNonRetriable: false, targets: [makeCfTarget(35000, 45000)] };
  }
  if (selected === 'makers:auto') {
    if (!gatewayKey) {
      const err = new Error('服务端未配置 AI_GATEWAY_API_KEY，无法调用 EdgeOne Makers Gemini 网关');
      err.status = 503;
      throw err;
    }
    return {
      stopOnNonRetriable: false,
      targets: [makeMakersGoogleTarget('google/gemini-3.5-flash-lite', 25000, 35000)],
    };
  }
  if (selected.startsWith('makers:google/')) {
    if (!gatewayKey) {
      const err = new Error('服务端未配置 AI_GATEWAY_API_KEY，无法调用 EdgeOne Makers Gemini 网关');
      err.status = 503;
      throw err;
    }
    const model = selected.slice('makers:'.length);
    return { stopOnNonRetriable: false, targets: [makeMakersGoogleTarget(model, 35000, 45000)] };
  }

  const hasCloudflare = Boolean(cfBase && cfApiToken);
  if (!nvidiaKey && !zhipuKey && !hasCloudflare && !gatewayKey && !geminiKey) {
    const err = new Error('服务端未配置 AI 密钥，请切换为「自定义 API Key」或联系站点管理员配置环境变量。');
    err.status = 503;
    throw err;
  }

  const targets = [];
  if (hasCloudflare) targets.push(makeCfTarget(cfFirstTokenMs, cfTimeoutMs));
  if (gatewayKey) {
    targets.push(makeMakersGoogleTarget(gatewayModel, gatewayFirstTokenMs, gatewayTimeoutMs));
  } else if (geminiKey) {
    targets.push({
      kind: 'gemini',
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      apiKey: geminiKey,
      firstTokenTimeoutMs: gatewayFirstTokenMs,
      timeoutMs: gatewayTimeoutMs,
      label: 'Gemini (gemini-3.5-flash-lite)',
    });
  }
  if (nvidiaKey) targets.push(makeNvidiaTarget(nvidiaModel, nvidiaFirstTokenMs, nvidiaTimeoutMs));
  if (zhipuKey) targets.push(makeZhipuTarget(zhipuFirstTokenMs, zhipuTimeoutMs));

  return { stopOnNonRetriable: false, targets };
}

function isRetriableStatus(status) {
  return (
    status === 0 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 404
  );
}

async function executeTargets({
  digest,
  serverModel = 'auto',
  byok,
  serverEnv,
  stream,
  onStatus,
  onMeta,
  onDelta,
}) {
  const { systemPrompt, userPrompt } = buildAnalysisMessages(digest);
  const { stopOnNonRetriable, targets } = buildTargetPlan({
    serverModel,
    byok,
    serverEnv,
  });

  const errors = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    onStatus?.(
      i === 0
        ? `正在连接 ${target.label}...`
        : `前序通道受限，正在切换至 ${target.label}...`
    );

    try {
      if (target.kind === 'gemini') {
        return await invokeGeminiTarget(target, {
          systemPrompt,
          userPrompt,
          stream,
          onMeta,
          onDelta,
        });
      }
      return await invokeOpenAiTarget(target, {
        systemPrompt,
        userPrompt,
        stream,
        onMeta,
        onDelta,
      });
    } catch (err) {
      // Once tokens have been emitted to the client, do not silently restart with another provider
      if (err?.committed) {
        throw err;
      }

      const status = Number(err?.status) || 0;
      if (targets.length === 1) {
        throw err;
      }
      if (stopOnNonRetriable && !isRetriableStatus(status)) {
        throw err;
      }
      errors.push(err?.message || `${target.label} 调用失败`);
    }
  }

  const finalErr = new Error(errors.join(' | ') || 'AI 分析服务暂不可用');
  finalErr.status = 502;
  throw finalErr;
}

/**
 * Execute non-streaming AI analysis (returns full JSON result).
 */
export async function runAiAnalysis({ digest, serverModel = 'auto', byok, serverEnv }) {
  return executeTargets({
    digest,
    serverModel,
    byok,
    serverEnv,
    stream: false,
  });
}

/**
 * Execute streaming AI analysis with real-time delta callbacks and seamless pre-token fallback.
 */
export async function runAiAnalysisStream({
  digest,
  serverModel = 'auto',
  byok,
  serverEnv,
  onStatus,
  onMeta,
  onDelta,
}) {
  return executeTargets({
    digest,
    serverModel,
    byok,
    serverEnv,
    stream: true,
    onStatus,
    onMeta,
    onDelta,
  });
}
