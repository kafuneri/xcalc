import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mergeSyncPayloads, normalizePayload } from './shared/syncMerge.js';
import { runAiAnalysis, runAiAnalysisStream, listPublicServerSlots } from './shared/aiAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_KV_FILE = path.resolve(__dirname, '.local-kv.json');
const SYNC_KEY_RE = /^[a-f0-9]{64}$/i;

function readLocalKvStore() {
  try {
    if (!fs.existsSync(LOCAL_KV_FILE)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_KV_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeLocalKvStore(store) {
  fs.writeFileSync(LOCAL_KV_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function localApiPlugin(allEnv) {
  const serverAiEnv = {
    ...allEnv,
  };

  return {
    name: 'local-api-mock',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];

        if (urlPath === '/api/health' && req.method === 'GET') {
          const aiSlots = listPublicServerSlots(serverAiEnv);
          return sendJson(res, 200, {
            ok: true,
            platform: 'local-mock',
            kvReady: true,
            kvBindingName: '.local-kv.json',
            aiReady: aiSlots.length > 0,
            aiSlots,
            timestamp: Date.now(),
          });
        }

        if (urlPath === '/api/analyze') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method === 'POST') {
            try {
              const bodyText = await readRequestBody(req);
              const parsed = JSON.parse(bodyText);
              const mode = String(req.headers['x-ai-mode'] || 'server').trim();
              const byok =
                mode === 'gemini-byok' || mode === 'openai-byok'
                  ? {
                      mode,
                      apiKey: String(req.headers['x-ai-key'] || '').trim(),
                      baseUrl: String(req.headers['x-ai-base-url'] || '').trim(),
                      model: String(req.headers['x-ai-model'] || '').trim(),
                    }
                  : { mode: 'server' };

              const serverModel =
                typeof parsed?.serverModel === 'string' ? parsed.serverModel : 'auto';

              if (parsed?.stream === true) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/event-stream; charset=UTF-8');
                res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders?.();

                const sendEvent = (obj) => {
                  if (!res.writableEnded) {
                    res.write(`data: ${JSON.stringify(obj)}\n\n`);
                  }
                };

                try {
                  const result = await runAiAnalysisStream({
                    digest: parsed?.digest,
                    serverModel,
                    byok,
                    serverEnv: serverAiEnv,
                    onStatus: (message) => sendEvent({ type: 'status', message }),
                    onMeta: (meta) => sendEvent({ type: 'meta', ...meta }),
                    onDelta: (text) => sendEvent({ type: 'delta', text }),
                  });
                  sendEvent({ type: 'done', ...result });
                } catch (err) {
                  sendEvent({
                    type: 'error',
                    status: Number(err?.status) || 502,
                    message: err instanceof Error ? err.message : 'AI 分析请求失败',
                  });
                } finally {
                  if (!res.writableEnded) res.end();
                }
                return;
              }

              const result = await runAiAnalysis({
                digest: parsed?.digest,
                serverModel,
                byok,
                serverEnv: serverAiEnv,
              });
              return sendJson(res, 200, { ok: true, ...result });
            } catch (err) {
              const status = Number(err?.status) || 502;
              return sendJson(res, status >= 400 && status < 600 ? status : 502, {
                error: 'AI_ANALYSIS_FAILED',
                message: err instanceof Error ? err.message : 'AI 分析请求失败',
              });
            }
          }
        }

        if (urlPath === '/api/sync') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          const rawKey = String(req.headers['x-sync-key'] || '').trim().toLowerCase();
          if (!SYNC_KEY_RE.test(rawKey)) {
            return sendJson(res, 400, {
              error: 'INVALID_SYNC_KEY',
              message: '缺少或无效的同步凭证 (X-Sync-Key)。',
            });
          }

          const kvKey = `u:${rawKey}`;
          const store = readLocalKvStore();

          if (req.method === 'GET') {
            const existing = store[kvKey] ?? null;
            return sendJson(res, 200, {
              ok: true,
              exists: Boolean(existing),
              payload: normalizePayload(existing),
            });
          }

          if (req.method === 'PUT') {
            try {
              const bodyText = await readRequestBody(req);
              const incoming = JSON.parse(bodyText);
              const merged = mergeSyncPayloads(incoming, store[kvKey] ?? null);
              store[kvKey] = merged;
              writeLocalKvStore(store);
              return sendJson(res, 200, { ok: true, payload: merged });
            } catch (err) {
              return sendJson(res, 400, {
                error: 'INVALID_JSON',
                message: err instanceof Error ? err.message : '请求解析失败',
              });
            }
          }

          if (req.method === 'POST') {
            try {
              const bodyText = await readRequestBody(req);
              const body = JSON.parse(bodyText);
              const rawNewKey = String(body?.newSyncKey || '').trim().toLowerCase();
              if (!SYNC_KEY_RE.test(rawNewKey)) {
                return sendJson(res, 400, {
                  error: 'INVALID_NEW_SYNC_KEY',
                  message: '缺少或无效的新同步凭证 (newSyncKey)。',
                });
              }
              const newKvKey = `u:${rawNewKey}`;
              if (kvKey === newKvKey) {
                return sendJson(res, 400, {
                  error: 'SAME_SYNC_KEY',
                  message: '新口令与原口令相同，无需迁移。',
                });
              }
              if (!store[kvKey]) {
                return sendJson(res, 404, {
                  error: 'SYNC_SOURCE_NOT_FOUND',
                  message: '未找到原口令对应的云端数据，请先完成一次同步。',
                });
              }
              if (store[newKvKey]) {
                return sendJson(res, 409, {
                  error: 'SYNC_TARGET_EXISTS',
                  message: '新口令对应的云端空间已存在数据，请更换其他新口令。',
                });
              }
              store[newKvKey] = normalizePayload(store[kvKey]);
              delete store[kvKey];
              writeLocalKvStore(store);
              return sendJson(res, 200, { ok: true, migrated: true });
            } catch (err) {
              return sendJson(res, 400, {
                error: 'INVALID_JSON',
                message: err instanceof Error ? err.message : '请求解析失败',
              });
            }
          }
        }

        next();
      });
    },
  };
}

function injectEnvScriptsPlugin(env) {
  return {
    name: 'inject-env-scripts',
    transformIndexHtml() {
      const tags = [];
      const analyticsSrc = (env.VITE_ANALYTICS_SRC || '').trim();
      const analyticsId = (env.VITE_ANALYTICS_WEBSITE_ID || '').trim();
      const vercountSrc = (env.VITE_VERCOUNT_SRC || '').trim();

      if (analyticsSrc) {
        const attrs = { defer: true, src: analyticsSrc };
        if (analyticsId) {
          attrs['data-website-id'] = analyticsId;
        }
        tags.push({
          tag: 'script',
          attrs,
          injectTo: 'head',
        });
      }

      if (vercountSrc) {
        tags.push({
          tag: 'script',
          attrs: { defer: true, src: vercountSrc },
          injectTo: 'body',
        });
      }

      return tags;
    },
  };
}

export default defineConfig(({ mode }) => {
  const allEnv = {
    ...loadEnv(mode, __dirname, ''),
    ...process.env,
  };

  return {
    plugins: [vue(), localApiPlugin(allEnv), injectEnvScriptsPlugin(allEnv)],
    server: {
      port: 5173,
    },
  };
});
