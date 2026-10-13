import { createHmac, timingSafeEqual } from "node:crypto";

// Parallel signs webhooks per the Standard Webhooks spec:
//   signature = base64(HMAC-SHA256(key, `${webhook-id}.${webhook-timestamp}.${rawBody}`))
// where key = base64-decoded secret with the `whsec_` prefix removed. Older
// accounts used the whole secret string as the key, so we accept either.
const TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhook(headers: Headers, rawBody: string, secret: string): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const keys = [Buffer.from(secret.replace(/^whsec_/, ""), "base64"), Buffer.from(secret)];
  const signed = `${id}.${timestamp}.${rawBody}`;
  const provided = signatures
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter(Boolean);

  return keys.some((key) => {
    const expected = createHmac("sha256", key).update(signed).digest();
    return provided.some((sig) => {
      const got = Buffer.from(sig, "base64");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
  });
}
