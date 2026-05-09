export const AFFILIATE_NETWORKS = [
  // Impact (formerly Impact Radius)
  { pattern: /\.sjv\.io/i,             name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /\.pxf\.io/i,             name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /\.dpbolvw\.net/i,        name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /\.7eer\.net/i,           name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /\.evyy\.net/i,           name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /\.ojrq\.net/i,           name: 'Impact',           color: '#6C63FF', type: 'affiliate' },
  { pattern: /impact\.com/i,           name: 'Impact',           color: '#6C63FF', type: 'affiliate' },

  // ShareASale
  { pattern: /shareasale\.com/i,       name: 'ShareASale',       color: '#FF6B35', type: 'affiliate' },
  { pattern: /\.tkqlhce\.com/i,        name: 'ShareASale',       color: '#FF6B35', type: 'affiliate' },

  // CJ Affiliate (Commission Junction)
  { pattern: /\.anrdoezrs\.net/i,      name: 'CJ Affiliate',     color: '#00C2FF', type: 'affiliate' },
  { pattern: /\.jdoqocy\.com/i,        name: 'CJ Affiliate',     color: '#00C2FF', type: 'affiliate' },
  { pattern: /\.kqzyfj\.com/i,         name: 'CJ Affiliate',     color: '#00C2FF', type: 'affiliate' },
  { pattern: /\.tkqlhce\.com/i,        name: 'CJ Affiliate',     color: '#00C2FF', type: 'affiliate' },
  { pattern: /commission-junction\.com/i, name: 'CJ Affiliate',  color: '#00C2FF', type: 'affiliate' },
  { pattern: /\.cj\.com/i,             name: 'CJ Affiliate',     color: '#00C2FF', type: 'affiliate' },

  // Awin
  { pattern: /awin1\.com/i,            name: 'Awin',             color: '#E91E8C', type: 'affiliate' },
  { pattern: /\.awin\.com/i,           name: 'Awin',             color: '#E91E8C', type: 'affiliate' },
  { pattern: /\.zenaps\.com/i,         name: 'Awin',             color: '#E91E8C', type: 'affiliate' },

  // Rakuten Advertising (LinkShare)
  { pattern: /rakutenmarketing\.com/i, name: 'Rakuten',          color: '#BF0000', type: 'affiliate' },
  { pattern: /linksynergy\.com/i,      name: 'Rakuten',          color: '#BF0000', type: 'affiliate' },
  { pattern: /\.linksynergy\.com/i,    name: 'Rakuten',          color: '#BF0000', type: 'affiliate' },

  // PartnerStack
  { pattern: /partnerstack\.com/i,     name: 'PartnerStack',     color: '#4CAF50', type: 'affiliate' },
  { pattern: /\.pstmrk\.it/i,          name: 'PartnerStack',     color: '#4CAF50', type: 'affiliate' },

  // ClickBank
  { pattern: /hop\.clickbank\.net/i,   name: 'ClickBank',        color: '#FFC107', type: 'affiliate' },
  { pattern: /clickbank\.net/i,        name: 'ClickBank',        color: '#FFC107', type: 'affiliate' },

  // Amazon Associates
  { pattern: /amzn\.to/i,              name: 'Amazon Associates', color: '#FF9900', type: 'affiliate' },
  { pattern: /amazon\.[a-z.]+\/.*[?&]tag=/i, name: 'Amazon Associates', color: '#FF9900', type: 'affiliate' },

  // FlexOffers
  { pattern: /flexlinkspro\.com/i,     name: 'FlexOffers',       color: '#0099CC', type: 'affiliate' },
  { pattern: /flexoffers\.com/i,       name: 'FlexOffers',       color: '#0099CC', type: 'affiliate' },

  // Skimlinks
  { pattern: /go\.skimresources\.com/i, name: 'Skimlinks',       color: '#00B7C3', type: 'affiliate' },
  { pattern: /skimlinks\.com/i,        name: 'Skimlinks',        color: '#00B7C3', type: 'affiliate' },
  { pattern: /\.redirectingat\.com/i,  name: 'Skimlinks',        color: '#00B7C3', type: 'affiliate' },

  // Avantlink
  { pattern: /avantlink\.com/i,        name: 'AvantLink',        color: '#0078D4', type: 'affiliate' },

  // Pepperjam (now Partnerize / Ascend)
  { pattern: /pepperjamnetwork\.com/i, name: 'Pepperjam',        color: '#9C27B0', type: 'affiliate' },
  { pattern: /pjtra\.com/i,            name: 'Pepperjam',        color: '#9C27B0', type: 'affiliate' },
  { pattern: /partnerize\.com/i,       name: 'Partnerize',       color: '#9C27B0', type: 'affiliate' },
  { pattern: /prf\.hn/i,               name: 'Partnerize',       color: '#9C27B0', type: 'affiliate' },

  // Refersion
  { pattern: /refersion\.com/i,        name: 'Refersion',        color: '#FF4081', type: 'affiliate' },

  // FirstPromoter
  { pattern: /firstpromoter\.com/i,    name: 'FirstPromoter',    color: '#673AB7', type: 'affiliate' },
  { pattern: /\.fpr\.[a-z]{2,4}/i,     name: 'FirstPromoter',    color: '#673AB7', type: 'affiliate' },

  // Tapfiliate
  { pattern: /tapfiliate\.com/i,       name: 'Tapfiliate',       color: '#00BCD4', type: 'affiliate' },
  { pattern: /\.tap\.gl/i,             name: 'Tapfiliate',       color: '#00BCD4', type: 'affiliate' },

  // Rewardful
  { pattern: /rewardful\.com/i,        name: 'Rewardful',        color: '#FF6F61', type: 'affiliate' },
  { pattern: /rwrd\.li/i,              name: 'Rewardful',        color: '#FF6F61', type: 'affiliate' },

  // LinkConnector
  { pattern: /linkconnector\.com/i,    name: 'LinkConnector',    color: '#3F51B5', type: 'affiliate' },

  // Webgains
  { pattern: /webgains\.com/i,         name: 'Webgains',         color: '#E040FB', type: 'affiliate' },

  // Daisycon
  { pattern: /daisycon\.io/i,          name: 'Daisycon',         color: '#FFEB3B', type: 'affiliate' },

  // TradeDoubler
  { pattern: /tradedoubler\.com/i,     name: 'TradeDoubler',     color: '#795548', type: 'affiliate' },
  { pattern: /tradedoubler\.net/i,     name: 'TradeDoubler',     color: '#795548', type: 'affiliate' },

  // Booking.com affiliate
  { pattern: /booking\.com\/.*aid=/i,  name: 'Booking.com Affiliate', color: '#003580', type: 'affiliate' },

  // ----- Generic shorteners -----
  { pattern: /^https?:\/\/(www\.)?bit\.ly\//i,    name: 'Bitly',     color: '#EE6123', type: 'shortener' },
  { pattern: /^https?:\/\/t\.co\//i,              name: 'Twitter/X', color: '#1DA1F2', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?ow\.ly\//i,     name: 'Hootsuite', color: '#143059', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?tinyurl\.com\//i, name: 'TinyURL', color: '#888888', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?goo\.gl\//i,    name: 'Google (deprecated)', color: '#4285F4', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?buff\.ly\//i,   name: 'Buffer',    color: '#168EEA', type: 'shortener' },
  { pattern: /^https?:\/\/lnkd\.in\//i,           name: 'LinkedIn',  color: '#0A66C2', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?youtu\.be\//i,  name: 'YouTube',   color: '#FF0000', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?fb\.me\//i,     name: 'Facebook',  color: '#1877F2', type: 'shortener' },
  { pattern: /^https?:\/\/(www\.)?is\.gd\//i,     name: 'is.gd',     color: '#888888', type: 'shortener' },
  { pattern: /^https?:\/\/rebrand\.ly\//i,        name: 'Rebrandly', color: '#00B14F', type: 'shortener' },
  { pattern: /^https?:\/\/short\.io\//i,          name: 'Short.io',  color: '#5B5BD6', type: 'shortener' },

  // ----- Ad / tracking -----
  { pattern: /doubleclick\.net/i,            name: 'Google Ads',     color: '#4285F4', type: 'ad' },
  { pattern: /\.googlesyndication\.com/i,    name: 'Google Ads',     color: '#4285F4', type: 'ad' },
  { pattern: /googleadservices\.com/i,       name: 'Google Ads',     color: '#4285F4', type: 'ad' },
  { pattern: /\.adsrvr\.org/i,               name: 'The Trade Desk', color: '#0099FF', type: 'ad' },
  { pattern: /taboola\.com/i,                name: 'Taboola',        color: '#1657AB', type: 'ad' },
  { pattern: /outbrain\.com/i,               name: 'Outbrain',       color: '#EE6611', type: 'ad' },

  // ----- Email / CRM trackers -----
  { pattern: /list-manage\.com/i,            name: 'Mailchimp',      color: '#FFE01B', type: 'email' },
  { pattern: /sendgrid\.net/i,               name: 'SendGrid',       color: '#1A82E2', type: 'email' },
  { pattern: /\.hsforms\.com/i,              name: 'HubSpot',        color: '#FF7A59', type: 'email' },
  { pattern: /click\.email/i,                name: 'Email Tracker',  color: '#888888', type: 'email' },
  { pattern: /links\.[a-z0-9.-]+\.com\//i,   name: 'Email Tracker',  color: '#888888', type: 'email' },

  // ----- Generic affiliate query params -----
  // Catches any URL carrying a referral/affiliate param even on unknown domains.
  // Must be listed last so named networks above take priority.
  { pattern: /[?&]ref=/i,             name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },
  { pattern: /[?&]refid=/i,           name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },
  { pattern: /[?&]referral=/i,        name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },
  { pattern: /[?&]aff_id=/i,          name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },
  { pattern: /[?&]affid=/i,           name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },
  { pattern: /[?&]partner_id=/i,      name: 'Referral',  color: '#9E9E9E', type: 'affiliate' },

  // ----- Social media tracking wrappers -----
  // These are click-tracking wrappers injected by social platforms around every
  // external link — the actual destination is encoded in a query param.
  { pattern: /^https?:\/\/l\.facebook\.com\/l\.php/i,  name: 'Facebook',  color: '#1877F2', type: 'tracking' },
  { pattern: /^https?:\/\/l\.instagram\.com\/l\.php/i, name: 'Instagram', color: '#E4405F', type: 'tracking' },
  { pattern: /^https?:\/\/l\.linkedin\.com\/l\.php/i,  name: 'LinkedIn',  color: '#0A66C2', type: 'tracking' },
  { pattern: /^https?:\/\/t\.twitter\.com\/r\//i,      name: 'Twitter/X', color: '#1DA1F2', type: 'tracking' },
  { pattern: /^https?:\/\/out\.reddit\.com\/r\//i,     name: 'Reddit',    color: '#FF4500', type: 'tracking' },
  { pattern: /^https?:\/\/click\.convertkit-mail/i,    name: 'ConvertKit',color: '#FB6970', type: 'tracking' },
];

export function detectNetwork(url) {
  if (typeof url !== 'string' || !url) return null;
  for (const network of AFFILIATE_NETWORKS) {
    if (network.pattern.test(url)) {
      return {
        name: network.name,
        color: network.color,
        type: network.type,
      };
    }
  }
  return null;
}

export function classifyChain(chain) {
  const networks = [];
  const seen = new Set();
  for (const hop of chain) {
    const net = detectNetwork(hop.url);
    if (net && !seen.has(net.name)) {
      networks.push(net);
      seen.add(net.name);
    }
  }
  return networks;
}
