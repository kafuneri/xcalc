import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mergeSyncPayloads, normalizePayload } from './shared/syncMerge.js';
import { runAiAnalysis } from './shared/aiAnalysis.js';

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
    ZHIPU_API_KEY: (allEnv.ZHIPU_API_KEY || '').trim(),
    ZHIPU_BASE_URL: (allEnv.ZHIPU_BASE_URL || '').trim(),
    CF_ACCOUNT_ID: (allEnv.CF_ACCOUNT_ID || '').trim(),
    CF_API_TOKEN: (allEnv.CF_API_TOKEN || '').trim(),
    AI_GATEWAY_API_KEY: (allEnv.AI_GATEWAY_API_KEY || '').trim(),
    AI_GATEWAY_BASE_URL: (allEnv.AI_GATEWAY_BASE_URL || '').trim(),
    GEMINI_API_KEY: (allEnv.GEMINI_API_KEY || '').trim(),
  };

  return {
    name: 'local-api-mock',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];

        if (urlPath === '/api/health' && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            platform: 'local-mock',
            kvReady: true,
            kvBindingName: '.local-kv.json',
            aiReady: Boolean(
              serverAiEnv.ZHIPU_API_KEY ||
                (serverAiEnv.CF_ACCOUNT_ID && serverAiEnv.CF_API_TOKEN) ||
                serverAiEnv.AI_GATEWAY_API_KEY ||
                serverAiEnv.GEMINI_API_KEY
            ),
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

              const result = await runAiAnalysis({
                digest: parsed?.digest,
                serverModel:
                  typeof parsed?.serverModel === 'string' ? parsed.serverModel : 'auto',
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
