import {
  verifyLicense,
  clearLicense,
  getProState,
  describeLicenseError,
  STRIPE_CHECKOUT_URL,
  STORAGE_KEY,
} from '../utils/license.js';
import { getSettings, updateSettings, SETTINGS_KEY } from '../utils/settings.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  body: document.body,
  card: $('#status-card'),
  title: $('#status-title'),
  sub: $('#status-sub'),
  upgradeBtn: $('#upgrade-btn'),
  manageBtn: $('#manage-btn'),
  licenseInput: $('#license-input'),
  verifyBtn: $('#verify-btn'),
  feedback: $('#license-feedback'),
  licenseSection: $('#license-section'),
  versionTag: $('#version-tag'),
  footerVersion: $('#footer-version'),
  // toggles
  autotraceToggle: $('#autotrace-toggle'),
  autotraceInput: $('#autotrace-input'),
  autotraceHint: $('#autotrace-hint'),
  incognitoToggle: $('#incognito-toggle'),
  incognitoInput: $('#incognito-input'),
  incognitoHint: $('#incognito-hint'),
  // skip redirects
  skipRedirectToggle: $('#skip-redirect-toggle'),
  skipRedirectInput: $('#skip-redirect-input'),
  skipRedirectHint: $('#skip-redirect-hint'),
  // webhook
  webhookButtonToggle: $('#webhook-button-toggle'),
  webhookButtonInput: $('#webhook-button-input'),
  webhookButtonHint: $('#webhook-button-hint'),
  webhookUrlInput: $('#webhook-url-input'),
  webhookSaveBtn: $('#webhook-save-btn'),
  webhookFeedback: $('#webhook-feedback'),
};

function setVersion() {
  const manifest = chrome.runtime.getManifest();
  const v = `v${manifest.version}`;
  els.versionTag.textContent = v;
  els.footerVersion.textContent = v;
}

function setFeedback(message, kind) {
  els.feedback.textContent = message || '';
  els.feedback.classList.remove('is-success', 'is-error', 'is-info');
  if (kind) els.feedback.classList.add(`is-${kind}`);
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
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

function renderState(state) {
  const isPro = !!state.proUnlocked;
  els.body.dataset.pro = String(isPro);
  els.card.dataset.state = isPro ? 'pro' : 'free';

  if (isPro) {
    els.title.textContent = 'Pro unlocked';
    clearChildren(els.sub);
    if (state.email) {
      els.sub.appendChild(document.createTextNode('Verified for '));
      els.sub.appendChild(el('span', { className: 'tk-mono', text: state.email }));
    } else {
      els.sub.appendChild(document.createTextNode('All Pro features active.'));
    }
    els.upgradeBtn.hidden = true;
    els.manageBtn.hidden = false;
    els.licenseSection.hidden = true;
  } else {
    els.title.textContent = 'Free tier';
    els.sub.textContent = 'All core features active. Upgrade to unlock export, bulk trace, history, and more.';
    els.upgradeBtn.hidden = false;
    els.manageBtn.hidden = true;
    els.licenseSection.hidden = false;
  }

  // Toggles only enable when Pro
  els.autotraceInput.disabled = !isPro;
  els.autotraceToggle.classList.toggle('is-disabled', !isPro);
  els.autotraceHint.hidden = isPro;

  els.incognitoInput.disabled = !isPro;
  els.incognitoToggle.classList.toggle('is-disabled', !isPro);
  els.incognitoHint.hidden = isPro;

  els.skipRedirectInput.disabled = !isPro;
  els.skipRedirectToggle.classList.toggle('is-disabled', !isPro);
  els.skipRedirectHint.hidden = isPro;

  els.webhookButtonInput.disabled = !isPro;
  els.webhookButtonToggle.classList.toggle('is-disabled', !isPro);
  els.webhookButtonHint.hidden = isPro;
  els.webhookUrlInput.disabled = !isPro;
  els.webhookSaveBtn.disabled = !isPro;
}

async function refresh() {
  const [state, settings] = await Promise.all([getProState(), getSettings()]);
  renderState(state);
  els.autotraceInput.checked = !!settings.autoTrace;
  els.incognitoInput.checked = !!settings.incognitoDeepTrace;
  els.skipRedirectInput.checked = !!settings.skipRedirects;
  els.webhookButtonInput.checked = !!settings.showWebhookButton;
  els.webhookUrlInput.value = settings.webhookUrl || '';
}

async function onVerify() {
  const key = els.licenseInput.value;
  setFeedback('Verifying…', 'info');
  els.verifyBtn.disabled = true;

  const result = await verifyLicense(key);

  els.verifyBtn.disabled = false;

  if (!result.ok) {
    setFeedback(
      describeLicenseError(result.error, {
        deviceLimit: result.deviceLimit,
        deviceCount: result.deviceCount,
      }),
      'error',
    );
    return;
  }

  setFeedback('License verified — Pro unlocked.', 'success');
  els.licenseInput.value = '';
  await refresh();
}

async function onUpgrade() {
  if (STRIPE_CHECKOUT_URL.includes('example.invalid')) {
    setFeedback(
      'Checkout link not yet configured (Phase 3b). Once the Stripe Payment Link is live, this button will open it.',
      'info',
    );
    return;
  }
  chrome.tabs.create({ url: STRIPE_CHECKOUT_URL });
}

async function onManage() {
  if (!confirm('Remove your Pro license from this browser? You can re-verify the same key any time.')) {
    return;
  }
  await clearLicense();
  setFeedback('License removed.', 'info');
  await refresh();
}

async function onAutotraceToggle(e) {
  if (els.autotraceInput.disabled) {
    e.preventDefault();
    return;
  }
  const enabled = els.autotraceInput.checked;
  const res = await sendMessage({ type: 'SET_AUTOTRACE', enabled });
  if (!res?.ok) {
    // revert
    els.autotraceInput.checked = !enabled;
    setFeedback(`Could not toggle auto-trace: ${res?.error || 'unknown'}`, 'error');
  } else {
    setFeedback(
      enabled
        ? 'Auto-trace on — open any page to see tracking links highlighted.'
        : 'Auto-trace off.',
      'info',
    );
  }
}

async function onIncognitoDeepTraceToggle(e) {
  if (els.incognitoInput.disabled) {
    e.preventDefault();
    return;
  }
  const enabled = els.incognitoInput.checked;
  // No listener wiring needed — incognito mode is read by background.js's
  // handleDeepTrace at trace time straight from chrome.storage.sync.
  await updateSettings({ incognitoDeepTrace: enabled });
  setFeedback(
    enabled
      ? 'Deep trace will now run in an isolated incognito window. On macOS this may briefly switch Spaces.'
      : 'Deep trace will run in a hidden background tab in your current window.',
    'info',
  );
}

async function onSkipRedirectToggle(e) {
  if (els.skipRedirectInput.disabled) { e.preventDefault(); return; }
  const enabled = els.skipRedirectInput.checked;
  const res = await sendMessage({ type: 'SET_SKIP_REDIRECT', enabled });
  if (!res?.ok) {
    els.skipRedirectInput.checked = !enabled;
    setFeedback(`Could not toggle: ${res?.error || 'unknown'}`, 'error');
  } else {
    setFeedback(
      enabled
        ? 'Skip redirects on — clicking shortener/affiliate links will go straight to the destination.'
        : 'Skip redirects off.',
      'info',
    );
  }
}

async function onWebhookButtonToggle(e) {
  if (els.webhookButtonInput.disabled) { e.preventDefault(); return; }
  const enabled = els.webhookButtonInput.checked;
  await updateSettings({ showWebhookButton: enabled });
  setFeedback(
    enabled
      ? 'Webhook button will appear in trace results.'
      : 'Traces will auto-post to your webhook URL.',
    'info',
  );
}

async function onWebhookSave() {
  const url = els.webhookUrlInput.value.trim();
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    setFeedback('URL must start with http:// or https://', 'error');
    return;
  }
  await updateSettings({ webhookUrl: url });
  setFeedback(url ? 'Webhook URL saved.' : 'Webhook URL cleared.', 'success');
}

// Event wiring
els.verifyBtn.addEventListener('click', onVerify);
els.licenseInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    onVerify();
  }
});
els.upgradeBtn.addEventListener('click', onUpgrade);
els.manageBtn.addEventListener('click', onManage);
els.autotraceInput.addEventListener('change', onAutotraceToggle);
els.incognitoInput.addEventListener('change', onIncognitoDeepTraceToggle);
els.skipRedirectInput.addEventListener('change', onSkipRedirectToggle);
els.webhookButtonInput.addEventListener('change', onWebhookButtonToggle);
els.webhookSaveBtn.addEventListener('click', onWebhookSave);
els.webhookUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); onWebhookSave(); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes[STORAGE_KEY] || changes[SETTINGS_KEY])) {
    refresh();
  }
});

setVersion();
refresh();
