#!/usr/bin/env node
/**
 * 砚纸研习 · YanZhi Study — Standalone CLI Installer & Manager
 * MIT License · Copyright (c) 2026 Over9rowth
 *
 * Commands:
 *   node cli.mjs install    安装独立版皮肤与守护进程（自动停用旧版 theme-patch 冲突）
 *   node cli.mjs verify     注入并验证当前 Antigravity 窗口实机状态
 *   node cli.mjs doctor     检查 Node、SQLite、字体与 CDP 端口健康状态
 *   node cli.mjs uninstall  停止守护服务并无损还原窗口外观
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME = os.homedir();
const INSTALL_DIR = path.join(HOME, '.gemini', 'yanzhi-skin');
const CMD = (process.argv[2] || 'doctor').toLowerCase();

function checkNodeVersion() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22) {
    console.error(`[Error] 需要 Node.js >= 22.0.0（当前 ${process.versions.node}）`);
    process.exit(1);
  }
  return { version: process.versions.node, hasSqlite: maj > 22 || min >= 13 };
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function resolvePortFile() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Antigravity', 'DevToolsActivePort');
}

function getCdpPort() {
  const pf = resolvePortFile();
  try {
    if (fs.existsSync(pf)) {
      const p = parseInt(fs.readFileSync(pf, 'utf8').trim().split(/\r?\n/)[0], 10);
      if (p > 0) return p;
    }
  } catch {}
  return 9222;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let raw = '';
      res.on('data', (d) => (raw += d));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function evalOnPage(expr) {
  const port = getCdpPort();
  let targets = [];
  try {
    targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  } catch (err) {
    return { reachable: false, port, error: err?.message || 'unreachable' };
  }
  const page = targets.find(
    (t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url && !t.url.startsWith('devtools://') && !t.url.startsWith('data:text/html')
  );
  if (!page) return { reachable: false, port };

  return new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ reachable: false, port });
    }, 3000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: expr } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve({ reachable: true, port, title: page.title, value: msg.result?.result?.value ?? null });
        }
      } catch {}
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ reachable: false, port });
    });
  });
}

function patchArgvJson() {
  const argvPath = path.join(HOME, '.antigravity', 'argv.json');
  try {
    fs.mkdirSync(path.dirname(argvPath), { recursive: true });
    if (!fs.existsSync(argvPath)) {
      fs.writeFileSync(argvPath, JSON.stringify({ 'remote-debugging-port': 9222 }, null, 2) + '\n', 'utf8');
      return 'created';
    }
    const raw = fs.readFileSync(argvPath, 'utf8');
    if (/"remote-debugging-port"\s*:/.test(raw)) return 'already-set';
    const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped || '{}');
    parsed['remote-debugging-port'] = 9222;
    fs.writeFileSync(argvPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    return 'patched';
  } catch {
    return 'skipped';
  }
}

function stopPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) {
      try { process.kill(pid); } catch {}
    }
    fs.unlinkSync(pidFile);
  } catch {}
}

function stopLegacyThemePatch() {
  const legacyDir = path.join(HOME, '.gemini', 'antigravity', 'theme-patch');
  const legacyCfg = path.join(legacyDir, 'user', 'config.json');
  const legacyDaemon = path.join(legacyDir, 'core', 'daemon.mjs');
  const legacyInstaller = path.join(legacyDir, 'install.mjs');

  if (fs.existsSync(legacyCfg)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(legacyCfg, 'utf8'));
      if (cfg.enabled !== false) {
        cfg.enabled = false;
        fs.writeFileSync(legacyCfg, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      }
    } catch {}
  }
  if (fs.existsSync(legacyDaemon)) {
    spawnSync(process.execPath, ['--no-warnings', legacyDaemon, '--once'], { stdio: 'ignore', timeout: 5000 });
  }
  if (fs.existsSync(legacyInstaller)) {
    spawnSync(process.execPath, [legacyInstaller, 'uninstall'], { stdio: 'ignore', timeout: 8000 });
  }
  if (process.platform === 'win32') {
    const startupVbs = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AntigravityThemeDaemon.vbs');
    if (fs.existsSync(startupVbs)) {
      try { fs.unlinkSync(startupVbs); } catch {}
    }
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'AntigravityThemeDaemon', '/f'], { stdio: 'ignore' });
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\CurrentVersion\\Run', '/v', 'YanZhiAntigravitySkin', '/f'], { stdio: 'ignore' });
    spawnSync('schtasks', ['/delete', '/tn', '\\AntigravityThemeDaemon', '/f'], { stdio: 'ignore' });
  }
}

function patchWindowsShortcuts(enable = true) {
  if (process.platform !== 'win32') return [];
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$roots = @(
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:USERPROFILE\\Desktop",
  "$env:PUBLIC\\Desktop",
  "$env:APPDATA\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"
)
$res = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  Get-ChildItem -Path $r -Recurse -Filter '*.lnk' | ForEach-Object {
    $sc = $sh.CreateShortcut($_.FullName)
    if ($sc.TargetPath -like '*\Antigravity.exe') {
      $args = [string]$sc.Arguments
      if (${enable ? '$true' : '$false'}) {
        if ($args -notmatch '--remote-debugging-port') {
          $sc.Arguments = ($args.Trim() + ' --remote-debugging-port=9222').Trim()
          $sc.Save()
          $res += ($_.FullName + ':patched')
        } else {
          $res += ($_.FullName + ':already-set')
        }
      } else {
        if ($args -match '--remote-debugging-port(=\\d+)?') {
          $sc.Arguments = ($args -replace '\\s*--remote-debugging-port(=\\d+)?', '').Trim()
          $sc.Save()
          $res += ($_.FullName + ':removed')
        }
      }
    }
  }
}
$res -join '|'
`;
  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    const results = (out.stdout || '').trim().split('|').filter(Boolean);

    // Also patch Desktop .bat/.cmd launchers invoking Antigravity.exe
    const scriptRoots = [
      path.join(HOME, 'Desktop'),
      path.join(HOME, 'OneDrive', 'Desktop')
    ];
    for (const dir of scriptRoots) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.(bat|cmd)$/i.test(name)) continue;
        const fp = path.join(dir, name);
        try {
          const raw = fs.readFileSync(fp, 'utf8');
          if (!/Antigravity\.exe/i.test(raw)) continue;
          let updated = raw;
          let changed = false;
          if (enable) {
            if (/theme-patch[\\/]+daemon-guard\.vbs/i.test(updated)) {
              updated = updated.replace(/%USERPROFILE%[\\/]+\.gemini[\\/]+antigravity[\\/]+theme-patch[\\/]+daemon-guard\.vbs/gi, '%USERPROFILE%\\.gemini\\yanzhi-skin\\YanZhiDaemon.vbs');
              changed = true;
            }
            updated = updated.replace(/^([^\r\n]*Antigravity\.exe[^\r\n]*)$/gim, (line) => {
              if (/--remote-debugging-port/i.test(line)) return line;
              changed = true;
              return line.replace(/\s+$/, '') + ' --remote-debugging-port=9222';
            });
            results.push(fp + (changed ? ':patched' : ':already-set'));
          } else {
            updated = updated.replace(/\s*--remote-debugging-port(=\d+)?/gi, () => {
              changed = true;
              return '';
            });
            if (changed) results.push(fp + ':removed');
          }
          if (changed && updated !== raw) {
            fs.writeFileSync(fp, updated, 'utf8');
          }
        } catch {}
      }
    }
    return results;
  } catch {
    return [];
  }
}

function writeAutostartAndLaunch(daemonPath) {
  const nodeExe = process.execPath;
  if (process.platform === 'win32') {
    const vbsPath = path.join(INSTALL_DIR, 'YanZhiDaemon.vbs');
    const vbsContent = [
      'Set sh = CreateObject("WScript.Shell")',
      `sh.Run """${nodeExe}"" --no-warnings ""${daemonPath}""", 0, False`
    ].join('\r\n') + '\r\n';
    fs.writeFileSync(vbsPath, Buffer.from('\uFEFF' + vbsContent, 'utf16le'));

    const startupDir = path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    try {
      fs.mkdirSync(startupDir, { recursive: true });
      fs.copyFileSync(vbsPath, path.join(startupDir, 'YanZhiAntigravitySkin.vbs'));
    } catch {}

    spawnSync('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v', 'YanZhiAntigravitySkin', '/t', 'REG_SZ',
      '/d', `wscript.exe "${vbsPath}"`, '/f'
    ], { stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    const plistDir = path.join(HOME, 'Library', 'LaunchAgents');
    fs.mkdirSync(plistDir, { recursive: true });
    const plistPath = path.join(plistDir, 'io.over9rowth.yanzhi-antigravity-skin.plist');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.over9rowth.yanzhi-antigravity-skin</string>
  <key>ProgramArguments</key><array><string>${nodeExe}</string><string>--no-warnings</string><string>${daemonPath}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>`;
    fs.writeFileSync(plistPath, plist, 'utf8');
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    spawnSync('launchctl', ['load', plistPath], { stdio: 'ignore' });
  }

  stopPidFile(path.join(INSTALL_DIR, 'daemon.pid'));
  if (process.platform === 'win32') {
    const vbsPath = path.join(INSTALL_DIR, 'YanZhiDaemon.vbs');
    if (fs.existsSync(vbsPath)) {
      const w = spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true });
      w.unref();
      return w.pid;
    }
  }
  const child = spawn(nodeExe, ['--no-warnings', daemonPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

function installSessionHook() {
  const pluginDir = path.join(HOME, '.gemini', 'config', 'plugins', 'yanzhi-skin-hook');
  try {
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'yanzhi-skin-hook',
      displayName: '砚纸研习皮肤自动守护',
      version: '1.1.0',
      description: 'Antigravity 重启或开新对话时自动唤醒砚纸研习护眼皮肤与实时指标胶囊。',
      author: { name: 'Over9rowth' }
    }, null, 2) + '\n', 'utf8');
    const cliTarget = path.join(INSTALL_DIR, 'cli.mjs');
    fs.writeFileSync(path.join(pluginDir, 'hooks.json'), JSON.stringify({
      'yanzhi-skin-lifecycle': {
        SessionStart: [
          {
            type: 'command',
            command: `node "${cliTarget}" ensure`,
            timeout: 8
          }
        ]
      }
    }, null, 2) + '\n', 'utf8');
  } catch {}
}

function removeSessionHook() {
  const pluginDir = path.join(HOME, '.gemini', 'config', 'plugins', 'yanzhi-skin-hook');
  try {
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
  } catch {}
}

function isDaemonAlive() {
  const pidFile = path.join(INSTALL_DIR, 'daemon.pid');
  if (!fs.existsSync(pidFile)) return false;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) {
      process.kill(pid, 0);
      return true;
    }
  } catch {}
  return false;
}

async function cmdInstall() {
  const nodeInfo = checkNodeVersion();
  if (path.resolve(__dirname) !== path.resolve(INSTALL_DIR)) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    copyDirRecursive(path.join(__dirname, 'src'), path.join(INSTALL_DIR, 'src'));
    fs.copyFileSync(path.join(__dirname, 'cli.mjs'), path.join(INSTALL_DIR, 'cli.mjs'));
    const dstCfg = path.join(INSTALL_DIR, 'config.json');
    if (!fs.existsSync(dstCfg)) {
      fs.copyFileSync(path.join(__dirname, 'config.json'), dstCfg);
    }
  }

  stopLegacyThemePatch();
  const argvStatus = patchArgvJson();
  const shortcutStatus = patchWindowsShortcuts(true);
  const daemonPath = path.join(INSTALL_DIR, 'src', 'daemon.mjs');
  const pid = writeAutostartAndLaunch(daemonPath);
  installSessionHook();

  await new Promise((r) => setTimeout(r, 1200));
  const check = await evalOnPage('typeof window.__yz_state === "function" ? window.__yz_state() : null');
  console.log(JSON.stringify({
    ok: true,
    installDir: INSTALL_DIR,
    node: nodeInfo,
    argvStatus,
    shortcutStatus,
    daemonPid: pid,
    live: check
  }, null, 2));
}

async function cmdEnsure() {
  try { fs.readFileSync(0, 'utf8'); } catch {}
  patchWindowsShortcuts(true);
  const daemonPath = path.join(INSTALL_DIR, 'src', 'daemon.mjs');
  if (!isDaemonAlive() && fs.existsSync(daemonPath)) {
    spawnSync(process.execPath, ['--no-warnings', daemonPath, '--once'], { stdio: 'ignore', timeout: 4000 });
    writeAutostartAndLaunch(daemonPath);
  }
  process.stdout.write('{}');
}

async function cmdVerify() {
  checkNodeVersion();
  const daemonPath = fs.existsSync(path.join(INSTALL_DIR, 'src', 'daemon.mjs'))
    ? path.join(INSTALL_DIR, 'src', 'daemon.mjs')
    : path.join(__dirname, 'src', 'daemon.mjs');
  spawnSync(process.execPath, ['--no-warnings', daemonPath, '--once'], { stdio: 'inherit' });
  const check = await evalOnPage('typeof window.__yz_state === "function" ? window.__yz_state() : null');
  console.log(JSON.stringify({ ok: Boolean(check.reachable && check.value?.styleMounted), live: check }, null, 2));
}

async function cmdDoctor() {
  const nodeInfo = checkNodeVersion();
  const portFile = resolvePortFile();
  const check = await evalOnPage('typeof window.__yz_state === "function" ? window.__yz_state() : null');
  const pidFile = path.join(INSTALL_DIR, 'daemon.pid');
  let daemonAlive = false;
  let daemonPid = null;
  if (fs.existsSync(pidFile)) {
    daemonPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    try { process.kill(daemonPid, 0); daemonAlive = true; } catch { daemonAlive = false; }
  }
  console.log(JSON.stringify({
    ok: true,
    node: nodeInfo,
    installDir: INSTALL_DIR,
    installed: fs.existsSync(path.join(INSTALL_DIR, 'src', 'daemon.mjs')),
    daemonAlive,
    daemonPid,
    portFile,
    portFileExists: fs.existsSync(portFile),
    live: check
  }, null, 2));
}

async function cmdUninstall() {
  const cfgPath = path.join(INSTALL_DIR, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      cfg.enabled = false;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    } catch {}
  }
  const daemonPath = path.join(INSTALL_DIR, 'src', 'daemon.mjs');
  if (fs.existsSync(daemonPath)) {
    spawnSync(process.execPath, ['--no-warnings', daemonPath, '--once'], { stdio: 'ignore' });
  }
  stopPidFile(path.join(INSTALL_DIR, 'daemon.pid'));
  removeSessionHook();
  patchWindowsShortcuts(false);

  if (process.platform === 'win32') {
    const startupVbs = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'YanZhiAntigravitySkin.vbs');
    if (fs.existsSync(startupVbs)) {
      try { fs.unlinkSync(startupVbs); } catch {}
    }
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\CurrentVersion\\Run', '/v', 'YanZhiAntigravitySkin', '/f'], { stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    const plistPath = path.join(HOME, 'Library', 'LaunchAgents', 'io.over9rowth.yanzhi-antigravity-skin.plist');
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  }
  console.log(JSON.stringify({ ok: true, uninstalled: true }, null, 2));
}

if (CMD === 'install') await cmdInstall();
else if (CMD === 'ensure') await cmdEnsure();
else if (CMD === 'verify') await cmdVerify();
else if (CMD === 'doctor') await cmdDoctor();
else if (CMD === 'uninstall') await cmdUninstall();
else {
  console.log('Usage: node cli.mjs <install|verify|doctor|uninstall>');
  process.exit(1);
}
