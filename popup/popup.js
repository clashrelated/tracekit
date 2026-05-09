import { getProState, STORAGE_KEY as PRO_STORAGE_KEY } from '../utils/license.js';
import { HISTORY_KEY } from '../utils/history.js';
import { getSettings, SETTINGS_KEY } from '../utils/settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  body: document.body,
  // single
  form: $('#trace-form'),
  input: $('#url-input'),
  traceBtn: $('#trace-btn'),
  // bulk
  bulkBtn: $('#bulk-btn'),
  bulkInput: $('#bulk-input'),
  bulkCount: $('#bulk-count'),
  bulkRunBtn: $('#bulk-run-btn'),
  bulkCancelBtn: $('#bulk-cancel'),
  bulkBackBtn: $('#bulk-back-btn'),
  bulkResultsList: $('#bulk-results-list'),
  bulkResultsTitle: $('#bulk-results-title'),
  bulkExportBtn: $('#bulk-export-btn'),
  // history
  historyBtn: $('#history-btn'),
  historyList: $('#history-list'),
  historyEmpty: $('#history-empty'),
  historyClose: $('#history-close'),
  historyClear: $('#history-clear'),
  historyFoot: $('#history-foot'),
  // tracing/results
  tracingLabel: $('#tracing-label'),
  tracingUrl: $('#tracing-url'),
  chainList: $('#chain-list'),
  finalCard: $('#final-card'),
  finalUrl: $('#final-url'),
  finalMeta: $('#final-meta'),
  copyBtn: $('#copy-clean-btn'),
  copyLabel: $('#copy-clean-label'),
  openBtn: $('#open-url-btn'),
  newTraceBtn: $('#new-trace-btn'),
  retryBtn: $('#retry-btn'),
  homeBtn: $('#home-btn'),
  // export
  exportWrap: $('#export-wrap'),
  exportBtn: $('#export-btn'),
  exportMenu: $('#export-menu'),
  // webhook
  webhookBtn: $('#webhook-btn'),
  webhookBtnLabel: $('#webhook-btn-label'),
  // header
  proPill: $('#pro-pill'),
  settingsBtn: $('#settings-btn'),
  scannerBtn: $('#scanner-btn'),
  compareBtn: $('#compare-btn'),
  summary: $('#summary'),
  summaryHops: $('#summary-hops'),
  summaryTime: $('#summary-time'),
  summaryDeep: $('#summary-deep'),
  // idle recent
  idleRecent: $('#idle-recent'),
  idleRecentList: $('#idle-recent-list'),
  idleViewAllBtn: $('#idle-view-all-btn'),
  // gated hint + deep trace
  gatedHint: $('#gated-hint'),
  gatedText: $('#gated-text'),
  deepTraceBtn: $('#deep-trace-btn'),
  // page scanner
  scannerScanning: $('#scanner-scanning'),
  scannerList: $('#scanner-list'),
  scannerEmpty: $('#scanner-empty'),
  scannerFoot: $('#scanner-foot'),
  scannerCount: $('#scanner-count'),
  scannerTraceAll: $('#scanner-trace-all'),
  scannerClose: $('#scanner-close'),
  // compare
  compareClose: $('#compare-close'),
  compareUrlA: $('#compare-url-a'),
  compareUrlB: $('#compare-url-b'),
  compareRunBtn: $('#compare-run-btn'),
  compareNewBtn: $('#compare-new-btn'),
  compareResultsBody: $('#compare-results-body'),
  // error
  errorTitle: $('#error-title'),
  errorMsg: $('#error-msg'),
  errorBack: $('#error-back-btn'),
  errorAction: $('#error-action-btn'),
};

let lastTrace = null;
let lastBulk = null;
let isProUnlocked = false;
let scannerLinks = [];
let lastCompare = null;
let showWebhookButton = false;

// --- helpers ---
function setState(state) {
  els.body.dataset.state = state;
  if (state === 'idle' && els.body.dataset.mode === 'single') {
    els.summary.hidden = true;
    setTimeout(() => els.input?.focus(), 30);
  }
  const onHome = state === 'idle' && els.body.dataset.mode === 'single';
  els.homeBtn.hidden = onHome;
}

function setMode(mode) {
  els.body.dataset.mode = mode;
  els.bulkBtn?.classList.toggle('is-active', mode === 'bulk');
  els.historyBtn?.classList.toggle('is-active', mode === 'history');
  // Home button visible whenever not on the root idle screen
  const onHome = mode === 'single' && els.body.dataset.state === 'idle';
  els.homeBtn.hidden = onHome;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(response);
    });
  });
}

function formatMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function compactUrlForDisplay(url) {
  if (!url) return '';
  if (url.length <= 60) return url;
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search ? u.search : '');
    const shortPath = path.length > 30 ? path.slice(0, 30) + '…' : path;
    return `${u.host}${shortPath}`;
  } catch {
    return url.slice(0, 60) + '…';
  }
}

function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// --- single trace ---
async function startTrace(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) {
    els.input.focus();
    return;
  }
  setMode('single');
  els.tracingLabel.textContent = 'Following redirects…';
  els.tracingUrl.textContent = compactUrlForDisplay(url);
  els.tracingUrl.title = url;
  setState('tracing');

  let response;
  try {
    response = await sendMessage({ type: 'TRACE', url });
  } catch (err) {
    showError(err.message || 'message-channel-failed');
    return;
  }
  if (!response || !response.ok) {
    showError(response?.error || 'unknown-error');
    return;
  }

  lastTrace = response;
  renderResults(response);
  setState('results');
}

function showError(code) {
  const cfg = errorConfigFor(code);
  els.errorTitle.textContent = cfg.title;
  els.errorMsg.textContent = cfg.message;

  if (cfg.action) {
    els.errorAction.hidden = false;
    els.errorAction.textContent = cfg.action.label;
    els.errorAction.onclick = cfg.action.handler;
  } else {
    els.errorAction.hidden = true;
    els.errorAction.onclick = null;
  }

  setState('error');
}

function errorConfigFor(code) {
  if (code === 'tab-create-failed' || code === 'tab-no-id') {
    return {
      title: 'Deep trace failed',
      message: 'Could not open a background tab to run the deep trace. Try again.',
    };
  }
  if (code === 'incognito-required') {
    return {
      title: 'Enable incognito for deep trace',
      message: "Incognito deep-trace mode is on. Toggle 'Allow in Incognito' for TraceKit to continue.",
      action: {
        label: 'Open settings',
        handler: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
      },
    };
  }
  if (code && typeof code === 'string' && code.startsWith('incognito-')) {
    return {
      title: 'Deep trace failed',
      message: `Could not open the incognito window (${code}). Switch off incognito deep trace in Settings, or try again.`,
    };
  }
  return { title: 'Trace failed', message: friendlyError(code) };
}

function friendlyError(code) {
  const map = {
    'invalid-url': "That doesn't look like a valid URL.",
    'timeout': 'The trace timed out after 12 seconds.',
    'too-many-redirects': 'The redirect chain was too long (browser limit).',
    'dns-failure': 'Could not resolve the domain (DNS).',
    'cert-error': 'The destination has an invalid SSL certificate.',
    'aborted': 'The request was aborted.',
    'message-channel-failed': 'Lost connection to the background worker. Reload the extension.',
    'pro-required': 'This feature requires Pro.',
    'no-urls': 'Paste at least one URL.',
    'deep-trace-failed': 'The deep trace could not be completed.',
  };
  return map[code] || code;
}

function renderResults(data) {
  const { chain, summary } = data;

  clearChildren(els.chainList);
  chain.forEach((hop, idx) => {
    els.chainList.appendChild(renderHop(hop, idx, idx === chain.length - 1));
  });

  els.summaryHops.textContent = `${summary.hops} hop${summary.hops === 1 ? '' : 's'}`;
  els.summaryTime.textContent = formatMs(summary.totalDuration);
  els.summary.hidden = false;

  if (summary.cleanFinalUrl) {
    els.finalCard.hidden = false;
    els.finalUrl.textContent = summary.cleanFinalUrl;
    renderFinalMeta(summary);
  } else {
    els.finalCard.hidden = true;
  }

  els.exportWrap.hidden = !isProUnlocked;
  if (els.webhookBtn) els.webhookBtn.hidden = !(isProUnlocked && showWebhookButton);
  els.summaryDeep.hidden = !data.deep;

  const hint = decideClientGatedHint(data);
  els.gatedHint.hidden = !hint.show;
  if (hint.show) els.gatedText.textContent = hint.text;
  els.deepTraceBtn.hidden = !(hint.show && isProUnlocked && !data.deep);

  els.retryBtn.hidden = false;

  // Label "← Back" when drilled from bulk, "← New trace" otherwise
  const newTraceLabelEl = els.newTraceBtn.querySelector('span');
  if (newTraceLabelEl) {
    newTraceLabelEl.textContent = lastTrace?._fromBulk ? 'Back' : 'New trace';
  }

  resetCopyButton();
}

function decideClientGatedHint(data) {
  if (!data?.chain?.length) return { show: false };
  const last = data.chain[data.chain.length - 1];
  if (!last || last.error) return { show: false };
  if (last.status == null || last.status < 200 || last.status >= 300) return { show: false };
  const ct = (last.headers?.['content-type'] || '').toLowerCase();
  if (ct && !ct.includes('text/html')) return { show: false };
  if (data.deep) return { show: false };
  return {
    show: true,
    text: "Server returned 200. The page may redirect via JavaScript that TraceKit can't follow.",
  };
}

async function runDeepTrace() {
  if (!lastTrace) return;
  const url = lastTrace.chain[0]?.url;
  if (!url) return;
  els.tracingLabel.textContent = 'Running deep trace…';
  els.tracingUrl.textContent = compactUrlForDisplay(url);
  els.tracingUrl.title = url;
  setMode('single');
  setState('tracing');

  let res;
  try {
    res = await sendMessage({ type: 'DEEP_TRACE', url });
  } catch (err) {
    showError(err.message || 'deep-trace-failed');
    return;
  }
  if (!res?.ok) {
    showError(res?.error || 'deep-trace-failed');
    return;
  }
  lastTrace = res;
  renderResults(res);
  setState('results');
}

function renderHop(hop, idx, isLast) {
  const li = el('li', { className: 'tk-hop' });
  const num = el('div', { className: 'tk-hop-num', text: String(idx + 1).padStart(2, '0') });
  const body = el('div', { className: 'tk-hop-body' });
  const row = el('div', { className: 'tk-hop-row' });

  row.appendChild(el('span', {
    className: `tk-status ${statusClass(hop)}`,
    text: formatStatus(hop),
  }));

  const typeTag = renderTypeTag(hop);
  if (typeTag) row.appendChild(typeTag);

  if (hop.network) row.appendChild(renderNetworkBadge(hop.network));

  if (isLast && !hop.error && hop.type === 'final') {
    const tag = el('span', {
      className: 'tk-type-tag',
      text: 'final',
      style: { color: 'var(--green)', borderColor: 'var(--green-soft)' },
    });
    row.appendChild(tag);
  }

  if (hop.duration > 0) {
    row.appendChild(el('span', { className: 'tk-duration', text: formatMs(hop.duration) }));
  }

  body.appendChild(row);
  body.appendChild(el('div', {
    className: 'tk-hop-url',
    text: hop.url,
    title: hop.url,
  }));

  if (hop.error) {
    body.appendChild(el('div', { className: 'tk-hop-error', text: `error: ${hop.error}` }));
  }

  if (isProUnlocked && hop.headers && Object.keys(hop.headers).length > 0) {
    const headersSection = el('div', { className: 'tk-hop-headers' });
    headersSection.hidden = true;

    const table = el('table', { className: 'tk-headers-table' });
    for (const [k, v] of Object.entries(hop.headers)) {
      const tr = el('tr');
      tr.appendChild(el('td', { className: 'tk-header-name', text: k }));
      tr.appendChild(el('td', { className: 'tk-header-value', text: v, title: v }));
      table.appendChild(tr);
    }
    headersSection.appendChild(table);

    const toggle = el('button', { className: 'tk-headers-toggle', text: 'Headers' });
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const open = headersSection.hidden;
      headersSection.hidden = !open;
      toggle.classList.toggle('is-open', open);
      toggle.textContent = open ? 'Headers ▲' : 'Headers';
    });
    body.appendChild(toggle);
    body.appendChild(headersSection);
  }

  li.appendChild(num);
  li.appendChild(body);
  return li;
}

function statusClass(hop) {
  if (hop.error) return 's-err';
  const s = hop.status;
  if (s == null) return 's-err';
  if (s >= 200 && s < 300) return 's-2xx';
  if (s >= 300 && s < 400) return 's-3xx';
  if (s >= 400 && s < 500) return 's-4xx';
  if (s >= 500) return 's-5xx';
  return 's-err';
}

function formatStatus(hop) {
  if (hop.error) return 'ERR';
  if (hop.status == null) return '—';
  return String(hop.status);
}

function renderTypeTag(hop) {
  if (hop.type === 'refresh-redirect') return makeTypeTag('refresh', 'var(--amber)');
  if (hop.type === 'meta-redirect')    return makeTypeTag('meta refresh', 'var(--amber)');
  if (hop.type === 'js-redirect')      return makeTypeTag('js-redirect', 'var(--text-muted)');
  return null;
}

function makeTypeTag(label, color) {
  return el('span', {
    className: 'tk-type-tag',
    text: label,
    style: color ? { color } : undefined,
  });
}

function renderNetworkBadge(network) {
  const badge = el('span', { className: 'tk-network', title: `${network.name} (${network.type})` });
  badge.appendChild(el('span', { className: 'tk-network-dot', style: { background: network.color } }));
  badge.appendChild(el('span', { text: network.name, style: { color: network.color } }));
  return badge;
}

function renderFinalMeta(summary) {
  const node = els.finalMeta;
  clearChildren(node);

  const trackingKeys = Object.keys(summary.trackingParams || {});
  const trackingCount = trackingKeys.length;
  const networkCount = (summary.networks || []).length;

  const segments = [];

  if (trackingCount === 0) {
    segments.push([document.createTextNode('No tracking params detected')]);
  } else {
    const seg = [];
    seg.push(el('strong', { text: String(trackingCount) }));
    seg.push(document.createTextNode(` tracking param${trackingCount === 1 ? '' : 's'}: `));
    seg.push(el('span', { text: trackingKeys.slice(0, 3).join(', '), style: { fontFamily: 'var(--mono)' } }));
    if (trackingCount > 3) {
      seg.push(document.createTextNode(' '));
      seg.push(el('span', {
        text: `+${trackingCount - 3}`,
        style: { color: 'var(--text-dim)', fontFamily: 'var(--mono)' },
      }));
    }
    segments.push(seg);
  }

  if (networkCount > 0) {
    segments.push([
      el('strong', { text: String(networkCount) }),
      document.createTextNode(` network${networkCount === 1 ? '' : 's'} detected`),
    ]);
  }

  if (summary.truncated) {
    segments.push([el('span', { text: 'chain truncated', style: { color: 'var(--amber)' } })]);
  }

  segments.forEach((seg, i) => {
    if (i > 0) {
      node.appendChild(el('span', { text: '  ·  ', style: { color: 'var(--text-faint)' } }));
    }
    seg.forEach((s) => node.appendChild(s));
  });
}

// --- copy / open / new trace ---
function resetCopyButton() {
  els.copyBtn.classList.remove('is-copied');
  els.copyLabel.textContent = 'Copy clean URL';
}

async function copyClean() {
  const url = lastTrace?.summary?.cleanFinalUrl;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    els.copyBtn.classList.add('is-copied');
    els.copyLabel.textContent = 'Copied';
    setTimeout(resetCopyButton, 1400);
  } catch {
    els.copyLabel.textContent = 'Copy failed';
    setTimeout(resetCopyButton, 1400);
  }
}

function openFinal() {
  // Open the clean (tracking-stripped) version of the final URL by default —
  // that's the whole point of running TraceKit. Fall back to the raw final
  // URL only if cleaning failed for some reason.
  const url = lastTrace?.summary?.cleanFinalUrl || lastTrace?.summary?.finalUrl;
  if (!url) return;
  chrome.tabs.create({ url });
}

function resetToIdle() {
  if (lastTrace?._fromBulk && lastBulk) {
    lastTrace = null;
    els.retryBtn.hidden = true;
    const span = els.newTraceBtn.querySelector('span');
    if (span) span.textContent = 'New trace';
    setMode('bulk');
    setState('results');
    return;
  }
  lastTrace = null;
  els.retryBtn.hidden = true;
  const span = els.newTraceBtn.querySelector('span');
  if (span) span.textContent = 'New trace';
  els.input.value = '';
  clearChildren(els.chainList);
  els.finalCard.hidden = true;
  if (els.webhookBtn) els.webhookBtn.hidden = true;
  setMode('single');
  setState('idle');
  refreshIdleRecent();
}

// --- export ---
function toggleExportMenu(force) {
  const open = force ?? els.exportMenu.hidden;
  els.exportMenu.hidden = !open;
  els.exportBtn.setAttribute('aria-expanded', String(open));
}

function exportSingle(format) {
  if (!lastTrace) return;
  const stamp = formatStamp(new Date());
  if (format === 'json') {
    const payload = {
      exportedAt: new Date().toISOString(),
      input: lastTrace.chain[0]?.url || null,
      summary: lastTrace.summary,
      chain: lastTrace.chain,
    };
    downloadFile(`tracekit-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  } else if (format === 'csv') {
    const rows = [['hop', 'url', 'status', 'duration_ms', 'type', 'network', 'next_url']];
    lastTrace.chain.forEach((hop, i) => {
      rows.push([
        i + 1,
        hop.url,
        hop.status ?? '',
        hop.duration ?? '',
        hop.type ?? '',
        hop.network?.name ?? '',
        hop.nextUrl ?? '',
      ]);
    });
    downloadFile(`tracekit-${stamp}.csv`, toCsv(rows), 'text/csv');
  }
  toggleExportMenu(false);
}

function exportBulk() {
  if (!lastBulk) return;
  const stamp = formatStamp(new Date());
  const payload = {
    exportedAt: new Date().toISOString(),
    count: lastBulk.results.length,
    results: lastBulk.results,
  };
  downloadFile(`tracekit-bulk-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(name, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function formatStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// --- bulk ---
function enterBulkMode() {
  if (!isProUnlocked) return;
  setMode('bulk');
  setState('idle');
  setTimeout(() => els.bulkInput?.focus(), 30);
  updateBulkCount();
}

function exitBulkMode() {
  setMode('single');
  setState('idle');
}

function getBulkUrls() {
  const text = els.bulkInput.value || '';
  return text
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function updateBulkCount() {
  const urls = getBulkUrls();
  const n = urls.length;
  els.bulkCount.textContent = `${n} / 10 URL${n === 1 ? '' : 's'}`;
  els.bulkCount.classList.toggle('is-over', n > 10);
  els.bulkRunBtn.disabled = n === 0;
}

async function runBulk() {
  if (!isProUnlocked) return;
  const urls = getBulkUrls().slice(0, 10);
  if (urls.length === 0) return;

  setMode('bulk');
  els.tracingLabel.textContent = `Tracing 0 of ${urls.length}…`;
  els.tracingUrl.textContent = '';
  setState('tracing');

  // optimistic progress label updates while the background runs sequentially
  let response;
  try {
    response = await sendMessage({ type: 'TRACE_BULK', urls });
  } catch (err) {
    showError(err.message || 'message-channel-failed');
    return;
  }

  if (!response || !response.ok) {
    showError(response?.error || 'unknown-error');
    return;
  }

  lastBulk = response;
  renderBulkResults(response);
  setMode('bulk');
  setState('results');
}

function renderBulkResults(data) {
  const { results } = data;
  els.bulkResultsTitle.textContent = `Bulk results · ${results.length}`;
  clearChildren(els.bulkResultsList);

  results.forEach((r, idx) => {
    const li = el('li', { className: 'tk-bulk-item' });
    li.appendChild(el('div', { className: 'tk-bulk-item-num', text: String(idx + 1).padStart(2, '0') }));

    const body = el('div', { className: 'tk-bulk-item-body' });
    body.appendChild(el('div', { className: 'tk-bulk-item-input', text: r.input, title: r.input }));

    if (r.ok) {
      const finalText = r.summary?.cleanFinalUrl || r.summary?.finalUrl || '(no destination)';
      body.appendChild(el('div', { className: 'tk-bulk-item-output', text: finalText, title: finalText }));
    } else {
      body.appendChild(el('div', {
        className: 'tk-bulk-item-output is-error',
        text: friendlyError(r.error || 'failed'),
      }));
    }

    const stats = el('div', { className: 'tk-bulk-item-stats' });
    if (r.ok) {
      stats.textContent = `${r.summary.hops}h · ${formatMs(r.summary.totalDuration)}`;
    } else {
      stats.textContent = '—';
    }

    li.appendChild(body);
    li.appendChild(stats);

    if (r.ok) {
      li.addEventListener('click', () => {
        lastTrace = r;
        lastTrace._fromBulk = true;
        renderResults(r);
        setMode('single');
        setState('results');
      });
    }

    els.bulkResultsList.appendChild(li);
  });
}

// --- history ---
async function openHistory() {
  if (!isProUnlocked) return;
  setMode('history');
  setState('idle');
  await refreshHistoryList();
}

function closeHistory() {
  setMode('single');
  setState('idle');
}

async function refreshHistoryList() {
  let res;
  try {
    res = await sendMessage({ type: 'GET_HISTORY' });
  } catch {
    res = { ok: false };
  }
  const list = res?.ok ? res.history : [];
  clearChildren(els.historyList);
  if (!list.length) {
    els.historyEmpty.hidden = false;
    els.historyFoot.hidden = true;
    return;
  }
  els.historyEmpty.hidden = true;
  els.historyFoot.hidden = false;

  list.forEach((entry) => {
    els.historyList.appendChild(makeHistoryItem(entry));
  });
}

function makeHistoryItem(entry) {
  const item = el('button', {
    className: 'tk-history-item',
    title: entry.cleanFinalUrl || entry.finalUrl || entry.inputUrl,
  });
  item.type = 'button';

  const row1 = el('div', { className: 'tk-history-item-row1' });
  row1.appendChild(el('div', {
    className: 'tk-history-item-stats',
    text: `${entry.hops} hop${entry.hops === 1 ? '' : 's'} · ${formatMs(entry.totalDuration)}`,
  }));
  row1.appendChild(el('div', {
    className: 'tk-history-item-when',
    text: formatRelTime(entry.ts),
  }));
  item.appendChild(row1);

  item.appendChild(el('div', {
    className: 'tk-history-item-url',
    text: entry.cleanFinalUrl || entry.finalUrl || entry.inputUrl || '(no destination)',
  }));

  if (entry.networks && entry.networks.length > 0) {
    const tags = el('div', { className: 'tk-history-item-tags' });
    entry.networks.slice(0, 4).forEach((n) => tags.appendChild(renderNetworkBadge(n)));
    item.appendChild(tags);
  }

  item.addEventListener('click', () => {
    lastTrace = { ok: true, chain: entry.chain, summary: entry.summary };
    renderResults(lastTrace);
    setMode('single');
    setState('results');
  });

  return item;
}

async function refreshIdleRecent() {
  if (!isProUnlocked) {
    els.idleRecent.hidden = true;
    return;
  }
  let res;
  try {
    res = await sendMessage({ type: 'GET_HISTORY' });
  } catch {
    res = { ok: false };
  }
  const list = res?.ok ? res.history.slice(0, 5) : [];
  clearChildren(els.idleRecentList);
  if (!list.length) {
    els.idleRecent.hidden = true;
    return;
  }
  list.forEach((entry) => els.idleRecentList.appendChild(makeHistoryItem(entry)));
  els.idleRecent.hidden = false;
}

async function onClearHistory() {
  if (!confirm('Clear all trace history? This cannot be undone.')) return;
  await sendMessage({ type: 'CLEAR_HISTORY' });
  await refreshHistoryList();
}

// --- page scanner ---

async function openScanner() {
  if (!isProUnlocked) return;
  setMode('scanner');
  setState('idle');
  els.scannerScanning.hidden = false;
  els.scannerList.hidden = true;
  els.scannerEmpty.hidden = true;
  els.scannerFoot.hidden = true;

  let res;
  try {
    res = await sendMessage({ type: 'SCAN_PAGE_LINKS' });
  } catch {
    res = { ok: false, error: 'message-channel-failed' };
  }

  els.scannerScanning.hidden = true;

  if (!res?.ok || !res.links) {
    els.scannerEmpty.hidden = false;
    return;
  }
  scannerLinks = res.links;
  if (scannerLinks.length === 0) {
    els.scannerEmpty.hidden = false;
    return;
  }
  renderScannerLinks(scannerLinks);
}

function renderScannerLinks(links) {
  clearChildren(els.scannerList);
  links.forEach((link, idx) => {
    const li = el('li', { className: 'tk-scanner-item' });

    const badge = el('span', {
      className: 'tk-scanner-badge',
      title: link.type,
      style: { background: `${link.color}22`, borderColor: `${link.color}55`, color: link.color },
    });
    badge.appendChild(el('span', {
      className: 'tk-scanner-dot',
      style: { background: link.color },
    }));
    badge.appendChild(document.createTextNode(link.name));

    const body = el('div', { className: 'tk-scanner-body' });
    if (link.text) {
      body.appendChild(el('div', { className: 'tk-scanner-text', text: link.text, title: link.text }));
    }
    const shownUrl = link.displayUrl || link.url;
    body.appendChild(el('div', { className: 'tk-scanner-url', text: shownUrl, title: link.url }));

    const traceBtn = el('button', { className: 'tk-scanner-trace-btn', text: 'Trace' });
    traceBtn.type = 'button';
    traceBtn.addEventListener('click', () => {
      setMode('single');
      setState('idle');
      els.input.value = link.url;
      startTrace(link.url);
    });

    li.appendChild(badge);
    li.appendChild(body);
    li.appendChild(traceBtn);
    els.scannerList.appendChild(li);
  });

  const n = links.length;
  els.scannerCount.textContent = `${n} link${n === 1 ? '' : 's'} found`;
  els.scannerList.hidden = false;
  els.scannerFoot.hidden = false;
}

async function traceAllScanner() {
  if (!scannerLinks.length) return;
  const urls = scannerLinks.map(l => l.url).slice(0, 10);
  setMode('bulk');
  els.tracingLabel.textContent = `Tracing ${urls.length} links…`;
  els.tracingUrl.textContent = '';
  setState('tracing');

  let response;
  try {
    response = await sendMessage({ type: 'TRACE_BULK', urls });
  } catch (err) {
    showError(err.message || 'message-channel-failed');
    return;
  }
  if (!response?.ok) {
    showError(response?.error || 'unknown-error');
    return;
  }
  lastBulk = response;
  renderBulkResults(response);
  setMode('bulk');
  setState('results');
}

// --- webhook ---

async function sendToWebhook() {
  if (!lastTrace) return;
  const origLabel = els.webhookBtnLabel.textContent;
  els.webhookBtnLabel.textContent = 'Sending…';
  els.webhookBtn.disabled = true;

  let res;
  try {
    res = await sendMessage({
      type: 'SEND_WEBHOOK',
      payload: { type: 'trace', input: lastTrace.chain[0]?.url, ...{ chain: lastTrace.chain, summary: lastTrace.summary } },
    });
  } catch {
    res = { ok: false };
  }

  els.webhookBtn.disabled = false;
  els.webhookBtnLabel.textContent = res?.ok ? 'Sent!' : 'Failed';
  setTimeout(() => { els.webhookBtnLabel.textContent = origLabel; }, 1800);
}

// --- compare ---

function enterCompareMode() {
  if (!isProUnlocked) return;
  setMode('compare');
  setState('idle');
  setTimeout(() => els.compareUrlA?.focus(), 30);
  updateCompareBtn();
}

function exitCompareMode() {
  setMode('single');
  setState('idle');
}

function updateCompareBtn() {
  const a = (els.compareUrlA.value || '').trim();
  const b = (els.compareUrlB.value || '').trim();
  els.compareRunBtn.disabled = !(a && b);
}

async function runCompare() {
  const urlA = (els.compareUrlA.value || '').trim();
  const urlB = (els.compareUrlB.value || '').trim();
  if (!urlA || !urlB) return;

  setMode('compare');
  els.tracingLabel.textContent = 'Comparing…';
  els.tracingUrl.textContent = '';
  setState('tracing');

  let [resA, resB] = [null, null];
  try {
    [resA, resB] = await Promise.all([
      sendMessage({ type: 'TRACE', url: urlA }),
      sendMessage({ type: 'TRACE', url: urlB }),
    ]);
  } catch (err) {
    showError(err.message || 'message-channel-failed');
    return;
  }

  lastCompare = { a: resA, b: resB, urlA, urlB };
  renderCompareResults(lastCompare);
  setState('results');
}

function renderCompareResults({ a, b, urlA, urlB }) {
  const body = els.compareResultsBody;
  clearChildren(body);

  const finalA = a?.summary?.cleanFinalUrl || a?.summary?.finalUrl || '(error)';
  const finalB = b?.summary?.cleanFinalUrl || b?.summary?.finalUrl || '(error)';
  const sameDest = finalA === finalB;

  const diffCard = el('div', { className: 'tk-compare-diff' });

  const rowA = el('div', { className: 'tk-compare-diff-row' });
  rowA.appendChild(el('span', { className: 'tk-compare-side-label', text: 'A' }));
  rowA.appendChild(el('span', { className: 'tk-compare-diff-url', text: finalA, title: finalA }));
  const statsA = a?.summary ? `${a.summary.hops}h · ${formatMs(a.summary.totalDuration)}` : '—';
  rowA.appendChild(el('span', { className: 'tk-compare-diff-stats', text: statsA }));

  const rowB = el('div', { className: 'tk-compare-diff-row' });
  rowB.appendChild(el('span', { className: 'tk-compare-side-label', text: 'B' }));
  rowB.appendChild(el('span', { className: 'tk-compare-diff-url', text: finalB, title: finalB }));
  const statsB = b?.summary ? `${b.summary.hops}h · ${formatMs(b.summary.totalDuration)}` : '—';
  rowB.appendChild(el('span', { className: 'tk-compare-diff-stats', text: statsB }));

  diffCard.appendChild(rowA);
  diffCard.appendChild(rowB);

  const verdict = el('div', { className: `tk-compare-verdict ${sameDest ? 'is-same' : 'is-diff'}` });
  verdict.textContent = sameDest ? 'Same final destination' : 'Different final destinations';
  diffCard.appendChild(verdict);

  const networksA = (a?.summary?.networks || []).map(n => n.name).join(', ') || 'none';
  const networksB = (b?.summary?.networks || []).map(n => n.name).join(', ') || 'none';
  if (networksA !== networksB) {
    const netDiff = el('div', { className: 'tk-compare-net-diff' });
    netDiff.appendChild(el('span', { className: 'tk-compare-side-label', text: 'A' }));
    netDiff.appendChild(document.createTextNode(networksA));
    const netDiffB = el('div', { className: 'tk-compare-net-diff' });
    netDiffB.appendChild(el('span', { className: 'tk-compare-side-label', text: 'B' }));
    netDiffB.appendChild(document.createTextNode(networksB));
    const label = el('div', { className: 'tk-compare-section-label', text: 'Networks differ' });
    diffCard.appendChild(label);
    diffCard.appendChild(netDiff);
    diffCard.appendChild(netDiffB);
  }

  body.appendChild(diffCard);

  if (a?.chain?.length) {
    body.appendChild(renderCompactChain('A', a));
  }
  if (b?.chain?.length) {
    body.appendChild(renderCompactChain('B', b));
  }
}

function renderCompactChain(label, data) {
  const wrap = el('div', { className: 'tk-compare-chain' });
  wrap.appendChild(el('div', {
    className: 'tk-compare-chain-label',
    text: `Chain ${label}`,
  }));
  const ol = el('ol', { className: 'tk-compare-chain-list' });
  data.chain.forEach((hop) => {
    const li = el('li', { className: 'tk-compare-hop' });
    li.appendChild(el('span', {
      className: `tk-status ${statusClass(hop)}`,
      text: formatStatus(hop),
    }));
    li.appendChild(el('span', { className: 'tk-compare-hop-url', text: hop.url, title: hop.url }));
    ol.appendChild(li);
  });
  wrap.appendChild(ol);

  const cleanUrl = data.summary?.cleanFinalUrl || data.summary?.finalUrl || null;
  if (cleanUrl) {
    const actions = el('div', { className: 'tk-compare-chain-actions' });

    const copyBtn = el('button', { className: 'tk-compare-action-btn', text: 'Copy URL' });
    copyBtn.title = cleanUrl;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(cleanUrl).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 1500);
      });
    });
    actions.appendChild(copyBtn);

    const openBtn = el('button', { className: 'tk-compare-action-btn', text: 'Open' });
    openBtn.title = cleanUrl;
    openBtn.addEventListener('click', () => chrome.tabs.create({ url: cleanUrl }));
    actions.appendChild(openBtn);

    if (isProUnlocked) {
      const deepBtn = el('button', { className: 'tk-compare-action-btn tk-compare-action-deep', text: 'Deep trace' });
      deepBtn.title = cleanUrl;
      deepBtn.addEventListener('click', async () => {
        els.input.value = cleanUrl;
        setMode('single');
        els.tracingLabel.textContent = 'Running deep trace…';
        els.tracingUrl.textContent = compactUrlForDisplay(cleanUrl);
        els.tracingUrl.title = cleanUrl;
        setState('tracing');
        let res;
        try {
          res = await sendMessage({ type: 'DEEP_TRACE', url: cleanUrl });
        } catch (err) {
          showError(err.message || 'deep-trace-failed');
          return;
        }
        if (!res?.ok) { showError(res?.error || 'deep-trace-failed'); return; }
        lastTrace = res;
        renderResults(res);
        setState('results');
      });
      actions.appendChild(deepBtn);
    }

    wrap.appendChild(actions);
  }

  return wrap;
}

// --- pro state ---
async function refreshProState() {
  try {
    const state = await getProState();
    isProUnlocked = !!state.proUnlocked;
  } catch {
    isProUnlocked = false;
  }
  els.proPill.hidden = !isProUnlocked;
  $$('[data-pro-only]').forEach((el) => { el.hidden = !isProUnlocked; });

  if (els.exportWrap) {
    els.exportWrap.hidden = !(isProUnlocked && lastTrace);
  }

  if (isProUnlocked) {
    try {
      const settings = await getSettings();
      showWebhookButton = !!(settings.showWebhookButton && settings.webhookUrl);
    } catch {
      showWebhookButton = false;
    }
    if (els.webhookBtn) {
      els.webhookBtn.hidden = !(showWebhookButton && lastTrace);
    }
  }
  if (els.body.dataset.state === 'idle' && els.body.dataset.mode === 'single') {
    refreshIdleRecent();
  }
}

// --- event wiring ---
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  startTrace(els.input.value);
});

els.copyBtn.addEventListener('click', copyClean);
els.openBtn.addEventListener('click', openFinal);
els.newTraceBtn.addEventListener('click', resetToIdle);
els.homeBtn.addEventListener('click', () => {
  lastTrace = null;
  lastBulk = null;
  els.retryBtn.hidden = true;
  const span = els.newTraceBtn.querySelector('span');
  if (span) span.textContent = 'New trace';
  els.input.value = '';
  clearChildren(els.chainList);
  els.finalCard.hidden = true;
  if (els.webhookBtn) els.webhookBtn.hidden = true;
  setMode('single');
  setState('idle');
});
els.retryBtn.addEventListener('click', () => {
  const url = lastTrace?.chain?.[0]?.url;
  if (!url) return;
  els.input.value = url;
  startTrace(url);
});
els.errorBack.addEventListener('click', resetToIdle);
els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.deepTraceBtn.addEventListener('click', runDeepTrace);

els.bulkBtn.addEventListener('click', enterBulkMode);
els.bulkCancelBtn.addEventListener('click', exitBulkMode);
els.bulkBackBtn.addEventListener('click', () => {
  els.bulkInput.value = '';
  exitBulkMode();
  enterBulkMode();
});
els.bulkInput.addEventListener('input', updateBulkCount);
els.bulkRunBtn.addEventListener('click', runBulk);
els.bulkExportBtn.addEventListener('click', exportBulk);

els.historyBtn.addEventListener('click', openHistory);
els.historyClose.addEventListener('click', closeHistory);
els.historyClear.addEventListener('click', onClearHistory);
els.idleViewAllBtn.addEventListener('click', openHistory);

els.scannerBtn.addEventListener('click', openScanner);
els.scannerClose.addEventListener('click', () => { setMode('single'); setState('idle'); });
els.scannerTraceAll.addEventListener('click', traceAllScanner);

els.compareBtn.addEventListener('click', enterCompareMode);
els.compareClose.addEventListener('click', exitCompareMode);
els.compareNewBtn.addEventListener('click', () => { setState('idle'); });
els.compareUrlA.addEventListener('input', updateCompareBtn);
els.compareUrlB.addEventListener('input', updateCompareBtn);
els.compareRunBtn.addEventListener('click', runCompare);

els.webhookBtn.addEventListener('click', sendToWebhook);

els.exportBtn.addEventListener('click', () => toggleExportMenu());
els.exportMenu.addEventListener('click', (e) => {
  const target = e.target.closest('button[data-format]');
  if (!target) return;
  exportSingle(target.dataset.format);
});
document.addEventListener('click', (e) => {
  if (!els.exportWrap.contains(e.target)) toggleExportMenu(false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  // Context-menu "Trace this link" while the panel is already open.
  // background.js writes the URL to session storage; we pick it up here
  // without needing a page reload.
  if (area === 'session' && changes[PENDING_URL_KEY]) {
    const next = changes[PENDING_URL_KEY].newValue;
    if (next?.url && next.ts && Date.now() - next.ts < 15_000) {
      chrome.storage.session.remove(PENDING_URL_KEY).catch(() => {});
      setMode('single');
      setState('idle');
      els.input.value = next.url;
      startTrace(next.url);
    }
    return;
  }

  if (area === 'sync' && (changes[PRO_STORAGE_KEY] || changes[SETTINGS_KEY])) refreshProState();
  if (area === 'local' && changes[HISTORY_KEY]) {
    if (els.body.dataset.mode === 'history') refreshHistoryList();
    if (els.body.dataset.mode === 'single' && els.body.dataset.state === 'idle') refreshIdleRecent();
  }
  // Live render: if the popup was reopened *while* an incognito deep trace
  // was still in flight, the result lands in local storage AFTER init
  // already ran. Catch it here.
  //
  // CRITICAL: when the user clicks Deep trace in incognito mode, the popup
  // is in the process of closing (focus lost to the new incognito window)
  // at exactly the moment the SW writes the result. The listener may fire
  // during the popup's death throes — if we cleared storage here, the
  // entry would be gone before the next popup reopen could read it,
  // forcing the user into history. Only consume + clear when the popup
  // is actually visible (user is looking at it).
  if (area === 'local' && changes[LAST_DEEP_TRACE_KEY]) {
    const next = changes[LAST_DEEP_TRACE_KEY].newValue;
    if (!next?.result || !next.ts) return;
    if (Date.now() - next.ts >= LAST_DEEP_TRACE_MAX_AGE_MS) return;
    if (document.visibilityState !== 'visible') return; // popup closing — let init handle next open
    lastTrace = next.result;
    renderResults(next.result);
    setMode('single');
    setState('results');
    chrome.storage.local.remove(LAST_DEEP_TRACE_KEY).catch(() => {});
  }
});

// --- bootstrap ---
const LAST_DEEP_TRACE_KEY = 'tracekit:lastDeepTrace';
const LAST_DEEP_TRACE_MAX_AGE_MS = 120_000;
const PENDING_URL_KEY = 'tracekit:pendingUrl';

(async function init() {
  await refreshProState();

  // 1. If a deep trace just completed (within the last 2 minutes) and the
  // popup wasn't open to receive the result, render it now. This rescues the
  // incognito-deep-trace flow where the popup is closed by Chrome's window
  // focus shuffle before the result lands. Uses chrome.storage.local (not
  // session) — see background.js for the full reasoning.
  try {
    const stashed = await chrome.storage.local.get(LAST_DEEP_TRACE_KEY);
    const pending = stashed[LAST_DEEP_TRACE_KEY];
    if (pending?.result && pending.ts && Date.now() - pending.ts < LAST_DEEP_TRACE_MAX_AGE_MS) {
      lastTrace = pending.result;
      renderResults(pending.result);
      setMode('single');
      setState('results');
      // Clear so subsequent popup opens go to idle as normal.
      chrome.storage.local.remove(LAST_DEEP_TRACE_KEY).catch(() => {});
      return;
    }
  } catch {
    // fall through to context-menu pickup
  }

  // 2. Pick up a URL stashed by the context menu
  try {
    const res = await sendMessage({ type: 'GET_PENDING_URL' });
    if (res?.ok && res.pending?.url) {
      els.input.value = res.pending.url;
      startTrace(res.pending.url);
      return;
    }
  } catch {
    // fall through
  }
  setMode('single');
  setState('idle');
  refreshIdleRecent();
})();
