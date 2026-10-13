// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We require the same
// header for manual runs.
export function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
