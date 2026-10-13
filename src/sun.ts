/** Sunrise/sunset from the standard sunrise equation (accurate to a few minutes). */
const RAD = Math.PI / 180;
const J2000 = 2451545;

const toJulian = (ms: number) => ms / 86_400_000 + 2440587.5;
const fromJulian = (j: number) => (j - 2440587.5) * 86_400_000;

export function sunTimes(ms: number, lat: number, lon: number): { sunrise: number; sunset: number } | null {
  const lw = -lon;
  const n = Math.round(toJulian(ms) - J2000 - 0.0009 - lw / 360);
  const jStar = J2000 + 0.0009 + lw / 360 + n;
  const m = (357.5291 + 0.98560028 * (jStar - J2000)) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDecl) / (Math.cos(lat * RAD) * cosDecl);
  if (cosH < -1 || cosH > 1) return null;
  const h = Math.acos(cosH) / RAD / 360;
  return { sunrise: fromJulian(transit - h), sunset: fromJulian(transit + h) };
}

export const BOSTON = { lat: 42.3601, lon: -71.0589 };

export function isDark(now: number, lat = BOSTON.lat, lon = BOSTON.lon): boolean {
  const t = sunTimes(now, lat, lon);
  if (!t) return false;
  return now < t.sunrise || now >= t.sunset;
}
