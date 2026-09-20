// place-overrides.json（人が承認した地点・起点の表）の解釈。純粋関数のみ。
// 座標は表には書かれておらず、places[].from の QID から Wikidata の P625 を引いた結果（fetch-app-extras.mjs が保存）を使う。

/**
 * @typedef {{ from: string, fromLabel: string, path: "P625" | "P159>P625", label?: string }} OverridePlace
 * @typedef {{ qid: string, title: string, placeKind: "point" | "origin" | "none", places?: OverridePlace[],
 *   kind?: "instant" | "period", start?: number, end?: number, note?: string }} PlaceOverride
 * @typedef {{ overrides: PlaceOverride[], exclude: { qid: string, title: string, reason: string }[] }} PlaceOverrides
 */

/**
 * 取得した座標の行。hq は P159>P625 のときの本部所在地の項目、from / to はその P159 の修飾子（始点・終点の年。無ければ null）。
 * @typedef {{ lat: number, lon: number, precision: number | null, hq?: string, from: number | null, to: number | null,
 *   labelJa?: string, labelEn?: string }} ResolvedRow
 */

/** 取得結果のキャッシュのキー。 @param {OverridePlace} place */
export const placeKey = (place) => `${place.from}|${place.path}`;

/**
 * その年に該当する座標を1つ選ぶ。
 * - P159 に始点・終点の修飾子があれば、year を含むものだけを残す。修飾子つきで該当するものがあれば、修飾子なしより優先する
 * - 座標が複数あれば、精度（wikibase:geoPrecision。度の単位で、小さいほど細かい）の高いものを選ぶ。同じなら緯度・経度の順で決める。
 *   精度が負の値で入っている項目があるので（フィラデルフィア造幣局の -1e-7）、絶対値で比べる
 * 該当するものが無ければ null（呼び出し側でエラーにする。推測で埋めない）。
 * @param {readonly ResolvedRow[]} rows @param {number} year
 * @returns {ResolvedRow | null}
 */
export const pickResolved = (rows, year) => {
  const valid = rows.filter((r) => (r.from === null || r.from <= year) && (r.to === null || r.to >= year));
  const qualified = valid.filter((r) => r.from !== null || r.to !== null);
  const pool = qualified.length > 0 ? qualified : valid;
  return (
    [...pool].sort(
      (a, b) => Math.abs(a.precision ?? Infinity) - Math.abs(b.precision ?? Infinity) || a.lat - b.lat || a.lon - b.lon,
    )[0] ?? null
  );
};
