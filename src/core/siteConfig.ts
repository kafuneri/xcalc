export interface TopLinkItem {
  label: string;
  url: string;
}

export interface SiteConfig {
  topLinks: TopLinkItem[];
  vercountEnabled: boolean;
  mpsBeianText: string;
  mpsBeianUrl: string;
  icpBeianText: string;
  icpBeianUrl: string;
  hasFooter: boolean;
}

/**
 * Parse "Label|https://url,Label2|https://url2" into structured link items.
 */
export function parseTopLinks(raw: string | undefined): TopLinkItem[] {
  if (!raw || !raw.trim()) return [];
  const items: TopLinkItem[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sepIdx = trimmed.indexOf('|');
    if (sepIdx <= 0) continue;
    const label = trimmed.slice(0, sepIdx).trim();
    const url = trimmed.slice(sepIdx + 1).trim();
    if (label && url && /^https?:\/\//i.test(url)) {
      items.push({ label, url });
    }
  }
  return items;
}

export function getSiteConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env
): SiteConfig {
  const topLinks = parseTopLinks(
    typeof env.VITE_TOP_LINKS === 'string' ? env.VITE_TOP_LINKS : ''
  );
  const vercountEnabled = Boolean(
    typeof env.VITE_VERCOUNT_SRC === 'string' && env.VITE_VERCOUNT_SRC.trim()
  );
  const mpsBeianText =
    typeof env.VITE_MPS_BEIAN_TEXT === 'string'
      ? env.VITE_MPS_BEIAN_TEXT.trim()
      : '';
  const mpsBeianCode =
    typeof env.VITE_MPS_BEIAN_CODE === 'string'
      ? env.VITE_MPS_BEIAN_CODE.trim()
      : '';
  const icpBeianText =
    typeof env.VITE_ICP_BEIAN_TEXT === 'string'
      ? env.VITE_ICP_BEIAN_TEXT.trim()
      : '';

  const mpsBeianUrl = mpsBeianCode
    ? `https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(mpsBeianCode)}`
    : 'https://beian.mps.gov.cn/';

  return {
    topLinks,
    vercountEnabled,
    mpsBeianText,
    mpsBeianUrl,
    icpBeianText,
    icpBeianUrl: 'https://beian.miit.gov.cn',
    hasFooter: Boolean(mpsBeianText || icpBeianText || vercountEnabled),
  };
}
