export type PasswordExposureStatus = "safe" | "exposed" | "unavailable";

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function passwordExposureStatus(password: string): Promise<PasswordExposureStatus> {
  if (!globalThis.crypto?.subtle) return "unavailable";

  const digest = hex(await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)));
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);

  try {
    // Pwned Passwords receives only a five-character hash prefix. The password
    // and its complete hash never leave this browser; response padding reduces
    // what an observer could infer from the encrypted response size.
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return "unavailable";
    const matches = (await response.text()).split(/\r?\n/);
    return matches.some((line) => {
      const [candidate, count] = line.split(":", 2);
      return candidate === suffix && Number(count) > 0;
    }) ? "exposed" : "safe";
  } catch {
    return "unavailable";
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
