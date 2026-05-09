// Redirect tracer for Chrome MV3 service workers.
//
// Why this is built around chrome.webRequest:
//   Cross-origin fetch responses with redirect: 'manual' are filtered to type
//   'opaqueredirect' — status is 0 and the Location header is stripped, so we
//   can't follow the chain by reading headers. Instead we let fetch follow
//   redirects (redirect: 'follow') while chrome.webRequest.onBeforeRedirect
//   observes every hop with full status + headers + redirectUrl.
//
// Refresh-header handling:
//   The browser does not honor `Refresh: <delay>; url=...` for fetch requests,
//   so an interstitial like l.facebook.com/l.php that ships a Refresh header
//   appears as a 200 final hop. When we detect a parseable Refresh header, we
//   issue a new traced fetch against the refresh target and append those hops.

const MAX_HOPS = 15;
const SINGLE_FETCH_TIMEOUT_MS = 12000;
const MAX_REFRESH_CHAINS = 5;
const MAX_BODY_REDIRECT_CHAINS = 5;
const BODY_FETCH_TIMEOUT_MS = 5000;
const BODY_SCAN_BYTES = 50 * 1024;

// Known redirect-wrapper URLs that encode the real destination as a query param.
// When the tracer lands on one of these at status 200 (JS-redirect page), we
// can skip body-scanning and extract the destination directly.
const KNOWN_WRAPPERS = [
  { rx: /^https?:\/\/l\.facebook\.com\/l\.php/i, param: 'u' },
  { rx: /^https?:\/\/l\.instagram\.com\/l\.php/i, param: 'u' },
  { rx: /^https?:\/\/l\.linkedin\.com\/l\.php/i, param: 'u' },
  { rx: /^https?:\/\/www\.google\.com\/url/i, param: 'q' },
  { rx: /^https?:\/\/out\.reddit\.com\/r\//i, param: 'url' },
  { rx: /^https?:\/\/(?:www\.)?youtube\.com\/redirect/i, param: 'q' },
  { rx: /^https?:\/\/(?:www\.)?youtube\.com\/attribution_link/i, param: 'u' },
  { rx: /^https?:\/\/l\.messenger\.com\/l\.php/i, param: 'u' },
];

function tryUnwrapKnown(url) {
  for (const w of KNOWN_WRAPPERS) {
    if (w.rx.test(url)) {
      try {
        const inner = new URL(url).searchParams.get(w.param);
        if (inner && /^https?:\/\//i.test(inner)) return inner;
      } catch {}
    }
  }
  return null;
}

export const TRACER_LIMITS = { MAX_HOPS, SINGLE_FETCH_TIMEOUT_MS };

const EXTENSION_ORIGIN = (() => {
  try {
    return chrome.runtime.getURL('').replace(/\/$/, '');
  } catch {
    return '';
  }
})();

export async function traceRedirects(startUrl, options = {}) {
  const maxHops = options.maxHops ?? MAX_HOPS;

  const normalized = normalizeStartUrl(startUrl);
  if (!normalized) {
    return [{
      url: String(startUrl ?? ''),
      status: null,
      duration: 0,
      nextUrl: null,
      headers: {},
      error: 'invalid-url',
      type: 'error',
      hopIndex: 0,
    }];
  }

  const allHops = [];
  let currentUrl = normalized;

  for (let chainAttempt = 0; chainAttempt < MAX_REFRESH_CHAINS; chainAttempt++) {
    const remaining = maxHops - allHops.length;
    if (remaining <= 0) break;

    const hops = await traceSingleFetch(currentUrl, remaining, SINGLE_FETCH_TIMEOUT_MS);

    for (const h of hops) {
      h.hopIndex = allHops.length;
      allHops.push(h);
      if (allHops.length >= maxHops) break;
    }

    const last = allHops[allHops.length - 1];
    if (!last || last.error || allHops.length >= maxHops) break;
    if (last.status == null || last.status < 200 || last.status >= 400) break;

    const refreshHeader = last.headers && last.headers.refresh;
    if (!refreshHeader) break;

    const target = parseRefreshHeader(refreshHeader);
    if (!target) {
      last.finalReason = 'refresh-unparseable';
      break;
    }

    const resolved = resolveUrl(target, last.url);
    if (!resolved) {
      last.finalReason = 'refresh-unparseable';
      break;
    }
    if (allHops.some((h) => h.url === resolved)) {
      last.finalReason = 'refresh-loop';
      break;
    }

    last.nextUrl = resolved;
    last.type = 'refresh-redirect';
    last.refreshHeader = refreshHeader;
    last.finalReason = null;
    currentUrl = resolved;
  }

  // ── Known-wrapper pass: if the chain ended at a URL that encodes its real
  // destination as a query param (e.g. youtube.com/redirect?q=...), extract
  // and continue tracing without needing to scan the body.
  {
    const last = allHops[allHops.length - 1];
    if (last && !last.error && !last.nextUrl && last.status >= 200 && last.status < 300 && allHops.length < maxHops) {
      const inner = tryUnwrapKnown(last.url);
      if (inner) {
        const resolved = resolveUrl(inner, last.url);
        if (resolved && !allHops.some((h) => h.url === resolved)) {
          last.nextUrl = resolved;
          last.type = 'unwrap-redirect';
          last.finalReason = null;
          const remaining = maxHops - allHops.length;
          const extraHops = await traceSingleFetch(resolved, remaining, SINGLE_FETCH_TIMEOUT_MS);
          for (const h of extraHops) {
            h.hopIndex = allHops.length;
            allHops.push(h);
            if (allHops.length >= maxHops) break;
          }
        }
      }
    }
  }

  // ── Body-parsing pass: catch simple JS redirects (window.location = "...",
  // location.replace(...), <meta http-equiv="refresh">) that the HTTP-level
  // tracer can't see. Only triggered when the chain ends at a 200/HTML hop
  // with no nextUrl — i.e. the page would have continued in a real browser
  // but the tracer thinks it's "final".
  for (let bodyAttempt = 0; bodyAttempt < MAX_BODY_REDIRECT_CHAINS; bodyAttempt++) {
    if (allHops.length >= maxHops) break;
    const last = allHops[allHops.length - 1];
    if (!last || last.error || last.nextUrl) break;
    if (last.status == null || last.status < 200 || last.status >= 300) break;
    const ct = (last.headers && last.headers['content-type']) || '';
    if (!ct.toLowerCase().includes('text/html')) break;

    const detected = await detectClientRedirectInBody(last.url, BODY_FETCH_TIMEOUT_MS);
    if (!detected) break;

    const resolved = resolveUrl(detected.target, last.url);
    if (!resolved) break;
    if (allHops.some((h) => h.url === resolved)) {
      last.finalReason = 'body-redirect-loop';
      break;
    }

    last.nextUrl = resolved;
    last.type = detected.kind === 'meta' ? 'meta-redirect' : 'js-redirect';
    last.bodyDetected = detected.kind;
    last.finalReason = null;

    const remaining = maxHops - allHops.length;
    const hops = await traceSingleFetch(resolved, remaining, SINGLE_FETCH_TIMEOUT_MS);
    for (const h of hops) {
      h.hopIndex = allHops.length;
      allHops.push(h);
      if (allHops.length >= maxHops) break;
    }
  }

  if (allHops.length >= maxHops) {
    const tail = allHops[allHops.length - 1];
    if (tail && tail.nextUrl) tail.truncated = true;
  }

  return allHops;
}

function traceSingleFetch(startUrl, hopsBudget, timeoutMs) {
  return new Promise((resolveTrace) => {
    const hops = [makeHopShell(startUrl)];
    const startTimes = [Date.now()];
    let requestId = null;
    let settled = false;

    const onBeforeRequest = (details) => {
      if (settled || requestId !== null) return;
      if (details.initiator && EXTENSION_ORIGIN && details.initiator !== EXTENSION_ORIGIN) return;
      if (!urlsMatch(details.url, startUrl)) return;
      requestId = details.requestId;
    };

    const onBeforeRedirect = (details) => {
      if (settled || details.requestId !== requestId) return;

      const last = hops[hops.length - 1];
      last.duration = Date.now() - startTimes[startTimes.length - 1];
      last.status = details.statusCode;
      last.headers = headersArrayToObj(details.responseHeaders);
      last.nextUrl = details.redirectUrl;
      last.type = 'redirect';

      if (hops.length >= hopsBudget) {
        last.truncated = true;
        finalize();
        return;
      }

      hops.push(makeHopShell(details.redirectUrl));
      startTimes.push(Date.now());
    };

    const onCompleted = (details) => {
      if (settled || details.requestId !== requestId) return;

      const last = hops[hops.length - 1];
      last.duration = Date.now() - startTimes[startTimes.length - 1];
      last.status = details.statusCode;
      last.headers = headersArrayToObj(details.responseHeaders);
      last.nextUrl = null;
      last.type = classifyTerminalStatus(details.statusCode);
      last.finalReason = deriveFinalReason(details.statusCode, last.headers.refresh);
      finalize();
    };

    const onErrorOccurred = (details) => {
      if (settled || details.requestId !== requestId) return;

      const last = hops[hops.length - 1];
      last.duration = Date.now() - startTimes[startTimes.length - 1];
      last.error = normalizeNetError(details.error);
      last.type = 'error';
      finalize();
    };

    function finalize() {
      if (settled) return;
      settled = true;
      try {
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
        chrome.webRequest.onBeforeRedirect.removeListener(onBeforeRedirect);
        chrome.webRequest.onCompleted.removeListener(onCompleted);
        chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
      } catch {}
      clearTimeout(timer);
      resolveTrace(hops);
    }

    const filter = { urls: ['<all_urls>'] };
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter);
    chrome.webRequest.onBeforeRedirect.addListener(
      onBeforeRedirect,
      filter,
      ['responseHeaders', 'extraHeaders'],
    );
    chrome.webRequest.onCompleted.addListener(
      onCompleted,
      filter,
      ['responseHeaders', 'extraHeaders'],
    );
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);

    const timer = setTimeout(() => {
      if (settled) return;
      const last = hops[hops.length - 1];
      last.duration = Date.now() - startTimes[startTimes.length - 1];
      last.error = 'timeout';
      last.type = 'error';
      finalize();
    }, timeoutMs);

    fetch(startUrl, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
    }).catch(() => {
      // The webRequest path captures the chain; failures here are surfaced
      // via onErrorOccurred. We swallow this rejection so the promise chain
      // doesn't bubble an unhandled error.
    });
  });
}

function makeHopShell(url) {
  return {
    url,
    status: null,
    duration: 0,
    nextUrl: null,
    headers: {},
    type: 'unknown',
  };
}

function classifyTerminalStatus(status) {
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  if (status >= 200 && status < 300) return 'final';
  return 'unknown';
}

function deriveFinalReason(status, refreshHeader) {
  if (status >= 200 && status < 300) {
    if (refreshHeader && !parseRefreshHeader(refreshHeader)) return 'refresh-unparseable';
    return 'ok';
  }
  if (status >= 400 && status < 500) return 'client-error';
  if (status >= 500) return 'server-error';
  return 'unknown';
}

function normalizeNetError(err) {
  if (!err || typeof err !== 'string') return 'network-error';
  if (err.includes('ABORTED')) return 'aborted';
  if (err.includes('TIMED_OUT')) return 'timeout';
  if (err.includes('TOO_MANY_REDIRECTS')) return 'too-many-redirects';
  if (err.includes('NAME_NOT_RESOLVED')) return 'dns-failure';
  if (err.includes('CERT')) return 'cert-error';
  return err.replace(/^net::ERR_/, '').toLowerCase().replace(/_/g, '-');
}

function urlsMatch(a, b) {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

function headersArrayToObj(arr) {
  if (!Array.isArray(arr)) return {};
  const obj = {};
  for (const item of arr) {
    if (item && item.name) obj[item.name.toLowerCase()] = item.value ?? '';
  }
  return obj;
}

function normalizeStartUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function resolveUrl(location, base) {
  if (!location) return null;
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

// Fetches the first BODY_SCAN_BYTES of an HTML document and scans for inline
// JS redirects or <meta http-equiv="refresh">. Returns { kind, target } or
// null. Used as a body-parsing pass after the HTTP-level trace ends at a
// 200/HTML hop — catches the simple "window.location = '...'" landing-page
// pattern that opens up a meaningful chunk of the redirect-tracing space
// without needing the full incognito deep trace.
async function detectClientRedirectInBody(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        // Some pages serve different markup based on the UA; mimic a real
        // Chrome request so we see what the user would actually see.
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    if (!res.ok || !res.body) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('text/html')) return null;

    // Read up to BODY_SCAN_BYTES then bail — we don't need the whole document.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < BODY_SCAN_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => {});

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(merged);
    return scanHtmlForRedirect(html);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Scans HTML for redirect patterns. Returns { kind: 'meta' | 'js', target }
// or null. Restricts JS pattern matching to inside <script> blocks so we
// don't flag attribute handlers like <button onclick="location='/help'">.
function scanHtmlForRedirect(html) {
  if (typeof html !== 'string' || !html) return null;
  const head = html.length > BODY_SCAN_BYTES ? html.slice(0, BODY_SCAN_BYTES) : html;

  // 1. <meta http-equiv="refresh" content="0;url=...">
  const metaRx = /<meta[^>]*http-equiv\s*=\s*['"]?refresh['"]?[^>]*content\s*=\s*['"]([^'"]*)['"]/i;
  const metaMatch = head.match(metaRx);
  if (metaMatch) {
    const content = metaMatch[1] || '';
    const urlMatch = content.match(/url\s*=\s*(.+)$/i);
    if (urlMatch) {
      const target = urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (target) return { kind: 'meta', target };
    }
  }

  // 2. JS redirects inside <script> blocks
  const scriptRx = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const jsPatterns = [
    /(?:window\s*\.\s*)?location\s*\.\s*href\s*=\s*['"]([^'"]+)['"]/,
    /(?:window\s*\.\s*)?location\s*\.\s*replace\s*\(\s*['"]([^'"]+)['"]/,
    /(?:window\s*\.\s*)?location\s*\.\s*assign\s*\(\s*['"]([^'"]+)['"]/,
    /window\s*\.\s*location\s*=\s*['"]([^'"]+)['"]/,
    /(?:^|[\s;{])location\s*=\s*['"]([^'"]+)['"]/,
  ];
  for (const scriptMatch of head.matchAll(scriptRx)) {
    const body = scriptMatch[1] || '';
    for (const rx of jsPatterns) {
      const m = body.match(rx);
      if (m && m[1]) return { kind: 'js', target: m[1] };
    }
  }

  return null;
}

// Parses an HTTP Refresh header. Format: "<delay>; url=<target>" or just "<delay>".
// Returns the target URL string, or null if there is none.
function parseRefreshHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const semi = value.indexOf(';');
  if (semi === -1) return null;
  const rest = value.slice(semi + 1).trim();
  const m = rest.match(/^url\s*=\s*(['"]?)(.+?)\1\s*$/i);
  if (!m) return null;
  const target = m[2].trim();
  return target || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Deep trace (Pro): opens the URL in a hidden background tab and observes the
// browser's actual navigation chain — including JS-driven `window.location`
// redirects, meta-refresh redirects in the body, and Auth0/Clerk-style
// client-gated routes. Closes the tab when navigation settles.
//
// Distinguishes HTTP redirects (same requestId, surfaced via onBeforeRedirect)
// from JS redirects (a fresh main_frame request with a new requestId).
// ──────────────────────────────────────────────────────────────────────────────

const DEEP_DEFAULT_MAX_MS = 15000;
const DEEP_DEFAULT_SETTLE_MS = 2500;

export async function deepTraceUrl(startUrl, options = {}) {
  const normalized = normalizeStartUrl(startUrl);
  if (!normalized) {
    return [{
      url: String(startUrl ?? ''),
      status: null,
      duration: 0,
      nextUrl: null,
      headers: {},
      error: 'invalid-url',
      type: 'error',
      hopIndex: 0,
    }];
  }

  const maxMs = options.maxMs ?? DEEP_DEFAULT_MAX_MS;
  const settleMs = options.settleMs ?? DEEP_DEFAULT_SETTLE_MS;
  const useIncognito = !!options.useIncognito;

  // Two execution modes:
  //   • Tab mode (default): hidden background tab in current window. Smooth
  //     UX, no window choreography, but uses the user's normal session.
  //   • Incognito mode (opt-in): isolated cookies/history but Chrome+macOS
  //     focus-stealing causes the popup to close and (on multi-Space) the
  //     OS to switch Mission Control. Power users who want isolation can
  //     turn this on in Settings.
  let tabId, windowId;
  let cleanupTarget; // 'tab' or 'window'

  if (useIncognito) {
    let allowsIncognito = false;
    try {
      allowsIncognito = await chrome.extension.isAllowedIncognitoAccess();
    } catch {
      allowsIncognito = false;
    }
    if (!allowsIncognito) {
      return [{
        url: normalized, status: null, duration: 0, nextUrl: null,
        headers: {}, error: 'incognito-required', type: 'error', hopIndex: 0,
      }];
    }

    let originalWindowId = null;
    try {
      const orig = await chrome.windows.getLastFocused({ populate: false });
      originalWindowId = orig?.id ?? null;
    } catch {
      originalWindowId = null;
    }

    let win;
    try {
      win = await chrome.windows.create({
        url: 'about:blank',
        incognito: true,
        focused: false,
        type: 'popup',
        width: 200,
        height: 200,
        top: 0,
        left: 0,
      });
    } catch (err) {
      return [{
        url: normalized, status: null, duration: 0, nextUrl: null,
        headers: {}, error: `incognito-create-failed: ${err?.message || 'unknown'}`,
        type: 'error', hopIndex: 0,
      }];
    }
    tabId = win.tabs?.[0]?.id;
    windowId = win.id;
    if (tabId == null || windowId == null) {
      if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
      return [{
        url: normalized, status: null, duration: 0, nextUrl: null,
        headers: {}, error: 'incognito-no-tab', type: 'error', hopIndex: 0,
      }];
    }

    if (originalWindowId != null && originalWindowId !== windowId) {
      chrome.windows.update(originalWindowId, { focused: true }).catch(() => {});
    }
    chrome.windows.update(windowId, { state: 'minimized', focused: false }).catch(() => {});
    cleanupTarget = 'window';
  } else {
    // Use a dedicated minimized popup window instead of a background tab in the
    // user's main window. A background tab causes macOS to switch Mission Control
    // spaces when Chrome's window lives on a different Space.
    let win;
    try {
      win = await chrome.windows.create({
        url: 'about:blank',
        focused: false,
        type: 'popup',
        width: 200,
        height: 200,
        top: 0,
        left: 0,
      });
    } catch (err) {
      return [{
        url: normalized, status: null, duration: 0, nextUrl: null,
        headers: {}, error: `tab-create-failed: ${err?.message || 'unknown'}`,
        type: 'error', hopIndex: 0,
      }];
    }
    tabId = win.tabs?.[0]?.id;
    windowId = win.id;
    if (tabId == null || windowId == null) {
      if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
      return [{
        url: normalized, status: null, duration: 0, nextUrl: null,
        headers: {}, error: 'tab-no-id', type: 'error', hopIndex: 0,
      }];
    }
    chrome.windows.update(windowId, { state: 'minimized', focused: false }).catch(() => {});
    cleanupTarget = 'window';
  }

  return new Promise((resolveTrace) => {
    const hops = [];
    const startTimes = new Map(); // hopIndex -> ms
    const activeByRequestId = new Map(); // requestId -> hopIndex
    let lastRequestId = null;
    let settled = false;
    let settleTimer = null;

    function pushHop(url) {
      hops.push({
        url,
        status: null,
        duration: 0,
        nextUrl: null,
        headers: {},
        type: 'unknown',
      });
      const idx = hops.length - 1;
      startTimes.set(idx, Date.now());
      return idx;
    }

    function scheduleSettle() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finalize, settleMs);
    }

    const onBeforeRequest = (details) => {
      if (details.tabId !== tabId) return;
      if (details.type !== 'main_frame') return;

      // A new requestId for the same tab means a fresh navigation. If the
      // previous hop landed on a 200 with no Location header, this is the JS
      // redirect we couldn't observe at the HTTP level.
      const isFreshNavigation = lastRequestId !== null && details.requestId !== lastRequestId;
      lastRequestId = details.requestId;

      if (isFreshNavigation && hops.length > 0) {
        const prev = hops[hops.length - 1];
        if (prev && !prev.nextUrl && prev.status >= 200 && prev.status < 300) {
          prev.nextUrl = details.url;
          prev.type = 'js-redirect';
        }
      }

      const idx = pushHop(details.url);
      activeByRequestId.set(details.requestId, idx);
    };

    const onBeforeRedirect = (details) => {
      if (details.tabId !== tabId) return;
      if (details.type !== 'main_frame') return;

      const idx = activeByRequestId.get(details.requestId);
      if (idx === undefined) return;

      const hop = hops[idx];
      hop.status = details.statusCode;
      hop.headers = headersArrayToObj(details.responseHeaders);
      hop.nextUrl = details.redirectUrl;
      hop.type = 'redirect';
      hop.duration = Date.now() - (startTimes.get(idx) || Date.now());

      const newIdx = pushHop(details.redirectUrl);
      activeByRequestId.set(details.requestId, newIdx);
    };

    const onCompleted = (details) => {
      if (details.tabId !== tabId) return;
      if (details.type !== 'main_frame') return;

      const idx = activeByRequestId.get(details.requestId);
      if (idx === undefined) return;

      const hop = hops[idx];
      hop.status = details.statusCode;
      hop.headers = headersArrayToObj(details.responseHeaders);
      hop.duration = Date.now() - (startTimes.get(idx) || Date.now());
      hop.type = classifyTerminalStatus(details.statusCode);
      hop.finalReason = deriveFinalReason(details.statusCode, hop.headers.refresh);

      scheduleSettle();
    };

    const onErrorOccurred = (details) => {
      if (details.tabId !== tabId) return;
      if (details.type !== 'main_frame') return;

      const idx = activeByRequestId.get(details.requestId);
      if (idx === undefined) return;

      const hop = hops[idx];
      hop.error = normalizeNetError(details.error);
      hop.type = 'error';
      hop.duration = Date.now() - (startTimes.get(idx) || Date.now());
      scheduleSettle();
    };

    function cleanupListeners() {
      try {
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
        chrome.webRequest.onBeforeRedirect.removeListener(onBeforeRedirect);
        chrome.webRequest.onCompleted.removeListener(onCompleted);
        chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
      } catch {}
      if (settleTimer) clearTimeout(settleTimer);
    }

    function finalize() {
      if (settled) return;
      settled = true;
      cleanupListeners();
      if (cleanupTarget === 'window' && windowId != null) {
        chrome.windows.remove(windowId).catch(() => {});
      } else {
        chrome.tabs.remove(tabId).catch(() => {});
      }

      // If somehow we observed nothing, surface a minimal hop so the UI
      // doesn't render an empty result.
      if (hops.length === 0) {
        hops.push({
          url: normalized,
          status: null,
          duration: 0,
          nextUrl: null,
          headers: {},
          error: 'no-events',
          type: 'error',
        });
      }

      hops.forEach((h, i) => { h.hopIndex = i; });
      resolveTrace(hops);
    }

    const filter = { urls: ['<all_urls>'] };
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter);
    chrome.webRequest.onBeforeRedirect.addListener(
      onBeforeRedirect,
      filter,
      ['responseHeaders', 'extraHeaders'],
    );
    chrome.webRequest.onCompleted.addListener(
      onCompleted,
      filter,
      ['responseHeaders', 'extraHeaders'],
    );
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);

    // Listeners are armed — now navigate the about:blank tab to the real URL.
    // Doing this *after* listener registration is what guarantees we see the
    // first request, even for instantly-loading pages.
    chrome.tabs.update(tabId, { url: normalized }).catch((err) => {
      if (settled) return;
      const idx = pushHop(normalized);
      hops[idx].error = `tab-update-failed: ${err?.message || 'unknown'}`;
      hops[idx].type = 'error';
      finalize();
    });

    setTimeout(() => finalize(), maxMs);
  });
}
