/**
 * 砚纸研习 · YanZhi Study — Standalone Clean-Room Browser Runtime
 * MIT License · Copyright (c) 2026 Over9rowth
 */
((boot) => {
  if (window.top !== window) return;
  if (!boot || typeof boot !== 'object') return;

  const VERSION = boot.version || '1.0.0';
  const ENABLED = boot.enabled !== false;
  const CFG = boot.config || {};
  const FEATURES = Object.assign({ theme: true, metrics: true, i18n: true, toolbar: true }, CFG.features || {});
  const CSS_TEXT = boot.cssText || '';
  const DICT_RAW = boot.dict && typeof boot.dict === 'object' ? boot.dict : {};

  const MODE_KEY = 'yz_study_mode';
  const FONT_KEY = 'yz_study_font';
  const root = document.documentElement;

  if (!window.__yz_orig_map) {
    window.__yz_orig_map = new WeakMap();
  }
  const origMap = window.__yz_orig_map;

  function restoreTranslations(container) {
    if (!container) return;
    try {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const rec = origMap.get(node);
        if (rec && node.nodeValue === rec.translated) {
          node.nodeValue = rec.original;
          origMap.delete(node);
        }
      }
      const attrEls = container.querySelectorAll
        ? container.querySelectorAll('[data-yz-orig-title], [data-yz-orig-placeholder], [data-yz-orig-aria-label]')
        : [];
      for (let i = 0; i < attrEls.length; i++) {
        const el = attrEls[i];
        for (const attr of ['title', 'placeholder', 'aria-label']) {
          const k = 'data-yz-orig-' + attr;
          if (el.hasAttribute(k)) {
            el.setAttribute(attr, el.getAttribute(k));
            el.removeAttribute(k);
          }
        }
      }
    } catch {}
  }

  function clearTimers() {
    if (window.__yz_i18n_observer) {
      try { window.__yz_i18n_observer.disconnect(); } catch {}
      window.__yz_i18n_observer = null;
    }
    if (window.__yz_toolbar_timer) {
      try { clearInterval(window.__yz_toolbar_timer); } catch {}
      window.__yz_toolbar_timer = null;
    }
    if (window.__yz_metrics_timer) {
      try { clearInterval(window.__yz_metrics_timer); } catch {}
      window.__yz_metrics_timer = null;
    }
  }

  if (!ENABLED) {
    clearTimers();
    for (const id of ['yz-theme-style', 'yz-study-toolbar', 'yz-metrics-pill', 'yz-metrics-tooltip']) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    root.removeAttribute('data-yz-mode');
    root.removeAttribute('data-yz-font');
    root.style.removeProperty('--yz-chat-font-size');
    restoreTranslations(document.body);
    window.__yz_version = VERSION + '-disabled';
    return;
  }

  // --------------------------------------------------------------------------
  // 1. 注入主题 CSS 与字号变量
  // --------------------------------------------------------------------------
  const head = document.head || document.getElementsByTagName('head')[0] || root;
  let styleEl = document.getElementById('yz-theme-style');
  if (FEATURES.theme !== false && CSS_TEXT) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'yz-theme-style';
      if (head) head.appendChild(styleEl);
    }
    if (styleEl.textContent !== CSS_TEXT) {
      styleEl.textContent = CSS_TEXT;
    }
    if (CFG.fontSize) {
      root.style.setProperty('--yz-chat-font-size', String(CFG.fontSize));
    }
  } else if (styleEl) {
    styleEl.remove();
  }

  // --------------------------------------------------------------------------
  // 2. 侧栏昼夜与字体快捷条 (#yz-study-toolbar)
  // --------------------------------------------------------------------------
  function getSaved(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }
  function setSaved(key, val) {
    try { localStorage.setItem(key, val); } catch {}
  }

  function applyVisualPrefs() {
    const defaultMode =
      CFG.mode === 'dark' || CFG.mode === 'light'
        ? CFG.mode
        : document.body && document.body.classList.contains('theme-dark')
          ? 'dark'
          : 'light';
    const mode = getSaved(MODE_KEY, defaultMode);
    const font = getSaved(FONT_KEY, CFG.font === 'serif' ? 'serif' : 'sans');

    root.setAttribute('data-yz-mode', mode === 'dark' ? 'dark' : 'light');
    root.setAttribute('data-yz-font', font === 'serif' ? 'serif' : 'sans');

    const bar = document.getElementById('yz-study-toolbar');
    if (bar) {
      const btns = bar.querySelectorAll('button[data-yz-action]');
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const act = b.getAttribute('data-yz-action');
        const val = b.getAttribute('data-yz-value');
        const active = (act === 'mode' && val === (mode === 'dark' ? 'dark' : 'light')) ||
                       (act === 'font' && val === (font === 'serif' ? 'serif' : 'sans'));
        b.setAttribute('data-active', active ? 'true' : 'false');
      }
    }
  }

  function makeToolbarBtn(action, value, label, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('data-yz-action', action);
    btn.setAttribute('data-yz-value', value);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSaved(action === 'mode' ? MODE_KEY : FONT_KEY, value);
      applyVisualPrefs();
    });
    return btn;
  }

  function ensureToolbar() {
    if (FEATURES.toolbar === false) {
      const old = document.getElementById('yz-study-toolbar');
      if (old) old.remove();
      return;
    }
    const settingsBtn = document.querySelector('[data-testid="settings-button"]');
    const host = settingsBtn && settingsBtn.parentElement;
    if (!host) return;

    let bar = document.getElementById('yz-study-toolbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'yz-study-toolbar';

      const gMode = document.createElement('div');
      gMode.className = 'yz-btn-group';
      gMode.appendChild(makeToolbarBtn('mode', 'light', '☀ 竹纸', '切换晨光竹纸浅色护眼模式'));
      gMode.appendChild(makeToolbarBtn('mode', 'dark', '🌙 松烟', '切换夜读松烟深色护眼模式'));

      const gFont = document.createElement('div');
      gFont.className = 'yz-btn-group';
      gFont.appendChild(makeToolbarBtn('font', 'sans', '黑体', '正文：Anthropic Sans + Noto Sans SC'));
      gFont.appendChild(makeToolbarBtn('font', 'serif', '宋体', '正文：Anthropic Serif + Noto Serif SC'));

      bar.appendChild(gMode);
      bar.appendChild(gFont);
      host.insertBefore(bar, settingsBtn);
    } else if (bar.parentElement !== host) {
      host.insertBefore(bar, settingsBtn);
    }
    applyVisualPrefs();
  }

  // --------------------------------------------------------------------------
  // 3. 实时性能指标胶囊 (#yz-metrics-pill + #yz-metrics-tooltip)
  // --------------------------------------------------------------------------
  function fmtK(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v));
  }

  function getActiveCascadeId() {
    try {
      const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
      if (m) return m[1];
      const q = new URLSearchParams(window.location.search).get('cascadeId');
      if (q && /^[0-9a-f-]{36}$/i.test(q)) return q;
      const sel = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
      if (sel) {
        const cid = sel.getAttribute('data-cascade-id');
        if (cid && /^[0-9a-f-]{36}$/i.test(cid)) return cid;
      }
    } catch {}
    return '';
  }

  function findComposerFooter(box) {
    if (!box) return null;
    const rows = box.querySelectorAll('div.flex.w-full.items-center.justify-between');
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) {
        return rows[i];
      }
    }
    return rows[rows.length - 1] || null;
  }

  function ensureMetricsTooltip() {
    let tt = document.getElementById('yz-metrics-tooltip');
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'yz-metrics-tooltip';
      document.body.appendChild(tt);
    }
    return tt;
  }

  function addTipRow(parent, label, value, tone) {
    const row = document.createElement('div');
    row.className = 'yz-tt-row';
    const l = document.createElement('span');
    l.className = 'yz-tt-lbl';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = tone === 'warn' ? 'yz-tt-val yz-tt-warn' : tone ? 'yz-tt-val yz-tt-accent' : 'yz-tt-val';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    parent.appendChild(row);
  }

  function renderTooltipContent(data) {
    const tt = ensureMetricsTooltip();
    if (!tt || !data) return;
    tt.textContent = '';

    const hdr = document.createElement('div');
    hdr.className = 'yz-tt-hdr';
    const title = document.createElement('span');
    title.textContent = data.model ? data.model : '砚纸研习 · 性能遥测面板';
    const badge = document.createElement('span');
    badge.className = 'yz-tt-accent';
    badge.textContent = data.tokPerSec ? `${data.tokPerSec.toFixed(1)} tok/s` : '—';
    hdr.appendChild(title);
    hdr.appendChild(badge);
    tt.appendChild(hdr);

    if (data.outputTokens) {
      const s1 = document.createElement('div');
      s1.className = 'yz-tt-sec-title';
      s1.textContent = '对话性能与上下文健康度';
      tt.appendChild(s1);

      const durStr = data.durationSec != null ? ` · 生成 ${data.durationSec.toFixed(2)}s` : '';
      addTipRow(tt, '速率 / 首字 / 耗时', `${data.tokPerSec ? data.tokPerSec.toFixed(1) + ' tok/s' : '—'} · ${data.ttftSec != null ? data.ttftSec.toFixed(2) + 's' : '—'}${durStr}`);

      const thinkPct = data.outputTokens > 0 ? Math.round((data.thinkingTokens / data.outputTokens) * 100) : 0;
      addTipRow(
        tt,
        '本轮输出 (思考占比)',
        `${fmtK(data.outputTokens)} (正文 ${fmtK(data.visibleTokens)} + 思考 ${fmtK(data.thinkingTokens)} · ${thinkPct}%)`
      );
      addTipRow(
        tt,
        '新输入 / 缓存命中',
        `${fmtK(data.inputUncached)} 新 · ${fmtK(data.inputCached)} 缓存 (${data.cacheHitPct != null ? data.cacheHitPct.toFixed(1) + '%' : '—'})`
      );

      const warnThreshold = Number(CFG.contextWarnTokens) || 220000;
      const ctxPct = data.ctxLimit > 0 ? Math.round((data.ctxUsed / data.ctxLimit) * 100) : 0;
      const healthLabel =
        data.ctxUsed >= warnThreshold
          ? '🔴 临近自动压缩，建议 /compact'
          : data.ctxUsed >= Math.round(warnThreshold * 0.72)
            ? '🟡 建议适时收尾开新对话'
            : '🟢 上下文充沛';
      addTipRow(
        tt,
        '上下文水位',
        `${fmtK(data.ctxUsed)} / ${fmtK(data.ctxLimit)} (${ctxPct}%)`,
        data.ctxUsed >= warnThreshold ? 'warn' : false
      );
      const track = document.createElement('div');
      track.className = 'yz-tt-bar-track';
      const fill = document.createElement('div');
      fill.className = 'yz-tt-bar-fill';
      fill.style.width = `${Math.min(100, ctxPct)}%`;
      fill.setAttribute('data-warn', data.ctxUsed >= warnThreshold ? 'true' : 'false');
      track.appendChild(fill);
      tt.appendChild(track);
      addTipRow(tt, '压缩建议', healthLabel, data.ctxUsed >= warnThreshold ? 'warn' : true);
      addTipRow(tt, '本会话累计', `${fmtK(data.totalOutputTokens)} 输出 · ${data.turnCount} 次模型调用`);
    }
  }

  function positionTooltip(pill, tt) {
    const rect = pill.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - (ttRect.width || 350) - 12));
    const top = Math.max(12, rect.top - (ttRect.height || 220) - 8);
    tt.style.left = left + 'px';
    tt.style.top = top + 'px';
  }

  function mountMetricsPill() {
    if (FEATURES.metrics === false) {
      const old = document.getElementById('yz-metrics-pill');
      if (old) old.remove();
      return null;
    }
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!box) return null;
    const footer = findComposerFooter(box);
    if (!footer || !footer.children[0]) return null;

    const leftGroup = footer.children[0];
    const rightGroup = footer.children[1] || null;

    let pill = document.getElementById('yz-metrics-pill');
    if (pill && pill.getAttribute('data-yz-trampoline') !== '1') {
      pill.remove();
      pill = null;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'yz-metrics-pill';
      pill.setAttribute('data-yz-trampoline', '1');
    }

    pill.onmouseenter = () => {
      if (!window.__yz_last_metrics) return;
      const tt = ensureMetricsTooltip();
      if (!tt) return;
      renderTooltipContent(window.__yz_last_metrics);
      positionTooltip(pill, tt);
      tt.setAttribute('data-visible', 'true');
    };
    pill.onmouseleave = () => {
      const tt = document.getElementById('yz-metrics-tooltip');
      if (tt) tt.setAttribute('data-visible', 'false');
    };
    pill.onclick = null;

    let naturalLeft = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (ch.id === 'yz-metrics-pill') continue;
      naturalLeft += Math.max(ch.offsetWidth || 0, ch.scrollWidth || 0);
    }
    const rightWidth = rightGroup ? Math.max(rightGroup.offsetWidth || 0, rightGroup.scrollWidth || 0) : 0;
    const avail = (footer.clientWidth || 0) - naturalLeft - rightWidth - 16;

    if (avail < 185) {
      pill.classList.add('yz-pill-wrapped');
      if (pill.parentElement !== footer.parentElement && footer.parentElement) {
        footer.after(pill);
      }
    } else {
      pill.classList.remove('yz-pill-wrapped');
      if (pill.parentElement !== leftGroup) {
        leftGroup.appendChild(pill);
      }
    }

    return pill;
  }

  function renderMetricsPill(data) {
    if (data !== undefined) window.__yz_last_metrics = data;
    const m = window.__yz_last_metrics;
    const pill = mountMetricsPill();
    if (!pill) return;

    if (!m || !m.outputTokens) {
      pill.style.display = 'none';
      return;
    }

    pill.textContent = '';
    pill.title = '悬停查看本轮遥测与上下文明细';

    const dot = document.createElement('span');
    dot.className = 'yz-pill-dot';
    pill.appendChild(dot);

    const ctxPct = m.ctxLimit > 0 ? Math.min(100, Math.round((m.ctxUsed / m.ctxLimit) * 100)) : 0;

    if (m.tokPerSec) {
      const tps = document.createElement('span');
      tps.className = 'yz-m-tps';
      tps.textContent = `⚡${Math.round(m.tokPerSec)}/s`;
      pill.appendChild(tps);
    }

    if (m.ttftSec != null) {
      const sep = document.createElement('span');
      sep.className = 'yz-m-sep';
      sep.textContent = '·';
      pill.appendChild(sep);
      const ttft = document.createElement('span');
      ttft.className = 'yz-m-ttft';
      ttft.textContent = `⏱${m.ttftSec.toFixed(1)}s`;
      pill.appendChild(ttft);
    }

    const sep2 = document.createElement('span');
    sep2.className = 'yz-m-sep';
    sep2.textContent = '·';
    pill.appendChild(sep2);

    const ctxWrap = document.createElement('span');
    ctxWrap.className = 'yz-ctx-wrap';
    const track = document.createElement('span');
    track.className = 'yz-ctx-track';
    const fill = document.createElement('span');
    fill.className = 'yz-ctx-fill';
    fill.style.width = `${ctxPct}%`;
    track.appendChild(fill);
    const ctxTxt = document.createElement('span');
    ctxTxt.className = 'yz-m-ctx';
    ctxTxt.textContent = `${ctxPct}%`;
    ctxWrap.appendChild(track);
    ctxWrap.appendChild(ctxTxt);
    pill.appendChild(ctxWrap);

    const sep3 = document.createElement('span');
    sep3.className = 'yz-m-sep';
    sep3.textContent = '·';
    pill.appendChild(sep3);

    const out = document.createElement('span');
    out.className = 'yz-m-out';
    out.textContent = `✍${fmtK(m.outputTokens)}`;
    pill.appendChild(out);

    const warnThreshold = Number(CFG.contextWarnTokens) || 220000;
    pill.setAttribute('data-ctx-level', ctxPct >= 85 ? 'crit' : (ctxPct >= 60 || m.ctxUsed >= warnThreshold) ? 'warn' : 'ok');

    pill.style.display = 'inline-flex';
  }

  let reqCounter = 0;
  window.__yzOnMetricsResult = (payload) => {
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!data) return;
      const activeCid = getActiveCascadeId();
      if (data.cascadeId && activeCid && data.cascadeId !== activeCid) return;
      renderMetricsPill(data);
    } catch {}
  };

  function requestMetricsUpdate() {
    if (FEATURES.metrics === false) return;
    const cid = getActiveCascadeId();
    if (!cid) {
      window.__yz_last_metrics = null;
      renderMetricsPill(null);
      return;
    }
    if (typeof window.__yzMetricsQuery !== 'function') {
      renderMetricsPill();
      return;
    }
    try {
      window.__yzMetricsQuery(JSON.stringify({ reqId: ++reqCounter, cascadeId: cid }));
    } catch {}
  }

  // --------------------------------------------------------------------------
  // 4. 独立原创汉化引擎（WeakMap 可逆还原 + 严密隔离正文/代码/公式）
  // --------------------------------------------------------------------------
  const exactMap = Object.create(null);
  const normMap = Object.create(null);
  const rawSource = DICT_RAW.exact && typeof DICT_RAW.exact === 'object' ? DICT_RAW.exact : DICT_RAW;
  let dictCount = 0;
  for (const [k, v] of Object.entries(rawSource)) {
    if (k.startsWith('_') || typeof v !== 'string') continue;
    exactMap[k] = v;
    normMap[k.replace(/\s+/g, ' ').trim()] = v;
    dictCount++;
  }

  const EXCLUDE_SELECTOR = [
    'code', 'pre', 'kbd', 'samp', 'textarea', 'input', 'style', 'script', 'noscript',
    '[contenteditable="true"]', '.ProseMirror', '.katex', '.prose', '.markdown',
    '.select-text.text-base', '.select-text.whitespace-pre-wrap',
    '[data-testid="conversation-row-sidebar"] a[href^="/c/"]',
    '[data-testid="conversation-row-sidebar"] span.truncate',
    '#yz-metrics-pill', '#yz-metrics-tooltip', '#yz-study-toolbar'
  ].join(', ');

  function isExcluded(el) {
    if (!el || el.nodeType !== 1) return false;
    return !!(el.closest && el.closest(EXCLUDE_SELECTOR));
  }

  function fmtTimeZh(s) {
    return String(s || '')
      .replace(/(\d+)\s*days?/gi, '$1 天')
      .replace(/(\d+)\s*hours?/gi, '$1 小时')
      .replace(/(\d+)\s*minutes?/gi, '$1 分钟')
      .replace(/(\d+)\s*seconds?/gi, '$1 秒')
      .replace(/\s*,\s*/g, ' ');
  }

  function lookupTranslation(raw, isAttr = false) {
    if (!raw || typeof raw !== 'string') return null;
    if (exactMap[raw]) return exactMap[raw];
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (exactMap[trimmed]) return raw.replace(trimmed, exactMap[trimmed]);
    const collapsed = trimmed.replace(/\s+/g, ' ');
    if (normMap[collapsed]) return normMap[collapsed];

    let m;
    if ((m = collapsed.match(/^Version\s+([\d.]+(?:-[\w.-]+)?)$/i))) {
      return `版本 ${m[1]}`;
    }
    if (isAttr && (m = collapsed.match(/^Close\s+(.+)$/))) {
      return `关闭 ${m[1]}`;
    }
    if ((m = collapsed.match(/^Your Plan:\s*(.+)$/i))) {
      return `当前方案：${m[1]}`;
    }
    if (/^Your Plan:?$/i.test(collapsed)) {
      return '当前方案：';
    }
    if ((m = collapsed.match(/^Available AI Credits:\s*(.+)$/i))) {
      return `可用 AI 点数：${m[1]}`;
    }
    if (/^Available AI Credits:?$/i.test(collapsed)) {
      return '可用 AI 点数：';
    }
    if ((m = collapsed.match(/^Project ID:\s*(.+)$/i))) {
      return `项目 ID：${m[1]}`;
    }
    if ((m = collapsed.match(/^You have used some of your (weekly|5-hour) limit, it will fully refresh in (.+)\.$/i))) {
      const prefix = m[1].toLowerCase() === 'weekly' ? '本周额度已使用部分，将在 ' : '5 小时额度已使用部分，将在 ';
      return prefix + fmtTimeZh(m[2]) + ' 后完全重置。';
    }
    if ((m = collapsed.match(/^You have not used any of your (weekly|5-hour) limit\.$/i))) {
      return m[1].toLowerCase() === 'weekly' ? '本周额度尚未消耗。' : '5 小时额度尚未消耗。';
    }
    if ((m = collapsed.match(/^You have reached your (weekly|5-hour) limit, it will fully refresh in (.+)\.$/i))) {
      const prefix = m[1].toLowerCase() === 'weekly' ? '本周额度已用尽，将在 ' : '5 小时额度已用尽，将在 ';
      return prefix + fmtTimeZh(m[2]) + ' 后完全重置。';
    }
    if ((m = collapsed.match(/^(\d+)\s+active conversations?$/i))) {
      return `${m[1]} 个活跃对话`;
    }
    if ((m = collapsed.match(/^(Show|Hide)\s+(\d+)\s+breakdowns?$/i))) {
      return `${m[1].toLowerCase() === 'show' ? '展开' : '收起'} ${m[2]} 项明细`;
    }
    if ((m = collapsed.match(/^(.+)\s+Weekly Limit$/i))) {
      return `${m[1]} 每周额度`;
    }
    return null;
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || isExcluded(parent)) return;
    const cur = node.nodeValue;
    if (!cur || !/[A-Za-z]/.test(cur)) return;

    const existing = origMap.get(node);
    if (existing && cur === existing.translated) return;

    const zh = lookupTranslation(cur);
    if (zh && zh !== cur) {
      origMap.set(node, { original: cur, translated: zh });
      node.nodeValue = zh;
    }
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || isExcluded(el)) return;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      const val = el.getAttribute(attr);
      if (!val || !/[A-Za-z]/.test(val)) continue;
      const zh = lookupTranslation(val, true);
      if (zh && zh !== val) {
        const origKey = 'data-yz-orig-' + attr;
        if (!el.hasAttribute(origKey)) {
          el.setAttribute(origKey, val);
        }
        el.setAttribute(attr, zh);
      }
    }
  }

  function translateSubtree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) {
      translateTextNode(rootNode);
      return;
    }
    if (rootNode.nodeType !== 1 || isExcluded(rootNode)) return;
    translateAttrs(rootNode);
    const attrTargets = rootNode.querySelectorAll
      ? rootNode.querySelectorAll('[title], [placeholder], [aria-label]')
      : [];
    for (let i = 0; i < attrTargets.length; i++) {
      translateAttrs(attrTargets[i]);
    }
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      translateTextNode(walker.currentNode);
    }
  }

  clearTimers();
  applyVisualPrefs();
  ensureToolbar();
  mountMetricsPill();
  renderMetricsPill();
  requestMetricsUpdate();

  window.__yz_toolbar_timer = setInterval(ensureToolbar, 2000);
  window.__yz_metrics_timer = setInterval(requestMetricsUpdate, 2500);

  if (FEATURES.i18n !== false) {
    translateSubtree(document.body);
    const dirty = new Set();
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      const batch = Array.from(dirty).slice(0, 120);
      for (const n of batch) {
        dirty.delete(n);
        translateSubtree(n);
      }
      if (dirty.size > 0) schedule();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => requestAnimationFrame(flush), 40);
    };

    window.__yz_i18n_observer = new MutationObserver((muts) => {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        if (m.type === 'characterData') {
          if (m.target && m.target.parentElement && !isExcluded(m.target.parentElement)) {
            dirty.add(m.target);
          }
        } else if (m.type === 'attributes') {
          translateAttrs(m.target);
        } else if (m.type === 'childList') {
          if (m.target && m.target.nodeType === 1 && isExcluded(m.target)) continue;
          for (let j = 0; j < m.addedNodes.length; j++) {
            dirty.add(m.addedNodes[j]);
          }
        }
      }
      if (dirty.size > 0) schedule();
    });

    if (document.body) {
      window.__yz_i18n_observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title', 'placeholder', 'aria-label']
      });
    }
  } else {
    restoreTranslations(document.body);
  }

  window.__yz_version = VERSION;
  window.__yz_state = () => ({
    version: VERSION,
    mode: root.getAttribute('data-yz-mode'),
    font: root.getAttribute('data-yz-font'),
    styleMounted: !!document.getElementById('yz-theme-style'),
    toolbarMounted: !!document.getElementById('yz-study-toolbar'),
    pillMounted: !!document.getElementById('yz-metrics-pill'),
    pillText: document.getElementById('yz-metrics-pill')?.textContent || '',
    dictCount
  });
})(__YZ_BOOT__);
