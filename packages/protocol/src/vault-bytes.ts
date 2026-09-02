//
// Byte helpers shared by every vault format. A leaf — no imports — so the v1 vault, the v2
// envelope and the VEK wrapper all spell base64 and buffers one way.
//

export function subtleOrNull(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null
}

export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

// btoa/atob: global in browsers and Node ≥ 16, so no Buffer creeps into the bundle.
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('not base64')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// By COPY: `bytes.buffer` on a view would hand WebCrypto the whole backing allocation.
export function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Overwrite a secret's bytes once they have been imported; the view is useless afterwards. */
export function zero(bytes: Uint8Array): void {
  bytes.fill(0)
}
