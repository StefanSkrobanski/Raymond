// Shared helpers for the demo scenes.

import { Quad, Vec3 } from "../src/index.mjs";
/** @import { Material } from "../src/index.mjs" */

/**
 * A repeatable pseudo-random sequence (mulberry32), so a scene looks the
 * same every time it's built.
 * @param {number} seed
 * @returns {() => number} returns numbers from 0 up to 1
 */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A square floor at height y, centred on the origin, facing up.
 * @param {number} size the length of each side
 * @param {Material} material
 * @param {number} [y]
 */
export function floor(size, material, y = 0.0) {
    return new Quad(
        new Vec3(-size / 2.0, y, size / 2.0),
        new Vec3(size, 0.0, 0.0),
        new Vec3(0.0, 0.0, -size),
        material);
}

/**
 * A colour from hue (0 to 1 round the colour wheel), saturation and value,
 * as linear RGB.
 * @param {number} h
 * @param {number} s
 * @param {number} v
 */
export function hsv(h, s, v) {
    const f = (/** @type {number} */ n) => {
        const k = (n + h * 6.0) % 6.0;
        return v - v * s * Math.max(0.0, Math.min(k, 4.0 - k, 1.0));
    };
    // The formula gives sRGB; square it for a close-enough linear value.
    return new Vec3(f(5) ** 2.2, f(3) ** 2.2, f(1) ** 2.2);
}
