/**
 * Health check endpoint for EdgeOne Pages / Makers Edge Functions.
 * Tells the frontend whether cloud KV (XC_KV) and server AI keys are ready.
 */

import { listPublicServerSlots } from '../../shared/aiAnalysis.js';

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
  const mergedEnv = {
    ...(typeof process !== 'undefined' && process.env ? process.env : {}),
    ...(context?.env || {}),
  };
  const aiSlots = listPublicServerSlots(mergedEnv);

  return jsonResponse({
    ok: true,
    platform: 'edgeone',
    kvReady: Boolean(kv && typeof kv.get === 'function' && typeof kv.put === 'function'),
    kvBindingName: 'XC_KV',
    aiReady: aiSlots.length > 0,
    aiSlots,
    timestamp: Date.now(),
  });
}
