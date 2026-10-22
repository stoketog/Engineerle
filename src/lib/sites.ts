/** Where the two games live. Set NEXT_PUBLIC_OBSCURA_URL at build time to point at Obscura's own domain. */
export const OBSCURA_URL = (process.env.NEXT_PUBLIC_OBSCURA_URL || 'https://obscuradaily.com').replace(/\/+$/, '');
