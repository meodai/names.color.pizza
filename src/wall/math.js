// small numbers for the wall: easing, and three-vectors as plain arrays
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const ease = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// an angle into -π…π
export const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => scale(a, 1 / Math.hypot(...a));
export const lerp3 = (a, b, k) => add(a, scale(sub(b, a), k));
