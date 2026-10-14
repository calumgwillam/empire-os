import { encodeRawStoreValue } from "./server-import-preparation";

export async function exceptionalRecoveryFingerprint(domain: string, value: string): Promise<string> {
  const header = new TextEncoder().encode(`${domain}\u0000`);
  const rawBytes = encodeRawStoreValue(value);
  if (rawBytes === null) throw new Error("UTF-16 source encoding unexpectedly returned null.");
  const length = new Uint8Array(8);
  let remaining = value.length;
  for (let index = length.length - 1; index >= 0; index -= 1) {
    length[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  const content = new Uint8Array(header.length + length.length + rawBytes.length);
  content.set(header);
  content.set(length, header.length);
  content.set(rawBytes, header.length + length.length);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(content).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
