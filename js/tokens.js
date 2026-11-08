// Токены доступа. Ключ к правам — сама ссылка: tree.html#t=<токен>.
// Ссылки родни и просмотра выводятся из ссылки создателя, поэтому создатель всегда может их показать,
// а база хранит только хэши.

const b64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function derive(owner, role) {
  return b64url(await sha256(`${owner}:${role}`)).slice(0, 22);
}

export async function hashToken(token) {
  return [...await sha256(token)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function baseUrl() {
  return new URL('.', location.href).href;
}

export function treeLink(token, base = baseUrl()) {
  return `${base}tree.html#t=${token}`;
}

export function readTokenFromHash(hash) {
  const m = /(?:^#|&)t=([^&]*)/.exec(hash || '');
  if (!m) return null;
  try {
    const t = decodeURIComponent(m[1]).trim();
    return t || null;
  } catch {
    return null;   // испорченная ссылка — покажем «Древо не найдено», а не пустой экран
  }
}
