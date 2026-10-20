import { Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { seededRandom } from "./helpers.mjs";

/**
 * Smooth noise from -1 to 1 over the plane, repeating every 256 units:
 * random values at whole-number points, blended smoothly between them.
 * @param {number} seed
 * @returns {(x: number, z: number) => number}
 */
export function valueNoise(seed) {

    const random = seededRandom(seed);
    const values = Float64Array.from({ length: 256 * 256 }, () => random() * 2.0 - 1.0);
    const at = (/** @type {number} */ i, /** @type {number} */ j) => values[(i & 255) * 256 + (j & 255)];
    const smooth = (/** @type {number} */ t) => t * t * t * (t * (t * 6.0 - 15.0) + 10.0);

    return (x, z) => {
        const i = Math.floor(x), j = Math.floor(z);
        const u = smooth(x - i), v = smooth(z - j);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
        return a + (b - a) * v;
    };
}

/**
 * The height of the island at (x, z): layers of noise, each finer and
 * fainter than the last, on a dome that sinks below the sea at the edges.
 * @param {(x: number, z: number) => number} noise
 * @param {number} x
 * @param {number} z
 */
export function islandHeight(noise, x, z) {

    let height = 0.0;
    let amplitude = 1.0;
    let frequency = 0.25;

    for (let octave = 0; octave < 6; ++octave) {
        height += amplitude * noise(x * frequency + octave * 17.0, z * frequency - octave * 31.0);
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    const r = Math.hypot(x, z) / 8.0;
    return 2.6 * (1.0 - r * r) + 1.4 * height - 0.6;
}

/**
 * An island at sunset: noise terrain coloured by height and steepness, in
 * a glassy sea.
 */
export function island() {

    const SIZE = 20.0;
    const SEGMENTS = 180;
    const noise = valueNoise(7);

    /** @type {Vec3[]} */
    const positions = [];
    for (let i = 0; i <= SEGMENTS; ++i) {
        for (let j = 0; j <= SEGMENTS; ++j) {
            const x = (i / SEGMENTS - 0.5) * SIZE;
            const z = (0.5 - j / SEGMENTS) * SIZE;
            positions.push(new Vec3(x, islandHeight(noise, x, z), z));
        }
    }

    /** @type {number[]} */
    const all = [];
    const row = SEGMENTS + 1;
    for (let i = 0; i < SEGMENTS; ++i) {
        for (let j = 0; j < SEGMENTS; ++j) {
            const a = i * row + j, b = (i + 1) * row + j, c = (i + 1) * row + j + 1, d = i * row + j + 1;
            all.push(a, b, c, a, c, d);
        }
    }

    // Smooth normals over the whole terrain, so the bands below share them
    // where they meet.
    const normals = new Mesh(positions, all, Material.diffuse(new Vec3())).normals ?? [];

    const bands = {
        sand: { material: Material.diffuse(hexColor("#d8c69a")), indices: /** @type {number[]} */ ([]) },
        grass: { material: Material.diffuse(hexColor("#4f7a32")), indices: /** @type {number[]} */ ([]) },
        rock: { material: Material.plastic(hexColor("#8a7f72"), 0.6), indices: /** @type {number[]} */ ([]) },
        snow: { material: Material.diffuse(hexColor("#f4f6fa")), indices: /** @type {number[]} */ ([]) },
    };

    for (let t = 0; t < all.length; t += 3) {

        const [a, b, c] = [all[t], all[t + 1], all[t + 2]];
        const height = (positions[a].y + positions[b].y + positions[c].y) / 3.0;
        if (height < -1.0)
            continue; // Deep under the sea, out of sight.

        const steep = (normals[a].y + normals[b].y + normals[c].y) / 3.0 < 0.6;
        const band =
            height < 0.25 ? bands.sand :
            height > 2.3 ? (steep ? bands.rock : bands.snow) :
            steep ? bands.rock : bands.grass;

        band.indices.push(a, b, c);
    }

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.12, 0.2, 0.5),
            horizon: new Vec3(1.0, 0.55, 0.3),
            ground: new Vec3(0.15, 0.12, 0.1),
            sunStrength: 3.5,
            sunDirection: new Vec3(0.9, 0.22, 0.25),
            sunColor: new Vec3(1.0, 0.7, 0.45),
            sunSize: 0.05,
        }),
    });

    for (const band of Object.values(bands)) {
        if (band.indices.length > 0)
            scene.add(new Mesh(positions, band.indices, band.material, { normals }));
    }

    // The sea: a sheet of water at height 0 over a dark sea bed.
    scene.add(
        new Quad(new Vec3(-60, 0, 60), new Vec3(120, 0, 0), new Vec3(0, 0, -120), Material.glass(1.33, hexColor("#9ad4d6"))),
        new Quad(new Vec3(-60, -1.5, 60), new Vec3(120, 0, 0), new Vec3(0, 0, -120), Material.diffuse(hexColor("#1d3b40"))));

    return {
        scene,
        camera: {
            position: new Vec3(9.0, 4.5, 11.0),
            target: new Vec3(0.0, 0.8, 0.0),
            fov: 42.0 * Math.PI / 180.0,
        },
        bounces: 10,
    };
}
