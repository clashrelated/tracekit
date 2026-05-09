export const TRACKING_PARAMS = new Set([
  // UTM
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',

  // Click IDs
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'ttclid', 'twclid',
  'yclid', 'igshid', 'mc_cid', 'mc_eid', 'wickedid', 'epik', 'rdt_cid',
  '_hsenc', '_hsmi', 'hsa_acc', 'hsa_cam', 'hsa_grp', 'hsa_ad',

  // Affiliate
  'ref', 'referrer', 'referer', 'affiliate', 'aff', 'aff_id', 'affid',
  'subid', 'sub_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5',
  'clickid', 'click_id', 'cid', 'offerid', 'offer_id', 'source',
  'partner', 'partner_id', 'tag', 'irclickid', 'irgwc', 'sharedid',
  'pscd', 'siteid', 'linkid', 'campaign', 'promo', 'promo_id',

  // Misc trackers
  's_kwcid', 'ef_id', 'matchtype', 'network', 'device', 'placement',
  'creative', 'keyword', 'adgroupid', 'campaignid', 'targetid',
  'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium',
  'mkt_tok', 'trk', 'trkCampaign', '_branch_match_id',

  // Generic tracking IDs (used by ThriveCart, e-clients, and similar platforms)
  'trackid', 'track_id', 'tracking_id', 'tid', 'transaction_id',
]);

export function parseParams(url) {
  if (typeof url !== 'string' || !url) {
    return { tracking: {}, kept: {}, cleanUrl: url ?? '', count: 0 };
  }

  try {
    const u = new URL(url);
    const tracking = {};
    const kept = {};
    const clean = new URL(url);

    const keys = [];
    for (const key of u.searchParams.keys()) keys.push(key);

    for (const key of keys) {
      const lower = key.toLowerCase();
      const values = u.searchParams.getAll(key);
      if (TRACKING_PARAMS.has(lower)) {
        tracking[key] = values.length === 1 ? values[0] : values;
        clean.searchParams.delete(key);
      } else {
        kept[key] = values.length === 1 ? values[0] : values;
      }
    }

    return {
      tracking,
      kept,
      cleanUrl: clean.href,
      count: Object.keys(tracking).length,
    };
  } catch {
    return { tracking: {}, kept: {}, cleanUrl: url, count: 0 };
  }
}

export function summarizeChainParams(chain) {
  const all = {};
  for (const hop of chain) {
    if (!hop.url) continue;
    const { tracking } = parseParams(hop.url);
    for (const [k, v] of Object.entries(tracking)) {
      if (!all[k]) all[k] = v;
    }
  }
  return all;
}

export function getCleanFinalUrl(chain) {
  const last = [...chain].reverse().find((h) => h.url);
  if (!last) return '';
  return parseParams(last.url).cleanUrl;
}
