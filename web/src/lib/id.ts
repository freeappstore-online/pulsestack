/**
 * Random id. `crypto.randomUUID` only exists in secure contexts, and the dev
 * server is also opened over plain http on the LAN (http://192.168.x.x), so
 * fall back to getRandomValues there.
 */
export function newId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
