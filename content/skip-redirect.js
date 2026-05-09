// Skip-redirect content script (Pro feature).
//
// Intercepts link clicks on known shortener / affiliate / tracking URLs and
// navigates straight to the resolved final destination, skipping every hop.
//
// On known social platforms (Facebook, Twitter/X, Instagram, LinkedIn, Reddit)
// we intercept ALL external link clicks because those platforms wrap every
// outbound href through their own tracker regardless of the raw href value.
// Facebook in particular stores the clean destination in the <a href> and
// rewrites navigation through l.facebook.com via a mousedown handler —
// so we intercept mousedown in the capture phase (fires before their JS).

(function () {
  if (window.__tracekitSkipRedirectInit) return;
  window.__tracekitSkipRedirectInit = true;

  // --- pattern list (known shorteners / affiliate / tracking domains) ---
  const PATTERNS = [
    /\.sjv\.io/i, /\.pxf\.io/i, /\.dpbolvw\.net/i, /\.7eer\.net/i,
    /\.evyy\.net/i, /\.ojrq\.net/i, /impact\.com/i,
    /shareasale\.com/i, /\.tkqlhce\.com/i,
    /\.anrdoezrs\.net/i, /\.jdoqocy\.com/i, /\.kqzyfj\.com/i,
    /commission-junction\.com/i, /\.cj\.com/i,
    /awin1\.com/i, /\.awin\.com/i, /\.zenaps\.com/i,
    /rakutenmarketing\.com/i, /linksynergy\.com/i,
    /partnerstack\.com/i, /\.pstmrk\.it/i,
    /hop\.clickbank\.net/i, /clickbank\.net/i,
    /amzn\.to/i, /amazon\.[a-z.]+\/.*[?&]tag=/i,
    /flexoffers\.com/i, /flexlinkspro\.com/i,
    /go\.skimresources\.com/i, /skimlinks\.com/i, /\.redirectingat\.com/i,
    /avantlink\.com/i,
    /pepperjamnetwork\.com/i, /pjtra\.com/i, /partnerize\.com/i, /prf\.hn/i,
    /refersion\.com/i, /firstpromoter\.com/i, /tapfiliate\.com/i,
    /rewardful\.com/i, /rwrd\.li/i,
    /^https?:\/\/(www\.)?bit\.ly\//i,
    /^https?:\/\/t\.co\//i,
    /^https?:\/\/(www\.)?ow\.ly\//i,
    /^https?:\/\/(www\.)?tinyurl\.com\//i,
    /^https?:\/\/(www\.)?buff\.ly\//i,
    /^https?:\/\/lnkd\.in\//i,
    /^https?:\/\/(www\.)?fb\.me\//i,
    /^https?:\/\/rebrand\.ly\//i,
    /^https?:\/\/short\.io\//i,
    /^https?:\/\/l\.facebook\.com\/l\.php/i,
    /^https?:\/\/l\.instagram\.com\/l\.php/i,
    /^https?:\/\/l\.linkedin\.com\/l\.php/i,
    /^https?:\/\/out\.reddit\.com\/r\//i,
  ];

  // Social platforms where ALL outbound links get intercepted because the
  // platform wraps clicks through its own tracker at JS level.
  const SOCIAL_HOSTS = [
    /(?:^|\.)facebook\.com$/i,
    /(?:^|\.)instagram\.com$/i,
    /(?:^|\.)twitter\.com$/i,
    /(?:^|\.)x\.com$/i,
    /(?:^|\.)linkedin\.com$/i,
    /(?:^|\.)reddit\.com$/i,
    /(?:^|\.)pinterest\.com$/i,
  ];

  const onSocialPlatform = SOCIAL_HOSTS.some(rx => rx.test(location.hostname));

  function isTracked(url) {
    if (!url || !url.startsWith('http')) return false;
    for (const rx of PATTERNS) if (rx.test(url)) return true;
    return false;
  }

  function isExternalLink(url) {
    try {
      return new URL(url).hostname !== location.hostname;
    } catch { return false; }
  }

  const AFFILIATE_PARAMS = /[?&](?:ref|refid|referral|aff_id|affid|partner_id)=/i;

  function hasAffiliateParam(url) {
    try { return AFFILIATE_PARAMS.test(new URL(url).search); } catch { return false; }
  }

  function shouldIntercept(url) {
    if (!url || !url.startsWith('http')) return false;
    if (isTracked(url)) return true;
    if (hasAffiliateParam(url)) return true;
    // On social platforms intercept all outbound links
    if (onSocialPlatform && isExternalLink(url)) return true;
    return false;
  }

  // --- toast ---
  let toastEl = null;
  function showToast(msg) {
    if (!toastEl) {
      const style = document.createElement('style');
      style.textContent = '@keyframes tk-sr-pulse{0%,100%{opacity:.3}50%{opacity:1}}';
      document.head.appendChild(style);

      toastEl = document.createElement('div');
      toastEl.setAttribute('data-tracekit-toast', '1');
      toastEl.style.cssText = [
        'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647',
        'background:#1a1a2e', 'color:#c4c4e0',
        'font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
        'padding:8px 16px', 'border-radius:20px',
        'border:1px solid rgba(108,99,255,0.4)',
        'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
        'pointer-events:none', 'user-select:none',
        'display:flex', 'align-items:center', 'gap:8px',
        'opacity:0', 'transition:opacity 0.15s',
      ].join(';');

      const dot = document.createElement('span');
      dot.style.cssText = [
        'width:6px', 'height:6px', 'border-radius:50%',
        'background:#6c63ff',
        'animation:tk-sr-pulse 1s infinite ease-in-out',
      ].join(';');
      toastEl.appendChild(dot);
      toastEl.appendChild(document.createTextNode(''));
      document.body.appendChild(toastEl);
    }
    toastEl.lastChild.textContent = msg;
    requestAnimationFrame(() => { toastEl.style.opacity = '1'; });
  }
  function hideToast() {
    if (toastEl) toastEl.style.opacity = '0';
  }

  // --- navigation ---
  function navigate(url, target) {
    if (!target || target === '_self' || target === '') {
      location.href = url;
    } else if (target === '_blank' || target === '_new') {
      window.open(url, '_blank', 'noopener');
    } else {
      window.open(url, target);
    }
  }

  // --- interception ---
  // Track which anchors have a pending trace so the click handler can suppress them.
  const pendingAnchors = new WeakSet();

  // Use mousedown (capture phase) to fire before the platform's own JS handlers.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left click only
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // modifier pass-through

    const a = e.target.closest('a[href]');
    if (!a) return;

    const href = a.href;
    if (!shouldIntercept(href)) return;

    // Immediately block so the platform's JS doesn't open its own tab.
    e.preventDefault();
    e.stopImmediatePropagation();

    const target = a.target || '';
    pendingAnchors.add(a);
    showToast('Resolving redirect…');

    chrome.runtime.sendMessage({ type: 'TRACE', url: href })
      .then((res) => {
        pendingAnchors.delete(a);
        hideToast();
        const finalUrl = (res?.ok && (res.summary?.cleanFinalUrl || res.summary?.finalUrl)) || href;
        navigate(finalUrl, target);
      })
      .catch(() => {
        pendingAnchors.delete(a);
        hideToast();
        navigate(href, target); // fallback to original URL
      });
  }, true);

  // Also suppress the click event on any anchor that's already being traced.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && pendingAnchors.has(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
