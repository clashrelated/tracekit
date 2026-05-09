// Pro-feature settings stored in chrome.storage.sync so toggles roam across
// signed-in Chrome profiles alongside the license.

const SETTINGS_KEY = 'tracekit:settings';

export { SETTINGS_KEY };

const DEFAULTS = {
  autoTrace: false,
  incognitoDeepTrace: false,
  webhookUrl: '',
  showWebhookButton: false,
  skipRedirects: false,
};

export async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = data[SETTINGS_KEY];
  return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
