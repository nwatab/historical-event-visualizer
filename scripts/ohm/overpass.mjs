// OpenHistoricalMap の Overpass API への問い合わせ。直列で、間隔を空け、429 / 5xx は Retry-After に従って再試行する。
import { CLIENT_TIMEOUT_MS, OVERPASS_ENDPOINT, PAUSE_BETWEEN_QUERIES_MS, RETRY_DELAYS_MS, USER_AGENT } from "./config.mjs";

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After（秒、または HTTP の日付）→ 待つミリ秒。読めなければ null。 @param {string | null} header @param {number} now */
export const retryAfterMs = (header, now) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
};

/**
 * @param {string} query Overpass QL
 * @param {readonly number[]} [delays]
 * @returns {Promise<any>} JSON の応答
 */
export const runOverpass = async (query, delays = RETRY_DELAYS_MS) => {
  await sleep(PAUSE_BETWEEN_QUERIES_MS);
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  }).catch((error) => ({ ok: false, status: 0, headers: new Headers(), error }));
  if (res.ok) {
    const body = await /** @type {Response} */ (res).json().catch(() => null);
    // Overpass は、時間切れやメモリ不足でも 200 を返し、remark に理由を書くことがある
    if (body && !body.remark) return body;
    if (delays.length === 0) throw new Error(`Overpass: ${body?.remark ?? "JSON を読めない"}`);
    console.warn(`  Overpass: ${body?.remark ?? "JSON を読めない"} — ${delays[0] / 1000}s 待って再試行`);
  } else {
    if (delays.length === 0) throw new Error(`Overpass: HTTP ${res.status}`);
    console.warn(`  Overpass: HTTP ${res.status || "接続できない"} — 再試行`);
  }
  const wait = ("headers" in res ? retryAfterMs(res.headers.get("retry-after"), Date.now()) : null) ?? delays[0];
  await sleep(wait);
  return runOverpass(query, delays.slice(1));
};
