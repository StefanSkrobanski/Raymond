// HDR environments for the demo scenes, drawn in code as panoramas of
// light: a photographer's studio, an alpine day and a sunset. Each is made
// the first time it's asked for and kept.

import { EnvironmentMap, Vec3 } from "../src/index.mjs";
import { fractalNoise } from "./textures.mjs";

/** @type {Map<string, EnvironmentMap>} */
const made = new Map();

/**
 * @param {string} name
 * @param {() => EnvironmentMap} make
 */
function once(name, make) {
    let env = made.get(name);
    if (!env) {
        env = make();
        made.set(name, env);
    }
    return env;
}

/** @type {(edge0: number, edge1: number, x: number) => number} */
const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
};

/**
 * A rectangular softbox: how much of direction d falls in a panel facing
 * the origin from direction centre, width wide and height high (in radians
 * either way), with softened edges.
 * @param {Vec3} d
 * @param {Vec3} centre unit length
 * @param {number} width
 * @param {number} height
 */
function softbox(d, centre, width, height) {
    if (d.dot(centre) <= 0)
        return 0;
    const right = new Vec3(0, 1, 0).cross(centre).normalized();
    const up = centre.cross(right);
    const along = Math.atan2(d.dot(right), d.dot(centre));
    const across = Math.atan2(d.dot(up), d.dot(centre));
    return smoothstep(width / 2, width / 2 - 0.03, Math.abs(along)) * smoothstep(height / 2, height / 2 - 0.03, Math.abs(across));
}

/**
 * A photographer's studio: a dark grey room with a big key softbox high on
 * the left, a long strip on the right, and a rim light behind, for chrome
 * and glass to reflect.
 */
export function studio() {
    return once("studio", () => {
        const key = new Vec3(-0.6, 0.55, 0.6).normalized();
        const strip = new Vec3(0.85, 0.2, 0.2).normalized();
        const rim = new Vec3(0.1, 0.5, -0.86).normalized();
        return EnvironmentMap.procedural(1024, 512, (d) => {
            const wall = 0.025 + 0.02 * Math.max(d.y, 0);
            const floor = d.y < 0 ? 0.012 : wall;
            const light = 14 * softbox(d, key, 0.9, 0.7) + 9 * softbox(d, strip, 0.25, 1.1) + 6 * softbox(d, rim, 0.6, 0.2);
            return new Vec3(floor + light, floor + light * 0.98, floor + light * 0.95);
        });
    });
}

/**
 * The height of the mountains on the horizon, as an elevation in radians,
 * at azimuth u (0 to 1 round).
 * @param {(u: number, v: number) => number} ridge
 * @param {number} u
 */
function mountains(ridge, u) {
    const broad = Math.max(ridge(u, 0.3) + 0.5, 0);
    return 0.02 + 0.2 * broad * broad + 0.03 * Math.abs(ridge(u * 6, 0.7));
}

/** The direction of the alpine day's sun. */
export const ALPINE_SUN = new Vec3(0.55, 0.55, -0.62).normalized();

/**
 * An alpine day: deep blue overhead, paler to the horizon, a bright sun,
 * scattered cumulus, and snowy mountains all round above a green valley.
 */
export function alpine() {
    return once("alpine", () => {
        const ridge = fractalNoise(91, 6, 4);
        const clouds = fractalNoise(92, 8, 5);
        const snow = fractalNoise(93, 32, 3);
        const zenith = new Vec3(0.12, 0.28, 0.75), horizon = new Vec3(0.7, 0.82, 0.95);
        return EnvironmentMap.procedural(1024, 512, (d) => {
            const [u, v] = EnvironmentMap.uv(d);
            const elevation = Math.asin(Math.max(-1, Math.min(1, d.y)));
            const peak = mountains(ridge, u);

            if (elevation < peak) {
                // Below the ridge line: snow above a line, rock, then the
                // valley, the faces sloping towards the sun brighter.
                if (elevation < 0)
                    return new Vec3(0.12, 0.17, 0.08).scale(0.8 + 0.4 * snow(u * 2, v));
                // Rock shows through where the noise says, more of it
                // lower down; the snow is whiter towards the peaks.
                // And the distance blues them towards the horizon's haze.
                const n = snow(u * 1.5, elevation * 0.6);
                const rock = Math.max(smoothstep(-0.05, 0.05, n - 0.3 + 0.4 * Math.min(elevation / 0.12, 1)), 1 - smoothstep(0.03, 0.05, elevation));
                const shade = 0.8 + 0.25 * snow(u * 0.75, elevation * 0.3) + 0.2 * elevation / peak;
                const stone = new Vec3(0.2, 0.2, 0.22).lerp(new Vec3(0.12, 0.17, 0.08), Math.max(0, 1 - elevation / 0.03));
                return new Vec3(1.05, 1.1, 1.2).lerp(stone, rock).scale(shade).lerp(horizon, 0.3);
            }

            const t = Math.pow(Math.max(d.y, 0), 0.5);
            let sky = horizon.lerp(zenith, t);
            // Cumulus: bright tops, greyer bases, thinning near the horizon.
            const c = smoothstep(0.05, 0.35, clouds(u * 2, v * 2) + 0.1 - 0.4 * (1 - d.y));
            sky = sky.lerp(new Vec3(1.4, 1.4, 1.45).scale(0.75 + 0.25 * d.y), c);
            // The sun, and its glow.
            const near = d.dot(ALPINE_SUN);
            const glow = 0.6 * Math.pow(Math.max(near, 0), 64);
            const disc = near > Math.cos(0.02) ? 4000 : 0;
            return sky.add(new Vec3(1, 0.95, 0.85).scale(glow + disc));
        });
    });
}

/** The direction of the sunset's sun, low in the west. */
export const SUNSET_SUN = new Vec3(-0.9, 0.06, -0.42).normalized();

/**
 * A sunset: the sun just above the horizon, orange and pink streaks of
 * cloud, deepening to violet overhead, and dark land below.
 */
export function sunset() {
    return once("sunset", () => {
        const streaks = fractalNoise(95, 6, 5);
        return EnvironmentMap.procedural(1024, 512, (d) => {
            const [u, v] = EnvironmentMap.uv(d);
            if (d.y < -0.005)
                return new Vec3(0.03, 0.02, 0.025);
            const toward = Math.max(d.dot(SUNSET_SUN), 0);
            const t = Math.pow(Math.max(d.y, 0), 0.4);
            let sky = new Vec3(1.6, 0.55, 0.2).lerp(new Vec3(0.12, 0.08, 0.25), t);
            sky = sky.add(new Vec3(1.5, 0.6, 0.2).scale(Math.pow(toward, 8)));
            // Streaks of cloud, stretched along the horizon, lit from below.
            const c = smoothstep(0.0, 0.3, streaks(u * 3, v * 12) - 0.3 * d.y);
            sky = sky.lerp(new Vec3(1.8, 0.7, 0.45).scale(0.4 + 1.2 * Math.pow(toward, 3)), c * 0.8);
            const disc = toward > Math.cos(0.025) ? 2500 : 0;
            return sky.add(new Vec3(1, 0.7, 0.4).scale(disc));
        });
    });
}
