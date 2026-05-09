import { traceRedirects, deepTraceUrl } from './utils/tracer.js';
import { classifyChain, detectNetwork, AFFILIATE_NETWORKS } from './utils/affiliates.js';
import { parseParams, summarizeChainParams, getCleanFinalUrl } from './utils/params.js';
import { isPro } from './utils/license.js';
import { saveToHistory, getHistory, clearHistory } from './utils/history.js';
import { getSettings, updateSettings, SETTINGS_KEY } from './utils/settings.js';
import { STORAGE_KEY as PRO_STORAGE_KEY } from './utils/license.js';

const CONTEXT_MENU_ID = 'tracekit-trace-link';
const PENDING_URL_KEY = 'tracekit:pendingUrl';
const LAST_DEEP_TRACE_KEY = 'tracekit:lastDeepTrace';
const AUTOTRACE_SCRIPT_ID = 'tracekit-autotrace';
const SKIP_REDIRECT_SCRIPT_ID = 'tracekit-skip-redirect';

const FREE_HOP_LIMIT = 15;
const PRO_HOP_LIMIT = 25;
const BULK_MAX = 10;

chrome.runtime.onInstalled.addListener(async () => {
  registerContextMenu();
  await syncAutoTraceRegistration();
  await syncSkipRedirectRegistration();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  registerContextMenu();
  await syncAutoTraceRegistration();
  await syncSkipRedirectRegistration();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Trace this link with TraceKit',
      contexts: ['link'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const url = info.linkUrl;
  if (!url) return;

  await chrome.storage.session.set({
    [PENDING_URL_KEY]: { url, ts: Date.now() },
  });

  // Open (or focus) the side panel. If the panel is already open the
  // storage.session.onChanged listener in popup.js picks up the new URL;
  // if it was closed, init() handles it on load.
  try {
    const opts = tab?.windowId != null ? { windowId: tab.windowId } : {};
    await chrome.sidePanel.open(opts);
  } catch {
    // sidePanel.open unavailable on this build — no popup fallback needed
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  switch (message.type) {
    case 'TRACE': {
      handleTrace(message.url, message.options).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'trace-failed' });
      });
      return true;
    }
    case 'TRACE_BULK': {
      handleBulkTrace(message.urls, message.options).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'bulk-trace-failed' });
      });
      return true;
    }
    case 'DEEP_TRACE': {
      handleDeepTrace(message.url).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'deep-trace-failed' });
      });
      return true;
    }
    case 'GET_PENDING_URL': {
      chrome.storage.session.get(PENDING_URL_KEY).then((data) => {
        const pending = data[PENDING_URL_KEY] || null;
        sendResponse({ ok: true, pending });
        if (pending) chrome.storage.session.remove(PENDING_URL_KEY);
      });
      return true;
    }
    case 'GET_HISTORY': {
      getHistory().then((list) => sendResponse({ ok: true, history: list }));
      return true;
    }
    case 'CLEAR_HISTORY': {
      clearHistory().then(() => sendResponse({ ok: true }));
      return true;
    }
    case 'SET_AUTOTRACE': {
      handleSetAutoTrace(!!message.enabled).then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'autotrace-failed' });
      });
      return true;
    }
    case 'SET_SKIP_REDIRECT': {
      handleSetSkipRedirect(!!message.enabled).then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'skip-redirect-failed' });
      });
      return true;
    }
    case 'SCAN_PAGE_LINKS': {
      handleScanPageLinks().then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'scan-failed' });
      });
      return true;
    }
    case 'SEND_WEBHOOK': {
      handleSendWebhook(message.payload).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message || 'webhook-failed' });
      });
      return true;
    }
    default:
      return false;
  }
});

async function handleTrace(url, options) {
  const pro = await isPro();
  const planLimit = pro ? PRO_HOP_LIMIT : FREE_HOP_LIMIT;
  const requested = options?.maxHops ?? planLimit;
  const maxHops = Math.min(requested, planLimit);

  const chain = await traceRedirects(url, { ...(options || {}), maxHops });
  const enriched = enrichChain(chain);
  const result = { ok: true, ...enriched };

  saveToHistory(result).catch(() => {});

  if (pro) {
    const settings = await getSettings();
    if (settings.webhookUrl && !settings.showWebhookButton) {
      handleSendWebhook({ type: 'trace', input: url, ...enriched }).catch(() => {});
    }
  }

  return result;
}

async function handleDeepTrace(url) {
  if (!(await isPro())) {
    return { ok: false, error: 'pro-required' };
  }
  const settings = await getSettings();
  const chain = await deepTraceUrl(url, { useIncognito: settings.incognitoDeepTrace });

  // Bail-out errors before any navigation observation — surface them as a
  // structured failure so the popup can render a contextual UX instead
  // of a generic chain-with-error.
  const firstHop = chain[0];
  if (chain.length === 1 && firstHop?.error) {
    const code = firstHop.error;
    if (
      code === 'invalid-url' ||
      code === 'tab-create-failed' || code === 'tab-no-id' ||
      code === 'incognito-required' ||
      (typeof code === 'string' && code.startsWith('incognito-'))
    ) {
      return { ok: false, error: code };
    }
  }

  const enriched = enrichChain(chain);
  const result = { ok: true, deep: true, ...enriched };

  // Persist the result so it survives the popup closing (which happens on
  // macOS when incognito mode steals focus). Awaited rather than fire-and-
  // forget so MV3 can't suspend the worker before the write commits.
  //
  // Uses chrome.storage.local (not session): Playwright + headed Chromium
  // testing showed chrome.storage.session writes from a message-handler
  // context were getting lost when the SW suspended after responding,
  // even though docs claim session persists across SW restarts. Local is
  // unconditionally persistent. The 2-minute timestamp check on the popup
  // side already handles stale-result expiry.
  try {
    await chrome.storage.local.set({
      [LAST_DEEP_TRACE_KEY]: { ts: Date.now(), result },
    });
  } catch (err) {
    console.error('[TraceKit] failed to stash deep trace result:', err);
  }
  saveToHistory(result).catch(() => {});

  return result;
}

async function handleBulkTrace(urls, options) {
  if (!(await isPro())) {
    return { ok: false, error: 'pro-required' };
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    return { ok: false, error: 'no-urls' };
  }

  const limit = Math.min(urls.length, BULK_MAX);
  const planLimit = PRO_HOP_LIMIT;
  const requested = options?.maxHops ?? planLimit;
  const maxHops = Math.min(requested, planLimit);

  const results = [];
  for (let i = 0; i < limit; i++) {
    const url = urls[i];
    try {
      const chain = await traceRedirects(url, { ...(options || {}), maxHops });
      const enriched = enrichChain(chain);
      const result = { input: url, ok: true, ...enriched };
      results.push(result);
      saveToHistory(result).catch(() => {});
    } catch (err) {
      results.push({ input: url, ok: false, error: err?.message || 'trace-failed' });
    }
  }
  return { ok: true, results };
}

function enrichChain(chain) {
  const totalDuration = chain.reduce((sum, h) => sum + (h.duration || 0), 0);
  const networks = classifyChain(chain);
  const trackingParams = summarizeChainParams(chain);
  const cleanFinalUrl = getCleanFinalUrl(chain);
  const finalHop = chain[chain.length - 1] || null;

  const annotated = chain.map((hop) => ({
    ...hop,
    network: detectNetwork(hop.url),
    params: parseParams(hop.url),
  }));

  return {
    chain: annotated,
    summary: {
      hops: chain.length,
      totalDuration,
      networks,
      trackingParams,
      cleanFinalUrl,
      finalUrl: finalHop?.url || null,
      finalStatus: finalHop?.status ?? null,
      truncated: !!annotated[annotated.length - 1]?.truncated,
      hadError: chain.some((h) => h.error),
    },
  };
}

// --- Page link scanner ---

async function handleScanPageLinks() {
  if (!(await isPro())) return { ok: false, error: 'pro-required' };
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return { ok: false, error: 'no-active-tab' };

  const patternDefs = AFFILIATE_NETWORKS.map(n => ({
    rx: n.pattern.source,
    flags: n.pattern.flags,
    name: n.name,
    color: n.color,
    type: n.type,
  }));

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (defs) => {
        const pats = defs.map(({ rx, flags, name, color, type }) => ({
          rx: new RegExp(rx, flags), name, color, type,
        }));

        // Social wrapper patterns: the real URL lives in a query param.
        // We check both the wrapper AND the decoded inner URL so we surface
        // the inner link even if it's not in our pattern database.
        const wrappers = [
          { rx: /^https?:\/\/l\.facebook\.com\/l\.php/i, param: 'u' },
          { rx: /^https?:\/\/l\.instagram\.com\/l\.php/i, param: 'u' },
          { rx: /^https?:\/\/l\.linkedin\.com\/l\.php/i, param: 'u' },
          { rx: /^https?:\/\/www\.google\.com\/url/i, param: 'q' },
          { rx: /^https?:\/\/out\.reddit\.com\/r\//i, param: 'url' },
          { rx: /^https?:\/\/(?:www\.)?youtube\.com\/redirect/i, param: 'q' },
          { rx: /^https?:\/\/(?:www\.)?youtube\.com\/attribution_link/i, param: 'u' },
          { rx: /^https?:\/\/l\.messenger\.com\/l\.php/i, param: 'u' },
        ];

        function tryUnwrap(url) {
          for (const w of wrappers) {
            if (w.rx.test(url)) {
              try {
                const inner = new URL(url).searchParams.get(w.param);
                if (inner && inner.startsWith('http')) return inner;
              } catch {}
            }
          }
          return null;
        }

        const TRACKING_PARAMS = new Set([
          'fbclid', 'fb_action_ids', 'fb_ref', 'fb_source',
          'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
          'gclid', 'msclkid', 'mc_eid', 'igshid', '_openstat', 'twclid',
        ]);
        function dedupKey(url) {
          try {
            const u = new URL(url);
            for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
            return u.toString();
          } catch { return url; }
        }

        function matchPat(url) {
          for (const p of pats) if (p.rx.test(url)) return p;
          return null;
        }

        const seen = new Set();
        const found = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href;
          if (!href || !href.startsWith('http')) return;

          let hit = matchPat(href);
          let traceUrl = href;

          if (!hit) {
            const inner = tryUnwrap(href);
            if (inner) {
              hit = matchPat(inner);
              // Even if inner doesn't match a pattern, wrapper itself matched
              // via our l.facebook.com entry — re-check the wrapper
              if (!hit) hit = matchPat(href);
              if (hit) traceUrl = href; // trace from the wrapper (full chain)
            }
          }

          const inner = tryUnwrap(traceUrl);
          const displayUrl = inner || traceUrl;

          // Deduplicate by destination with tracking params stripped — different
          // fbclid/utm values on the same link produce distinct raw URLs but
          // identical destinations.
          const key = dedupKey(displayUrl);
          if (!hit || seen.has(key)) return;
          seen.add(key);

          const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
          found.push({
            url: traceUrl,
            displayUrl,
            name: hit.name,
            color: hit.color,
            type: hit.type,
            text,
          });
        });
        return found;
      },
      args: [patternDefs],
    });
  } catch {
    return { ok: false, error: 'scan-inject-failed' };
  }

  const links = results?.[0]?.result || [];
  return { ok: true, links };
}

// --- Webhook ---

async function handleSendWebhook(payload) {
  const settings = await getSettings();
  if (!settings.webhookUrl) return { ok: false, error: 'no-webhook-url' };
  try {
    const res = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sentAt: new Date().toISOString() }),
    });
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'fetch-failed' };
  }
}

// --- Auto-trace registration ---

async function handleSetAutoTrace(enabled) {
  if (enabled && !(await isPro())) {
    return { ok: false, error: 'pro-required' };
  }
  await updateSettings({ autoTrace: enabled });
  await syncAutoTraceRegistration();
  return { ok: true, enabled };
}

// Serialize autotrace (un)register calls — both the SET_AUTOTRACE handler and
// the storage.onChanged listener can fire syncs ~simultaneously when a toggle
// flips, and concurrent register calls race into "Duplicate script ID" errors.
let autoTraceMutex = Promise.resolve();

function syncAutoTraceRegistration() {
  autoTraceMutex = autoTraceMutex.then(doSyncAutoTraceRegistration).catch(() => {});
  return autoTraceMutex;
}

async function doSyncAutoTraceRegistration() {
  const pro = await isPro();
  const settings = await getSettings();
  const shouldRun = pro && settings.autoTrace === true;

  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTOTRACE_SCRIPT_ID] });
  } catch {
    registered = [];
  }
  const isRegistered = registered.some((s) => s.id === AUTOTRACE_SCRIPT_ID);

  if (shouldRun && !isRegistered) {
    try {
      await chrome.scripting.registerContentScripts([{
        id: AUTOTRACE_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['content/scan.js'],
        runAt: 'document_idle',
        allFrames: false,
      }]);
    } catch (err) {
      // Duplicate-ID errors mean a concurrent call already registered it — benign.
      const msg = String(err?.message || err);
      if (!msg.includes('Duplicate script ID')) {
        console.error('[TraceKit] failed to register auto-trace:', err);
      }
    }
  } else if (!shouldRun && isRegistered) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [AUTOTRACE_SCRIPT_ID] });
    } catch (err) {
      console.error('[TraceKit] failed to unregister auto-trace:', err);
    }
  }
}

// Re-sync both scripts if Pro state or settings change in any context.
chrome.storage.onChanged.addListener((changes, area) => {
  const proChanged = area === 'sync' && changes[PRO_STORAGE_KEY];
  const settingsChanged = area === 'sync' && changes[SETTINGS_KEY];
  if (proChanged || settingsChanged) {
    syncAutoTraceRegistration().catch(() => {});
    syncSkipRedirectRegistration().catch(() => {});
  }
});

// --- Skip-redirect registration ---

async function handleSetSkipRedirect(enabled) {
  if (enabled && !(await isPro())) {
    return { ok: false, error: 'pro-required' };
  }
  await updateSettings({ skipRedirects: enabled });
  await syncSkipRedirectRegistration();
  return { ok: true, enabled };
}

let skipRedirectMutex = Promise.resolve();

function syncSkipRedirectRegistration() {
  skipRedirectMutex = skipRedirectMutex.then(doSyncSkipRedirectRegistration).catch(() => {});
  return skipRedirectMutex;
}

async function doSyncSkipRedirectRegistration() {
  const pro = await isPro();
  const settings = await getSettings();
  const shouldRun = pro && settings.skipRedirects === true;

  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SKIP_REDIRECT_SCRIPT_ID] });
  } catch {
    registered = [];
  }
  const isRegistered = registered.some((s) => s.id === SKIP_REDIRECT_SCRIPT_ID);

  if (shouldRun && !isRegistered) {
    try {
      await chrome.scripting.registerContentScripts([{
        id: SKIP_REDIRECT_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['content/skip-redirect.js'],
        runAt: 'document_idle',
        allFrames: false,
      }]);
    } catch (err) {
      const msg = String(err?.message || err);
      if (!msg.includes('Duplicate script ID')) {
        console.error('[TraceKit] failed to register skip-redirect:', err);
      }
    }
  } else if (!shouldRun && isRegistered) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [SKIP_REDIRECT_SCRIPT_ID] });
    } catch (err) {
      console.error('[TraceKit] failed to unregister skip-redirect:', err);
    }
  }
}
