/**
 * Health check endpoint for EdgeOne Pages / Makers Edge Functions.
 * Tells the frontend whether cloud KV (XC_KV) and server AI keys are ready.
 */

function resolveKv(context) {
  try {
    if (typeof XC_KV !== 'undefined' && XC_KV) return XC_KV;
  } catch {
    // ignore ReferenceError when unbound
  }
  return context?.env?.XC_KV ?? globalThis.XC_KV ?? null;
}

function resolveEnvVar(context, name) {
  const fromContext = context?.env?.[name];
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }
  try {
    const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : '';
    if (typeof fromProcess === 'string' && fromProcess.trim()) {
      return fromProcess.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export async function onRequestGet(context) {
  const kv = resolveKv(context);
  const hasZhipu = Boolean(resolveEnvVar(context, 'ZHIPU_API_KEY'));
  const hasCf = Boolean(
    resolveEnvVar(context, 'CF_ACCOUNT_ID') && resolveEnvVar(context, 'CF_API_TOKEN')
  );
  const hasGateway = Boolean(resolveEnvVar(context, 'AI_GATEWAY_API_KEY'));
  const hasGemini = Boolean(resolveEnvVar(context, 'GEMINI_API_KEY'));

  return jsonResponse({
    ok: true,
    platform: 'edgeone',
    kvReady: Boolean(kv && typeof kv.get === 'function' && typeof kv.put === 'function'),
    kvBindingName: 'XC_KV',
    aiReady: hasZhipu || hasCf || hasGateway || hasGemini,
    timestamp: Date.now(),
  });
}
