/**
 * One place that turns an unknown thrown value into text fit for a human.
 *
 * The API client throws `Error` instances carrying the server's message, but a
 * failed `fetch`, a JSON parse error or a `TypeError` from a missing DOM API
 * can also land in a `catch`. Rendering `String(error)` would leak
 * "TypeError: Failed to fetch" into the UI, so anything that is not an `Error`
 * with a message falls back to a caller-supplied sentence.
 */
export function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}
