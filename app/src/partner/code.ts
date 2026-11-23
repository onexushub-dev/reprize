/** A partner code: 3 to 20 characters, A-Z and 0-9, stored uppercase. The same string is the link slug and the typed code. */
const MIN = 3;
const MAX = 20;

/** Uppercase, accents folded, everything but A-Z and 0-9 dropped; null when the result is not 3 to 20 characters. */
export function normalizeCode(raw: string): string | null {
  const code = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return code.length >= MIN && code.length <= MAX ? code : null;
}

// A link anywhere in a pasted text, with or without the scheme; the host must start the word, so lookalike hosts do not match.
const LINK_PATTERNS = [
  /(?:^|[\s(<"'])(?:https?:\/\/)?(?:www\.)?reprizeapp\.com\/p\/([^/?#\s,;)>"']+)/i,
  /(?:^|[\s(<"'])reprize:\/\/p\/([^/?#\s,;)>"']+)/i,
];

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The code in a partner link (`https://reprizeapp.com/p/CODE`, `reprizeapp.com/p/CODE` or `reprize://p/CODE`), alone or inside a text; null otherwise. */
export function codeFromUrl(url: string): string | null {
  const text = url.trim();
  for (const pattern of LINK_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return normalizeCode(decode(match[1]));
  }
  return null;
}

/** The code in a Play install referrer (`partner=CODE&utm_source=...`, possibly percent-encoded); null when there is none. */
export function codeFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  for (const pair of decode(referrer).split('&')) {
    const [key, value] = pair.split('=');
    if (key === 'partner' && value) return normalizeCode(decode(value));
  }
  return null;
}

/** The Apple custom code of a partner: its own code in the annual offer, and the code plus MENSAL in the monthly one. */
export function appleOfferCode(code: string, plan: 'annual' | 'monthly'): string {
  return plan === 'monthly' ? `${code}MENSAL` : code;
}
