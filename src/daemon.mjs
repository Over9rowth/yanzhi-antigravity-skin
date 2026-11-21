#!/usr/bin/env node
/**
 * 砚纸研习 · YanZhi Study — Standalone Clean-Room CDP Daemon
 * MIT License · Copyright (c) 2026 Over9rowth
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const PID_PATH = path.join(ROOT_DIR, 'daemon.pid');

const RUN_ONCE = process.argv.includes('--once');

let DatabaseSync = null;
try {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (sqlite && typeof sqlite.DatabaseSync === 'function') {
    DatabaseSync = sqlite.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

function readJsonSafe(p, fallback = {}) {
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function readTextSafe(p, fallback = '') {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function getFileSig(p) {
  try {
    if (!fs.existsSync(p)) return '0:0';
    const st = fs.statSync(p);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '0:0';
  }
}

// ----------------------------------------------------------------------------
// 1. 轻量级 Protobuf Wire 解析与会话指标提取
// ----------------------------------------------------------------------------
function decodeProto(buf, depth = 0) {
  const fields = [];
  let i = 0;
  while (i < buf.length) {
    let key = 0;
    let shift = 0;
    let b;
    do {
      if (i >= buf.length) return null;
      b = buf[i++];
      key |= (b & 0x7f) << shift;
      shift += 7;
    } while (b >= 0x80 && shift < 35);

    const fn = key >>> 3;
    const wt = key & 7;
    if (fn === 0) return null;

    if (wt === 0) {
      let val = 0n;
      let s = 0n;
      do {
        if (i >= buf.length) return null;
        b = buf[i++];
        val |= BigInt(b & 0x7f) << s;
        s += 7n;
      } while (b >= 0x80 && s < 70n);
      fields.push({ fn, wt, num: Number(val) });
    } else if (wt === 1) {
      if (i + 8 > buf.length) return null;
      i += 8;
      fields.push({ fn, wt });
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      do {
        if (i >= buf.length) return null;
        b = buf[i++];
        len |= (b & 0x7f) << s;
        s += 7;
      } while (b >= 0x80 && s < 35);
      if (len < 0 || i + len > buf.length) return null;
      const sub = buf.subarray(i, i + len);
      i += len;
      const nested = depth < 3 ? decodeProto(sub, depth + 1) : null;
      fields.push({ fn, wt, buf: sub, nested });
    } else if (wt === 5) {
      if (i + 4 > buf.length) return null;
      i += 4;
      fields.push({ fn, wt });
    } else {
      return null;
    }
  }
  return fields;
}

function getDurationSec(nestedFields) {
  if (!Array.isArray(nestedFields)) return null;
  const sec = nestedFields.find((f) => f.fn === 1 && f.wt === 0)?.num || 0;
  const nano = nestedFields.find((f) => f.fn === 2 && f.wt === 0)?.num || 0;
  const total = sec + nano / 1e9;
  return total > 0 ? total : null;
}

function parseGenMetadataBlob(buf) {
  const top = decodeProto(buf);
  if (!top) return null;
  const wrap = top.find((f) => f.fn === 1 && f.nested);
  if (!wrap) return null;

  const usage = wrap.nested.find((f) => f.fn === 4 && f.nested)?.nested || [];
  const uMap = Object.create(null);
  for (const f of usage) {
    if (f.wt === 0) uMap[f.fn] = f.num;
  }

  const outputTokens = uMap[3] || 0;
  if (outputTokens <= 0) return null;

  const inputUncached = uMap[2] || 0;
  const inputCached = uMap[5] || 0;
  const visibleTokens = uMap[9] || 0;
  const thinkingTokens = uMap[10] || 0;

  const ctxGroup = wrap.nested
    .find((f) => f.fn === 9 && f.nested)
    ?.nested?.find((f) => f.fn === 10 && f.nested)?.nested || [];
  const ctxUsed = ctxGroup.find((f) => f.fn === 1 && f.wt === 0)?.num || 0;
  const ctxLimit = ctxGroup.find((f) => f.fn === 4 && f.wt === 0)?.num || 0;

  const ttftSec = getDurationSec(wrap.nested.find((f) => f.fn === 11 && f.nested)?.nested);
  const durationSec = getDurationSec(wrap.nested.find((f) => f.fn === 12 && f.nested)?.nested);
  const modelField = wrap.nested.find((f) => f.fn === 19 && f.wt === 2);
  const model = modelField ? modelField.buf.toString('utf8') : '';

  return {
    model,
    outputTokens,
    visibleTokens,
    thinkingTokens,
    inputUncached,
    inputCached,
    ctxUsed,
    ctxLimit,
    ttftSec,
    durationSec
  };
}

function queryConversationMetrics(cascadeId) {
  if (!DatabaseSync || !/^[0-9a-f-]{36}$/i.test(cascadeId || '')) {
    return null;
  }
  const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations', `${cascadeId}.db`);
  if (!fs.existsSync(dbPath)) return null;

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx DESC LIMIT 80').all();
    let latest = null;
    let totalOutputTokens = 0;
    let turnCount = 0;

    for (const row of rows) {
      if (!row.data) continue;
      const parsed = parseGenMetadataBlob(Buffer.from(row.data));
      if (!parsed) continue;
      turnCount++;
      totalOutputTokens += parsed.outputTokens;
      if (!latest) latest = parsed;
    }

    if (!latest) return null;
    const totalIn = latest.inputUncached + latest.inputCached;
    const cacheHitPct = totalIn > 0 ? (latest.inputCached / totalIn) * 100 : null;
    const tokPerSec = latest.durationSec && latest.durationSec > 0 ? latest.outputTokens / latest.durationSec : null;

    return {
      cascadeId,
      model: latest.model,
      outputTokens: latest.outputTokens,
      visibleTokens: latest.visibleTokens,
      thinkingTokens: latest.thinkingTokens,
      inputUncached: latest.inputUncached,
      inputCached: latest.inputCached,
      cacheHitPct,
      ctxUsed: latest.ctxUsed,
      ctxLimit: latest.ctxLimit || 256000,
      ttftSec: latest.ttftSec,
      durationSec: latest.durationSec,
      tokPerSec,
      totalOutputTokens,
      turnCount
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

// ----------------------------------------------------------------------------
// 2. CDP 端口发现与增量载荷构建
// ----------------------------------------------------------------------------
function resolveCdpPort() {
  const home = os.homedir();
  let portFile;
  if (process.platform === 'win32') {
    portFile = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort');
  } else if (process.platform === 'darwin') {
    portFile = path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  } else {
    portFile = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity', 'DevToolsActivePort');
  }

  try {
    if (fs.existsSync(portFile)) {
      const firstLine = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0];
      const p = parseInt(firstLine, 10);
      if (p > 0) return p;
    }
  } catch {}

  const argvPath = path.join(home, '.antigravity', 'argv.json');
  try {
    if (fs.existsSync(argvPath)) {
      const m = fs.readFileSync(argvPath, 'utf8').match(/"remote-debugging-port"\s*:\s*(\d+)/);
      if (m && parseInt(m[1], 10) > 0) return parseInt(m[1], 10);
    }
  } catch {}

  return 9222;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

let cachedSig = '';
let cachedScript = '';
let cachedVersion = '';

function buildInjectBundle(forceRebuild = false) {
  const files = [
    CONFIG_PATH,
    path.join(SRC_DIR, 'theme.css'),
    path.join(SRC_DIR, 'runtime.js'),
    path.join(SRC_DIR, 'i18n.json')
  ];
  const sig = files.map(getFileSig).join('|');
  if (!forceRebuild && sig === cachedSig && cachedScript) {
    return { changed: false, script: cachedScript, version: cachedVersion };
  }

  const config = readJsonSafe(CONFIG_PATH, { enabled: true });
  const cssText = readTextSafe(path.join(SRC_DIR, 'theme.css'), '');
  const runtimeTpl = readTextSafe(path.join(SRC_DIR, 'runtime.js'), '');
  const dict = readJsonSafe(path.join(SRC_DIR, 'i18n.json'), {});

  const digest = crypto
    .createHash('sha256')
    .update(cssText + runtimeTpl + JSON.stringify(config) + JSON.stringify(dict))
    .digest('hex')
    .slice(0, 8);
  const version = `yanzhi-1.1.0-${digest}`;
  const payload = {
    version,
    enabled: config.enabled !== false,
    config,
    cssText,
    dict
  };

  cachedSig = sig;
  cachedVersion = version;
  cachedScript = runtimeTpl.replace('__YZ_BOOT__', () => JSON.stringify(payload));
  return { changed: true, script: cachedScript, version };
}

// ----------------------------------------------------------------------------
// 3. WebSocket CDP 会话池管理
// ----------------------------------------------------------------------------
const clients = new Map();

function sendCdp(ws, id, method, params = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ id, method, params }));
  }
}

function attachTarget(target, script, version) {
  if (clients.has(target.id)) return;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const state = { id: target.id, ws, msgSeq: 1, injectedVersion: '' };
  clients.set(target.id, state);

  ws.addEventListener('open', () => {
    sendCdp(ws, state.msgSeq++, 'Runtime.enable');
    sendCdp(ws, state.msgSeq++, 'Runtime.addBinding', { name: '__yzMetricsQuery' });
    sendCdp(ws, state.msgSeq++, 'Runtime.evaluate', { expression: script, silent: true });
    state.injectedVersion = version;
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__yzMetricsQuery') {
        const req = JSON.parse(msg.params.payload || '{}');
        const metrics = queryConversationMetrics(req.cascadeId);
        if (metrics) {
          sendCdp(ws, state.msgSeq++, 'Runtime.evaluate', {
            expression: `window.__yzOnMetricsResult && window.__yzOnMetricsResult(${JSON.stringify(metrics)})`,
            silent: true
          });
        }
      }
    } catch {}
  });

  const cleanup = () => {
    clients.delete(target.id);
  };
  ws.addEventListener('close', cleanup);
  ws.addEventListener('error', cleanup);
}

async function syncOnce(forceInject = false) {
  const port = resolveCdpPort();
  const { changed, script, version } = buildInjectBundle(forceInject);
  let targets = [];
  try {
    targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  } catch {
    return { reachable: false, port, injected: 0 };
  }

  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      t.url &&
      !t.url.startsWith('devtools://') &&
      !t.url.startsWith('data:text/html')
  );

  for (const p of pages) {
    const existing = clients.get(p.id);
    if (!existing) {
      attachTarget(p, script, version);
    } else if (changed || forceInject || existing.injectedVersion !== version) {
      sendCdp(existing.ws, existing.msgSeq++, 'Runtime.evaluate', { expression: script, silent: true });
      existing.injectedVersion = version;
    }
  }
  return { reachable: true, port, pages: pages.length, version };
}

if (RUN_ONCE) {
  const res = await syncOnce(true);
  await new Promise((r) => setTimeout(r, 400));
  for (const c of clients.values()) {
    try { c.ws.close(); } catch {}
  }
  console.log(JSON.stringify(res));
  process.exit(0);
}

// ----------------------------------------------------------------------------
// 4. 单实例 PID 锁与守护轮询
// ----------------------------------------------------------------------------
try {
  if (fs.existsSync(PID_PATH)) {
    const oldPid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    if (oldPid > 0 && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
        process.exit(0);
      } catch {}
    }
  }
  fs.writeFileSync(PID_PATH, String(process.pid), 'utf8');
} catch {}

function removePid() {
  try {
    if (fs.existsSync(PID_PATH) && fs.readFileSync(PID_PATH, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_PATH);
    }
  } catch {}
}
process.on('exit', removePid);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

await syncOnce(true);
setInterval(() => {
  syncOnce(false).catch(() => {});
}, 2000);
