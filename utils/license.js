// License management for TraceKit Pro.
//
// Verify URL is the single integration point with the licensing backend
// (Phase 3b — separate Vercel project). Until that is deployed, calls will
// fail gracefully with a descriptive error and the UI surfaces it.
//
// Contract with the backend:
//   POST <VERIFY_URL>
//   Content-Type: application/json
//   Body:   { "key": "<license-key>", "product": "tracekit-pro" }
//   Reply (always 200):
//     ok:    { ok: true,  product, email, purchasedAt }
//     fail:  { ok: false, error: "not-found"|"wrong-product"|"rate-limited"|... }

export const LICENSE_VERIFY_URL = 'https://extensions-licenses.vercel.app/api/license/verify';

export const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/14A8wO840goe56t1QD4ow04';

export const PRODUCT_ID = 'tracekit-pro';
export const STORAGE_KEY = 'tracekit:pro';
const DEVICE_ID_KEY = 'tracekit:deviceId';

// Per-Chrome-installation device ID, used by the licensing backend to enforce
// the per-license device cap. Stored in chrome.storage.local (NOT sync) so
// each Chrome installation registers as its own "device".
async function getOrCreateDeviceId() {
  const data = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (data[DEVICE_ID_KEY]) return data[DEVICE_ID_KEY];
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? `dev_${crypto.randomUUID()}`
    : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

export async function getProState() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  const state = data[STORAGE_KEY];
  if (!state || typeof state !== 'object') {
    return { proUnlocked: false };
  }
  return {
    proUnlocked: !!state.proUnlocked,
    licenseKey: state.licenseKey || null,
    email: state.email || null,
    verifiedAt: state.verifiedAt || null,
    purchasedAt: state.purchasedAt || null,
  };
}

export async function isPro() {
  const s = await getProState();
  return s.proUnlocked === true;
}

export async function verifyLicense(rawKey) {
  const key = (rawKey || '').trim();
  if (!key) return { ok: false, error: 'empty-key' };
  if (key.length < 6) return { ok: false, error: 'key-too-short' };

  const deviceId = await getOrCreateDeviceId();

  let res;
  try {
    res = await fetch(LICENSE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, product: PRODUCT_ID, deviceId }),
    });
  } catch (err) {
    if (LICENSE_VERIFY_URL.includes('example.invalid')) {
      return { ok: false, error: 'backend-not-configured' };
    }
    return { ok: false, error: 'network-error' };
  }

  if (res.status === 429) {
    return { ok: false, error: 'rate-limited' };
  }
  if (!res.ok) {
    return { ok: false, error: `http-${res.status}` };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'bad-response' };
  }

  if (!data?.ok) {
    // Pass through structured failure data so the UI can show the device count
    // when the user has hit the limit.
    return {
      ok: false,
      error: data?.error || 'invalid-license',
      deviceLimit: data?.deviceLimit ?? null,
      deviceCount: data?.deviceCount ?? null,
    };
  }
  if (data.product !== PRODUCT_ID) {
    return { ok: false, error: 'wrong-product' };
  }

  const record = {
    proUnlocked: true,
    licenseKey: key,
    email: data.email || null,
    purchasedAt: data.purchasedAt || null,
    verifiedAt: new Date().toISOString(),
    deviceLimit: data.deviceLimit ?? null,
    deviceCount: data.deviceCount ?? null,
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: record });

  return { ok: true, ...record };
}

export async function clearLicense() {
  await chrome.storage.sync.remove(STORAGE_KEY);
}

export const LICENSE_ERROR_MESSAGES = {
  'empty-key': 'Paste your license key first.',
  'key-too-short': 'That key looks too short.',
  'backend-not-configured': 'Licensing backend is not deployed yet.',
  'network-error': 'Could not reach the licensing server.',
  'bad-response': 'The licensing server returned an unexpected response.',
  'not-found': "We couldn't find that license key.",
  'wrong-product': 'That key is for a different product.',
  'rate-limited': 'Too many attempts. Try again in a minute.',
  'device-limit-reached': 'This license is already active on the maximum number of devices. Reply to your license email to reset.',
  'invalid-license': "That license key isn't valid.",
};

export function describeLicenseError(code, extra = {}) {
  if (code === 'device-limit-reached' && extra && extra.deviceLimit) {
    return `This license is already active on ${extra.deviceLimit} devices. Reply to your license email to reset.`;
  }
  return LICENSE_ERROR_MESSAGES[code] || (code?.startsWith('http-') ? `Server error (${code})` : code);
}
