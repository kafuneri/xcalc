/**
 * Health check endpoint for EdgeOne Pages / Makers Edge Functions.
 * Tells the frontend whether cloud KV (XC_KV) is bound and ready.
 */

function resolveKv(context) {
  try {
    if (typeof XC_KV !== 'undefined' && XC_KV) return XC_KV;
  } catch {
    // ignore ReferenceError when unbound
  }
  return context?.env?.XC_KV ?? globalThis.XC_KV ?? null;
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
  return jsonResponse({
    ok: true,
    platform: 'edgeone',
    kvReady: Boolean(kv && typeof kv.get === 'function' && typeof kv.put === 'function'),
    kvBindingName: 'XC_KV',
    timestamp: Date.now(),
  });
}
