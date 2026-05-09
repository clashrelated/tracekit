// Local-only trace history. Pro users get the last 50 traces stored in
// chrome.storage.local; everything stays on-device.

import { isPro } from './license.js';

const HISTORY_KEY = 'tracekit:history';
const MAX_HISTORY = 50;

export { HISTORY_KEY };

export async function saveToHistory(traceResult) {
  if (!(await isPro())) return;
  if (!traceResult || !traceResult.chain || !traceResult.summary) return;

  const entry = {
    id: cryptoRandomId(),
    ts: Date.now(),
    inputUrl: traceResult.chain[0]?.url || '',
    cleanFinalUrl: traceResult.summary.cleanFinalUrl,
    finalUrl: traceResult.summary.finalUrl,
    hops: traceResult.summary.hops,
    totalDuration: traceResult.summary.totalDuration,
    networks: traceResult.summary.networks,
    truncated: traceResult.summary.truncated,
    hadError: traceResult.summary.hadError,
    chain: traceResult.chain.map(compactHop),
    summary: traceResult.summary,
  };

  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

export async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

export async function getHistoryEntry(id) {
  const list = await getHistory();
  return list.find((e) => e.id === id) || null;
}

export async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

// Strip raw HTTP headers from saved entries — they balloon storage and we
// don't surface them in the history view anyway. Keeps each entry around
// ~200 bytes per hop so 50 traces fit well inside chrome.storage.local.
function compactHop(hop) {
  return {
    url: hop.url,
    status: hop.status,
    duration: hop.duration,
    nextUrl: hop.nextUrl,
    type: hop.type,
    network: hop.network || null,
    error: hop.error || null,
    refreshHeader: hop.refreshHeader || null,
    finalReason: hop.finalReason || null,
    truncated: !!hop.truncated,
    hopIndex: hop.hopIndex,
    params: hop.params ? { tracking: hop.params.tracking, cleanUrl: hop.params.cleanUrl } : null,
  };
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
