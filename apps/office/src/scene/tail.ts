const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SCREEN_MAX_BYTES = 8192;

export function appendCapped(current: string, extra: string, maxBytes = SCREEN_MAX_BYTES): string {
  if (extra.length === 0) {
    return current;
  }
  const combined = current + extra;
  const bytes = encoder.encode(combined);
  if (bytes.byteLength <= maxBytes) {
    return combined;
  }
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return decoder.decode(bytes.subarray(start));
}
