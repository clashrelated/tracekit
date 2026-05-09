// Auto-trace content script (Pro feature).
//
// Registered programmatically by background.js when (a) Pro is unlocked and
// (b) the auto-trace toggle is on. Scans every <a href> on the page once at
// document_idle, decorates anything matching a known affiliate / shortener /
// tracking pattern with a small monospace badge.
//
// All work is local. We never fetch or call out — pattern detection only.

(function () {
  if (window.__tracekitAutoTraceRan) return;
  window.__tracekitAutoTraceRan = true;

  const PATTERNS = [
    // Affiliate networks
    { rx: /\.sjv\.io/i,             name: 'Impact',        color: '#6C63FF' },
    { rx: /\.pxf\.io/i,             name: 'Impact',        color: '#6C63FF' },
    { rx: /\.dpbolvw\.net/i,        name: 'Impact',        color: '#6C63FF' },
    { rx: /\.7eer\.net/i,           name: 'Impact',        color: '#6C63FF' },
    { rx: /\.evyy\.net/i,           name: 'Impact',        color: '#6C63FF' },
    { rx: /shareasale\.com/i,       name: 'ShareASale',    color: '#FF6B35' },
    { rx: /\.tkqlhce\.com/i,        name: 'ShareASale',    color: '#FF6B35' },
    { rx: /\.anrdoezrs\.net/i,      name: 'CJ',            color: '#00C2FF' },
    { rx: /\.jdoqocy\.com/i,        name: 'CJ',            color: '#00C2FF' },
    { rx: /\.kqzyfj\.com/i,         name: 'CJ',            color: '#00C2FF' },
    { rx: /awin1\.com/i,            name: 'Awin',          color: '#E91E8C' },
    { rx: /\.zenaps\.com/i,         name: 'Awin',          color: '#E91E8C' },
    { rx: /linksynergy\.com/i,      name: 'Rakuten',       color: '#BF0000' },
    { rx: /rakutenmarketing\.com/i, name: 'Rakuten',       color: '#BF0000' },
    { rx: /partnerstack\.com/i,     name: 'PartnerStack',  color: '#4CAF50' },
    { rx: /\.pstmrk\.it/i,          name: 'PartnerStack',  color: '#4CAF50' },
    { rx: /hop\.clickbank\.net/i,   name: 'ClickBank',     color: '#FFC107' },
    { rx: /amzn\.to/i,              name: 'Amazon',        color: '#FF9900' },
    { rx: /amazon\.[a-z.]+\/.*[?&]tag=/i, name: 'Amazon',  color: '#FF9900' },
    { rx: /skimlinks\.com/i,        name: 'Skimlinks',     color: '#00B7C3' },
    { rx: /go\.skimresources\.com/i, name: 'Skimlinks',    color: '#00B7C3' },
    { rx: /\.redirectingat\.com/i,  name: 'Skimlinks',     color: '#00B7C3' },
    { rx: /flexoffers\.com/i,       name: 'FlexOffers',    color: '#0099CC' },
    { rx: /pjtra\.com/i,            name: 'Pepperjam',     color: '#9C27B0' },
    { rx: /partnerize\.com/i,       name: 'Partnerize',    color: '#9C27B0' },
    { rx: /prf\.hn/i,               name: 'Partnerize',    color: '#9C27B0' },
    { rx: /refersion\.com/i,        name: 'Refersion',     color: '#FF4081' },
    { rx: /tapfiliate\.com/i,       name: 'Tapfiliate',    color: '#00BCD4' },
    { rx: /rewardful\.com/i,        name: 'Rewardful',     color: '#FF6F61' },
    { rx: /rwrd\.li/i,              name: 'Rewardful',     color: '#FF6F61' },
    { rx: /firstpromoter\.com/i,    name: 'FirstPromoter', color: '#673AB7' },

    // Generic affiliate params (any domain with ?ref=, ?aff_id=, etc.)
    { rx: /[?&](?:ref|refid|referral|aff_id|affid|partner_id)=/i, name: 'Referral', color: '#9E9E9E' },

    // Shorteners
    { rx: /^https?:\/\/(www\.)?bit\.ly\//i,    name: 'Bitly',     color: '#EE6123' },
    { rx: /^https?:\/\/t\.co\//i,              name: 'Twitter',   color: '#1DA1F2' },
    { rx: /^https?:\/\/(www\.)?ow\.ly\//i,     name: 'ow.ly',     color: '#143059' },
    { rx: /^https?:\/\/(www\.)?tinyurl\.com\//i, name: 'TinyURL', color: '#888888' },
    { rx: /^https?:\/\/(www\.)?buff\.ly\//i,   name: 'Buffer',    color: '#168EEA' },
    { rx: /^https?:\/\/lnkd\.in\//i,           name: 'LinkedIn',  color: '#0A66C2' },
    { rx: /^https?:\/\/(www\.)?fb\.me\//i,     name: 'Facebook',  color: '#1877F2' },
    { rx: /^https?:\/\/rebrand\.ly\//i,        name: 'Rebrandly', color: '#00B14F' },
  ];

  function detect(url) {
    if (!url || typeof url !== 'string') return null;
    for (const p of PATTERNS) {
      if (p.rx.test(url)) return p;
    }
    return null;
  }

  function decorate(anchor, hit) {
    if (anchor.dataset.tracekitTagged) return;
    anchor.dataset.tracekitTagged = '1';

    const badge = document.createElement('span');
    badge.textContent = hit.name;
    badge.setAttribute('data-tracekit-badge', '1');
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'margin:0 0 0 4px',
      'padding:1px 5px',
      'font-size:10px',
      'font-weight:600',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#fff',
      `background:${hit.color}`,
      'border-radius:3px',
      'vertical-align:middle',
      'line-height:1.4',
      'pointer-events:none',
      'text-decoration:none',
      'box-shadow:0 0 0 1px rgba(0,0,0,0.15)',
      'z-index:auto',
    ].join(';');
    badge.title = `TraceKit: detected ${hit.name} tracking link`;

    try {
      anchor.appendChild(badge);
    } catch {
      // Some sites freeze anchors in odd ways; bail silently.
    }
  }

  function scan(root) {
    const anchors = root.querySelectorAll('a[href]');
    let tagged = 0;
    for (const a of anchors) {
      const hit = detect(a.href);
      if (hit) {
        decorate(a, hit);
        tagged++;
      }
    }
    return tagged;
  }

  scan(document);

  // Re-scan when the page injects new content (SPAs, infinite scroll, comment threads).
  // Throttled — we don't want to re-scan on every keystroke in an editor.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      scan(document);
    }, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
