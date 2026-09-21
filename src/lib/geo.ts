/*
 * 球面上の幾何（純粋関数）。diffusion の経路を大圏の線で描くのに使う。ライブラリは足さない。
 */

/** [経度, 緯度]（度） */
export type LonLat = readonly [number, number];

type Vec3 = readonly [number, number, number];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

const toVec3 = ([lon, lat]: LonLat): Vec3 => {
  const phi = toRadians(lat);
  const lambda = toRadians(lon);
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
};

const toLonLat = ([x, y, z]: Vec3): LonLat => [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))];

/** 2 点のなす角（ラジアン）。内積の誤差で acos の定義域を出ないように丸める。 */
const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/**
 * 2 点を結ぶ大圏の線を、segments 等分した点列（両端を含む segments + 1 点）。球面線形補間（slerp）。
 * - 2 点が同じ（または角度がごく小さい）ときは、両端だけを返す
 * - 対蹠点どうし（大圏が一意に決まらない）は想定しない
 * - 経度は −180〜180 に正規化される。180 度の経線をまたぐ線は、そのまま描くと地図を横切るので、splitAtAntimeridian で分ける
 */
export const greatCircle = (from: LonLat, to: LonLat, segments: number = 20): readonly LonLat[] => {
  const a = toVec3(from);
  const b = toVec3(to);
  const omega = angleBetween(a, b);
  if (omega < 1e-9 || segments < 1) return [from, to];
  const sinOmega = Math.sin(omega);
  return Array.from({ length: segments + 1 }, (_, i) => {
    // 両端は入力の値をそのまま使う（三角関数の往復で座標が微妙にずれて、マーカーの中心から線が外れないように）
    if (i === 0) return from;
    if (i === segments) return to;
    const t = i / segments;
    const wa = Math.sin((1 - t) * omega) / sinOmega;
    const wb = Math.sin(t * omega) / sinOmega;
    return toLonLat([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]]);
  });
};

/**
 * 点列を、180 度の経線をまたぐ所で分ける（隣り合う点の経度の差が 180 度を超えたら、またいだとみなす）。
 * またぐ所には、経線上の点（緯度は線形補間）を両側に足す。地図は世界を 1 枚だけ描く（renderWorldCopies: false）ので、
 * 分けた線は左右の端でそれぞれ切れる。またがない点列は、そのまま 1 本で返る。
 * スペインかぜの下書きで、ボストン → オークランド → アピアが太平洋をまたいだ（2026-09-21）。
 */
export const splitAtAntimeridian = (points: readonly LonLat[]): readonly (readonly LonLat[])[] =>
  points.reduce<readonly (readonly LonLat[])[]>((lines, point) => {
    const current = lines[lines.length - 1] ?? [];
    const previous = current[current.length - 1];
    if (previous === undefined || Math.abs(point[0] - previous[0]) <= 180) return [...lines.slice(0, -1), [...current, point]];
    // previous の側の端（±180）と、point の側の端（∓180）。経度を連続にして（point を previous の側に寄せて）緯度を補間する
    const edge = previous[0] > 0 ? 180 : -180;
    const unwrapped = point[0] + (previous[0] > 0 ? 360 : -360);
    const t = (edge - previous[0]) / (unwrapped - previous[0]);
    const lat = previous[1] + t * (point[1] - previous[1]);
    return [...lines.slice(0, -1), [...current, [edge, lat]], [[-edge, lat], point]];
  }, []);
