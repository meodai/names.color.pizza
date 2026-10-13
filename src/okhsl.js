// Björn Ottosson's OkHSL (https://bottosson.github.io/posts/colorpicker/), ported to JS.
export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const K1 = 0.206,
  K2 = 0.03,
  K3 = (1 + K1) / (1 + K2);
export const toe = (x) => 0.5 * (K3 * x - K1 + Math.sqrt((K3 * x - K1) ** 2 + 4 * K2 * K3 * x));
export const toeInv = (x) => (x * x + K1 * x) / (K3 * (x + K2));

function maxSaturation(a, b) {
  let k0, k1, k2, k3, k4, wl, wm, ws;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    [k0, k1, k2, k3, k4] = [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245];
    [wl, wm, ws] = [4.0767416621, -3.3077115913, 0.2309699292];
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    [k0, k1, k2, k3, k4] = [0.73956515, -0.45954404, 0.08285427, 0.1254107, 0.14503204];
    [wl, wm, ws] = [-1.2684380046, 2.6097574011, -0.3413193965];
  } else {
    [k0, k1, k2, k3, k4] = [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167];
    [wl, wm, ws] = [-0.0041960863, -0.7034186147, 1.707614701];
  }
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const l_ = 1 + S * kl,
    m_ = 1 + S * km,
    s_ = 1 + S * ks;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const ldS = 3 * kl * l_ * l_,
    mdS = 3 * km * m_ * m_,
    sdS = 3 * ks * s_ * s_;
  const ldS2 = 6 * kl * kl * l_,
    mdS2 = 6 * km * km * m_,
    sdS2 = 6 * ks * ks * s_;
  const f = wl * l + wm * m + ws * s;
  const f1 = wl * ldS + wm * mdS + ws * sdS;
  const f2 = wl * ldS2 + wm * mdS2 + ws * sdS2;
  return S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
}

export function findCusp(a, b) {
  const S = maxSaturation(a, b);
  const rgb = oklabToLinear(1, S * a, S * b);
  const L = Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2]));
  return [L, L * S];
}

// Where the line from (L0, 0) towards (L1, C1) leaves the sRGB gamut.
function gamutIntersection(a, b, L1, C1, L0, cusp) {
  if ((L1 - L0) * cusp[1] - (cusp[0] - L0) * C1 <= 0) {
    return (cusp[1] * L0) / (C1 * cusp[0] + cusp[1] * (L0 - L1));
  }
  let t = (cusp[1] * (L0 - 1)) / (C1 * (cusp[0] - 1) + cusp[1] * (L0 - L1));
  const dL = L1 - L0,
    dC = C1;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const ldt = dL + dC * kl,
    mdt = dL + dC * km,
    sdt = dL + dC * ks;
  const L = L0 * (1 - t) + t * L1,
    C = t * C1;
  const l_ = L + C * kl,
    m_ = L + C * km,
    s_ = L + C * ks;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const l1 = 3 * ldt * l_ * l_,
    m1 = 3 * mdt * m_ * m_,
    s1 = 3 * sdt * s_ * s_;
  const l2 = 6 * ldt * ldt * l_,
    m2 = 6 * mdt * mdt * m_,
    s2 = 6 * sdt * sdt * s_;
  const step = (w0, w1, w2) => {
    const f = w0 * l + w1 * m + w2 * s - 1;
    const f1 = w0 * l1 + w1 * m1 + w2 * s1;
    const f2 = w0 * l2 + w1 * m2 + w2 * s2;
    const u = f1 / (f1 * f1 - 0.5 * f * f2);
    return u >= 0 ? -f * u : Infinity;
  };
  t += Math.min(
    step(4.0767416621, -3.3077115913, 0.2309699292),
    step(-1.2684380046, 2.6097574011, -0.3413193965),
    step(-0.0041960863, -0.7034186147, 1.707614701),
  );
  return t;
}

// The three reference chromas OkHSL interpolates between at (L, hue).
export function chromaStops(L, a, b, cusp = findCusp(a, b)) {
  const Cmax = gamutIntersection(a, b, L, 1, L, cusp);
  const Smax = cusp[1] / cusp[0];
  const Tmax = cusp[1] / (1 - cusp[0]);
  const Smid =
    0.11516993 +
    1 /
      (7.4477897 +
        4.1590124 * b +
        a *
          (-2.19557347 +
            1.75198401 * b +
            a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
  const Tmid =
    0.11239642 +
    1 /
      (1.6132032 -
        0.68124379 * b +
        a *
          (0.40370612 +
            0.90148123 * b +
            a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
  const k = Cmax / Math.min(L * Smax, (1 - L) * Tmax);
  const Ca = L * Smid,
    Cb = (1 - L) * Tmid;
  const Cmid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / Ca ** 4 + 1 / Cb ** 4)));
  const C0a = L * 0.4,
    C0b = (1 - L) * 0.8;
  const C0 = Math.sqrt(1 / (1 / (C0a * C0a) + 1 / (C0b * C0b)));
  return [C0, Cmid, Cmax];
}

// OkHSL saturation (0..1) -> OKLab chroma, given the stops above.
export function chromaFor(s, C0, Cmid, Cmax) {
  if (s < 0.8) {
    const t = 1.25 * s,
      k1 = 0.8 * C0,
      k2 = 1 - k1 / Cmid;
    return (t * k1) / (1 - k2 * t);
  }
  const t = 5 * (s - 0.8),
    k1 = (0.2 * Cmid * Cmid * 1.5625) / C0,
    k2 = 1 - k1 / (Cmax - Cmid);
  return Cmid + (t * k1) / (1 - k2 * t);
}

// h, s, l in 0..1 -> OKLab
export function okhslToOklab(h, s, l) {
  if (l >= 1) return [1, 0, 0];
  if (l <= 0) return [0, 0, 0];
  const a = Math.cos(2 * Math.PI * h),
    b = Math.sin(2 * Math.PI * h);
  const L = toeInv(l);
  const C = chromaFor(s, ...chromaStops(L, a, b));
  return [L, C * a, C * b];
}

// OKLab -> h, s, l in 0..1
export function oklabToOkhsl(L, A, B) {
  const C = Math.hypot(A, B);
  const l = toe(L);
  if (C < 1e-6 || L <= 0 || L >= 1) return [0, 0, clamp01(l)];
  const a = A / C,
    b = B / C;
  const h = 0.5 + (0.5 * Math.atan2(-B, -A)) / Math.PI;
  const [C0, Cmid, Cmax] = chromaStops(L, a, b);
  let s;
  if (C < Cmid) {
    const k1 = 0.8 * C0,
      k2 = 1 - k1 / Cmid;
    s = (C / (k1 + k2 * C)) * 0.8;
  } else {
    const k1 = (0.2 * Cmid * Cmid * 1.5625) / C0,
      k2 = 1 - k1 / (Cmax - Cmid);
    const t = (C - Cmid) / (k1 + k2 * (C - Cmid));
    s = 0.8 + 0.2 * t;
  }
  return [h, clamp01(s), clamp01(l)];
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
