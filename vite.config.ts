import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mergeSyncPayloads, normalizePayload } from './shared/syncMerge.js';

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

function localMockKvPlugin() {
  return {
    name: 'local-mock-kv',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];

        if (urlPath === '/api/health' && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            platform: 'local-mock',
            kvReady: true,
            kvBindingName: '.local-kv.json',
            timestamp: Date.now(),
          });
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

export default defineConfig({
  plugins: [vue(), localMockKvPlugin()],
  server: {
    port: 5173,
  },
});
