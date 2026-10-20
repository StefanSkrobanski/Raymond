// Shared helpers for the demo scenes.

import { Mat4, Material, Mesh, Quad, Vec2, Vec3 } from "../src/index.mjs";

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

/**
 * A lathe profile from [radius, height] pairs.
 * @param {number[][]} points
 */
export function profile(points) {
    return points.map(([r, y]) => new Vec2(r, y));
}

/**
 * A solid cylinder standing on the origin, with sharp edges: each rim's
 * point is repeated, so the sides and the caps don't share normals.
 * @param {number} radius
 * @param {number} height
 * @param {Material} material
 * @param {number} [segments]
 */
export function cylinder(radius, height, material, segments = 48) {
    return Mesh.lathe(profile([[0, 0], [radius, 0], [radius, 0], [radius, height], [radius, height], [0, height]]),
        material, { segments });
}

/**
 * A mesh moved to (x, y, z), and optionally scaled.
 * @param {Mesh} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} [scale]
 */
export function placed(mesh, x, y, z, scale = 1.0) {
    return mesh.transformed(Mat4.translate(x, y, z).multiplyMat4(Mat4.scale(scale, scale, scale)));
}

/**
 * Stars: tiny glowing icospheres scattered on a far sphere. They're meshes
 * rather than spheres on purpose, so the renderer doesn't sample them as
 * lights, which would starve the lights that matter of samples.
 * @param {number} count
 * @param {number} distance
 * @param {number} seed
 * @param {{ above?: boolean }} [options] above: only above the horizon
 */
export function stars(count, distance, seed, { above = false } = {}) {
    const random = seededRandom(seed);
    const glow = Material.light(new Vec3(1, 0.95, 0.9), 12.0);
    const star = Mesh.icosphere(glow, 0, { shading: "flat" });
    const meshes = [];
    for (let i = 0; i < count; ++i) {
        const z = above ? random() * 0.9 + 0.05 : random() * 2 - 1;
        const a = random() * 2 * Math.PI;
        const r = Math.sqrt(1 - z * z);
        const size = distance * (0.002 + 0.003 * random());
        meshes.push(placed(star, r * Math.cos(a) * distance, z * distance, r * Math.sin(a) * distance, size));
    }
    return meshes;
}
