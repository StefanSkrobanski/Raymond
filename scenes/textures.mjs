// Procedural textures for the demo scenes: wood, stone, brick, planets and
// so on, drawn with tileable noise so they repeat without seams. Each is
// made the first time it's asked for and kept, since drawing one takes a
// moment and several scenes share them.

import { Texture, Vec3, hexColor } from "../src/index.mjs";
import { seededRandom } from "./helpers.mjs";

/**
 * Smooth noise from -1 to 1 that repeats every period units in x and y,
 * so a texture made from it tiles.
 * @param {number} seed
 * @param {number} period a whole number
 * @returns {(x: number, y: number) => number}
 */
export function tileNoise(seed, period) {

    const random = seededRandom(seed);
    const values = Float64Array.from({ length: period * period }, () => random() * 2 - 1);
    const at = (/** @type {number} */ i, /** @type {number} */ j) =>
        values[(((i % period) + period) % period) * period + (((j % period) + period) % period)];
    const smooth = (/** @type {number} */ t) => t * t * t * (t * (t * 6 - 15) + 10);

    return (x, y) => {
        const i = Math.floor(x), j = Math.floor(y);
        const u = smooth(x - i), v = smooth(y - j);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
        return a + (b - a) * v;
    };
}

/**
 * Fractal noise: octaves of tileable noise, each twice as fine and half as
 * strong, all repeating at u, v = 1. Returns roughly -1 to 1.
 * @param {number} seed
 * @param {number} period the coarsest octave's cells across the texture
 * @param {number} [octaves]
 * @returns {(u: number, v: number) => number}
 */
export function fractalNoise(seed, period, octaves = 5) {
    const layers = Array.from({ length: octaves }, (_, k) => tileNoise(seed + k * 101, period << k));
    return (u, v) => {
        let sum = 0, amplitude = 0.5;
        layers.forEach((noise, k) => {
            sum += amplitude * noise(u * (period << k), v * (period << k));
            amplitude *= 0.5;
        });
        return sum;
    };
}

/** @type {Map<string, Texture>} */
const made = new Map();

/**
 * @param {string} name
 * @param {() => Texture} make
 */
function once(name, make) {
    let texture = made.get(name);
    if (!texture) {
        texture = make();
        made.set(name, texture);
    }
    return texture;
}

/**
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {number} t
 */
const mix = (a, b, t) => a.lerp(b, Math.min(Math.max(t, 0), 1));

/** Wood with its grain running along u: rings, wavy with noise. */
export function wood() {
    return once("wood", () => {
        const noise = fractalNoise(1, 4, 4);
        const light = hexColor("#c08a52"), dark = hexColor("#7a4a26");
        return Texture.procedural(512, 512, (u, v) => {
            const ring = Math.sin((v * 10 + noise(u, v) * 2.5 + 0.6 * noise(u * 2, v)) * Math.PI);
            const streak = 0.25 * noise(u * 4, v * 16);
            return mix(dark, light, 0.55 + 0.25 * ring + streak);
        });
    });
}

/** Floorboards: planks of wood running along u, staggered, with dark gaps. */
export function planks() {
    return once("planks", () => {
        const grain = fractalNoise(2, 4, 4);
        const random = seededRandom(5);
        const shades = Array.from({ length: 64 }, () => 0.75 + 0.35 * random());
        const light = hexColor("#c9945c"), dark = hexColor("#80502c");
        return Texture.procedural(512, 512, (u, v) => {
            const rows = 8, row = Math.floor(v * rows);
            const along = u * 2 + (row % 2) * 0.5 + row * 0.37;
            const plank = Math.floor(along);
            const fv = v * rows - row, fu = along - plank;
            if (fv < 0.04 || fu < 0.01)
                return hexColor("#2a1a10");
            const ring = Math.sin((fv * 6 + grain(u, v) * 4) * Math.PI);
            return mix(dark, light, 0.55 + 0.35 * ring).scale(shades[(row * 7 + plank) & 63]);
        });
    });
}

/** White marble with grey veins. */
export function marble() {
    return once("marble", () => {
        const noise = fractalNoise(3, 4, 6);
        const white = hexColor("#f2efe9"), vein = hexColor("#6f6a70");
        return Texture.procedural(512, 512, (u, v) => {
            const t = Math.abs(Math.sin((u * 3 + v * 2 + noise(u, v) * 4) * Math.PI));
            return mix(vein, white, Math.pow(t, 0.25));
        });
    });
}

/** Red brick in running bond, with pale mortar. */
export function brick() {
    return once("brick", () => {
        const noise = fractalNoise(4, 8, 4);
        const random = seededRandom(9);
        const shades = Array.from({ length: 128 }, () => 0.75 + 0.4 * random());
        const red = hexColor("#9c4a32"), mortar = hexColor("#cfc6b8");
        return Texture.procedural(512, 512, (u, v) => {
            const rows = 8, row = Math.floor(v * rows);
            const along = u * 4 + (row % 2) * 0.5;
            const fu = along - Math.floor(along), fv = v * rows - row;
            if (fu < 0.04 || fv < 0.08)
                return mortar.scale(0.9 + 0.2 * noise(u, v));
            return red.scale(shades[(row * 9 + Math.floor(along)) & 127] * (0.9 + 0.25 * noise(u * 2, v * 2)));
        });
    });
}

/** Weathered grey stone, blotched and speckled. */
export function stone() {
    return once("stone", () => {
        const noise = fractalNoise(6, 4, 6);
        const grey = hexColor("#8d877c"), dark = hexColor("#4f4b45"), lichen = hexColor("#9a9468");
        return Texture.procedural(512, 512, (u, v) => {
            const n = noise(u, v);
            const c = mix(dark, grey, 0.75 + n * 0.7);
            return mix(c, lichen, (noise(u * 2 + 0.3, v * 2) - 0.3) * 1.5);
        });
    });
}

/** Sandstone laid in courses of blocks, as on the pyramids. */
export function sandstoneBlocks() {
    return once("sandstone", () => {
        const noise = fractalNoise(7, 8, 4);
        const random = seededRandom(13);
        const shades = Array.from({ length: 256 }, () => 0.85 + 0.25 * random());
        const sand = hexColor("#d6b47c");
        return Texture.procedural(512, 512, (u, v) => {
            const rows = 16, row = Math.floor(v * rows);
            const along = u * 16 + (row % 2) * 0.5;
            const fu = along - Math.floor(along), fv = v * rows - row;
            const joint = fu < 0.05 || fv < 0.08 ? 0.7 : 1;
            return sand.scale(joint * shades[(row * 17 + Math.floor(along)) & 255] * (0.9 + 0.2 * noise(u, v)));
        });
    });
}

/** Plaster: a soft, faintly mottled off-white. */
export function plaster() {
    return once("plaster", () => {
        const noise = fractalNoise(8, 8, 5);
        const base = hexColor("#e4dccf");
        return Texture.procedural(256, 256, (u, v) => base.scale(0.93 + 0.12 * noise(u, v)));
    });
}

/**
 * Office windows for a building's face: a grid of glass, some lit, between
 * concrete mullions. Repeat it by the building's floors and bays.
 */
export function windows() {
    return once("windows", () => {
        const random = seededRandom(21);
        const lit = Array.from({ length: 64 }, () => random() < 0.15);
        const concrete = hexColor("#b9b4aa"), glass = hexColor("#1c2836"), light = hexColor("#e8c47a");
        return Texture.procedural(256, 256, (u, v) => {
            const bays = 4, floors = 4;
            const fu = u * bays - Math.floor(u * bays), fv = v * floors - Math.floor(v * floors);
            if (fu < 0.18 || fv < 0.3)
                return concrete;
            return lit[Math.floor(u * bays) * 8 + Math.floor(v * floors)] ? light : glass;
        });
    });
}

/**
 * The Earth, as a globe's map (2 by 1): oceans, continents shaded from
 * green to desert, and ice at the poles.
 */
export function earth() {
    return once("earth", () => {
        const land = fractalNoise(31, 3, 6);
        const ocean = hexColor("#13406e"), shallow = hexColor("#1f6aa0"), green = hexColor("#3d6b2c"),
            desert = hexColor("#bfa16a"), ice = hexColor("#f2f5f7");
        return Texture.procedural(512, 256, (u, v) => {
            const latitude = Math.abs(v - 0.5) * 2;
            if (latitude > 0.86 + 0.05 * land(u, v * 0.5 + 0.3))
                return ice;
            const h = land(u, v * 0.5) + 0.12 * (1 - latitude);
            if (h < 0.05)
                return mix(ocean, shallow, (h + 0.25) * 3);
            const dry = 1 - Math.abs(latitude - 0.3) * 4 + land(u * 2, v) * 2;
            return mix(green, desert, dry);
        });
    });
}

/** Jupiter: banded clouds, swirled, with the Great Red Spot. */
export function jupiter() {
    return once("jupiter", () => {
        const swirl = fractalNoise(41, 4, 5);
        const bands = [hexColor("#e8d9bf"), hexColor("#c49a6c"), hexColor("#f2e6cf"), hexColor("#a87a52"), hexColor("#ddc6a2")];
        const spot = hexColor("#b8553a");
        return Texture.procedural(512, 256, (u, v) => {
            const w = v * 14 + swirl(u, v * 0.5) * 1.5;
            const k = Math.floor(w), t = w - k;
            let c = mix(bands[((k % 5) + 5) % 5], bands[(((k + 1) % 5) + 5) % 5], t * t * (3 - 2 * t));
            const dx = (u - 0.3) * 2, dy = (v - 0.62) * 4.5;
            const d = Math.hypot(dx, dy);
            if (d < 0.12)
                c = mix(spot, c, d / 0.12);
            return c;
        });
    });
}

/** Mars: rusty red plains, dark highlands, and a pale cap at the north. */
export function mars() {
    return once("mars", () => {
        const noise = fractalNoise(51, 4, 6);
        const rust = hexColor("#c1440e"), dark = hexColor("#6b2a12"), pale = hexColor("#e6d2c0");
        return Texture.procedural(512, 256, (u, v) => {
            if (v < 0.06 + 0.02 * noise(u, v))
                return pale;
            return mix(dark, rust, 0.6 + noise(u, v * 0.5) * 1.5);
        });
    });
}

/**
 * The moon's craters, the same each time: for each texture coordinate, the
 * craters near enough to matter, each with its distance from there in
 * crater radii. Each crater is listed in the cells of a coarse grid that
 * it reaches (to reach radii out), so each pixel only checks those near it.
 * @param {number} reach
 * @returns {(u: number, v: number) => { r: number, d: number }[]}
 */
function craters(reach) {

    const random = seededRandom(62);
    const list = Array.from({ length: 120 }, () => ({ u: random(), v: 0.1 + 0.8 * random(), r: 0.005 + 0.03 * random() ** 2 }));

    const CELLS = 16;
    /** @type {typeof list[]} */
    const grid = Array.from({ length: CELLS * CELLS }, () => []);
    for (const crater of list) {
        // u runs twice as far round as v does down.
        const across = crater.r * reach / 2, down = crater.r * reach;
        for (let i = Math.floor((crater.u - across) * CELLS); i <= Math.floor((crater.u + across) * CELLS); ++i)
            for (let j = Math.max(0, Math.floor((crater.v - down) * CELLS)); j <= Math.min(CELLS - 1, Math.floor((crater.v + down) * CELLS)); ++j)
                grid[(((i % CELLS) + CELLS) % CELLS) * CELLS + j].push(crater);
    }

    return (u, v) => grid[Math.min(CELLS - 1, Math.floor(u * CELLS)) * CELLS + Math.min(CELLS - 1, Math.floor(v * CELLS))].map((crater) => {
        const du = Math.min(Math.abs(u - crater.u), 1 - Math.abs(u - crater.u)) * 2;
        return { r: crater.r, d: Math.hypot(du, v - crater.v) / crater.r };
    });
}

/** The moon (and Mercury): grey, with dark seas and craters. */
export function moon() {
    return once("moon", () => {
        const noise = fractalNoise(61, 4, 6);
        const near = craters(1);
        const grey = hexColor("#a9a6a0"), sea = hexColor("#5f5d5a");
        return Texture.procedural(512, 256, (u, v) => {
            let c = mix(sea, grey, 0.7 + noise(u, v * 0.5) * 2);
            for (const { d } of near(u, v))
                if (d < 1)
                    c = c.scale(d > 0.8 ? 1.25 : 0.8);
            return c;
        });
    });
}

/** Saturn: soft, pale bands. */
export function saturn() {
    return once("saturn", () => {
        const swirl = fractalNoise(71, 4, 3);
        const a = hexColor("#eadcb4"), b = hexColor("#c8ad7c");
        return Texture.procedural(512, 256, (u, v) =>
            mix(a, b, 0.5 + 0.5 * Math.sin((v * 18 + swirl(u, v) * 0.6) * Math.PI)));
    });
}

// ---- Bumps, as normal maps, to go with the textures above ----

/** @type {(edge0: number, edge1: number, x: number) => number} */
const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
};

/**
 * How far in from the nearest joint a point is, for blocks laid in
 * running bond: rows across v, each perUnit blocks along u, alternate rows
 * shifted by half a block. In fractions of a block's height (fv) and length
 * (fu), so 0 on a joint and 0.5 in the middle.
 * @param {number} u
 * @param {number} v
 * @param {number} rows
 * @param {number} along blocks along u in each row
 * @param {number} [stagger] extra shift per row
 */
function bond(u, v, rows, along, stagger = 0) {
    const row = Math.floor(v * rows);
    const a = u * along + (row % 2) * 0.5 + row * stagger;
    const fu = a - Math.floor(a), fv = v * rows - row;
    return { fu: Math.min(fu, 1 - fu), fv: Math.min(fv, 1 - fv) };
}

/** Brick's bumps: sunken mortar with rounded edges, and rough faces. */
export function brickBumps() {
    return once("brick bumps", () => {
        const noise = fractalNoise(4, 16, 4);
        return Texture.normalMap(512, 512, (u, v) => {
            // A brick is a quarter of the texture wide and an eighth high.
            const { fu, fv } = bond(u, v, 8, 4);
            const inset = Math.min(smoothstep(0.02, 0.06, fu), smoothstep(0.04, 0.12, fv));
            return 0.006 * inset + 0.0012 * noise(u, v);
        });
    });
}

/** Floorboards' bumps: grooves between the planks, and a little grain. */
export function planksBumps() {
    return once("planks bumps", () => {
        const grain = fractalNoise(2, 4, 4);
        return Texture.normalMap(512, 512, (u, v) => {
            const { fu, fv } = bond(u, v, 8, 2, 0.37);
            const inset = Math.min(smoothstep(0.0, 0.012, fu), smoothstep(0.0, 0.05, fv));
            return 0.003 * inset + 0.0003 * Math.sin((v * 48 + grain(u, v) * 4) * Math.PI);
        });
    });
}

/** Stone's bumps: pitted and lumpy. */
export function stoneBumps() {
    return once("stone bumps", () => {
        const noise = fractalNoise(6, 4, 6);
        const fine = fractalNoise(16, 32, 3);
        return Texture.normalMap(512, 512, (u, v) => 0.012 * noise(u, v) + 0.002 * fine(u, v));
    });
}

/** The sandstone blocks' bumps: worn joints, and grainy faces. */
export function sandstoneBumps() {
    return once("sandstone bumps", () => {
        const noise = fractalNoise(7, 32, 3);
        return Texture.normalMap(512, 512, (u, v) => {
            const { fu, fv } = bond(u, v, 16, 16);
            const inset = Math.min(smoothstep(0.0, 0.08, fu), smoothstep(0.0, 0.12, fv));
            return 0.0015 * inset + 0.0006 * noise(u, v);
        });
    });
}

/** Plaster's bumps: faint, soft unevenness. */
export function plasterBumps() {
    return once("plaster bumps", () => {
        const noise = fractalNoise(8, 16, 4);
        return Texture.normalMap(256, 256, (u, v) => 0.0015 * noise(u, v));
    });
}

/**
 * The moon's bumps: bowl-shaped craters with raised rims, where moon()
 * draws them, on rolling ground.
 */
export function moonBumps() {
    return once("moon bumps", () => {
        const noise = fractalNoise(61, 8, 5);
        const near = craters(1.6);
        return Texture.normalMap(512, 256, (u, v) => {
            let h = 0.004 * noise(u, v);
            // A bowl inside each crater, a rim round it, fading out beyond.
            for (const { r, d } of near(u, v))
                if (d < 1.6)
                    h += r * 0.12 * (d < 1 ? d * d - 0.8 : 0.2 * (1 - smoothstep(1, 1.6, d)));
            return h;
        });
    });
}

// ---- Glowing patterns, for emission textures ----

/**
 * The Earth's city lights, to glow on its night side: clusters on land
 * (as earth() draws it), strung along coasts, none on the ice.
 */
export function earthLights() {
    return once("earth lights", () => {
        const land = fractalNoise(31, 3, 6);
        const regions = fractalNoise(32, 8, 3);
        const towns = fractalNoise(33, 64, 2);
        const warm = hexColor("#ffc070");
        return Texture.procedural(512, 256, (u, v) => {
            const latitude = Math.abs(v - 0.5) * 2;
            const h = land(u, v * 0.5) + 0.12 * (1 - latitude);
            if (h < 0.05 || latitude > 0.75)
                return new Vec3(0, 0, 0);
            // Specks of towns, crowded in some regions and along coasts.
            const crowded = smoothstep(-0.1, 0.25, regions(u, v * 0.5) + 0.3 * (1 - smoothstep(0.05, 0.2, h)));
            return warm.scale(crowded * smoothstep(0.2, 0.4, towns(u, v * 0.5)));
        });
    });
}

/** The Sun's surface: churning granules, darker towards sunspots. */
export function sunSurface() {
    return once("sun surface", () => {
        const granules = fractalNoise(81, 48, 2);
        const spots = fractalNoise(82, 3, 3);
        const hot = new Vec3(1, 0.9, 0.7), cool = new Vec3(0.55, 0.22, 0.05);
        return Texture.procedural(512, 256, (u, v) => {
            const g = mix(cool, hot, 0.65 + granules(u, v * 0.5) * 1.6);
            const spot = smoothstep(0.28, 0.36, spots(u, v * 0.5));
            return g.scale(1 - 0.92 * spot);
        });
    });
}

/**
 * The lit windows of windows(), alone, to make them glow at night: the
 * rest is black.
 */
export function windowLights() {
    return once("window lights", () => {
        const random = seededRandom(21);
        const lit = Array.from({ length: 64 }, () => random() < 0.15);
        // At night more of the building is lit: these windows too.
        const late = Array.from({ length: 64 }, () => random() < 0.3);
        const warm = hexColor("#ffd08a"), cool = hexColor("#c8dcff");
        return Texture.procedural(256, 256, (u, v) => {
            const bays = 4, floors = 4;
            const fu = u * bays - Math.floor(u * bays), fv = v * floors - Math.floor(v * floors);
            if (fu < 0.18 || fv < 0.3)
                return new Vec3(0, 0, 0);
            const k = Math.floor(u * bays) * 8 + Math.floor(v * floors);
            return lit[k] ? warm : late[k] ? cool.scale(0.6) : new Vec3(0, 0, 0);
        });
    });
}

/**
 * Street lights, for a city block (one tile each): roads along the tile's
 * edges, glowing sodium orange, brightest under the lamps.
 */
export function streetLights() {
    return once("street lights", () => {
        const sodium = hexColor("#ffa040");
        return Texture.procedural(256, 256, (u, v) => {
            // Distance from the road's middle, at the tile's edges.
            const du = Math.min(u, 1 - u), dv = Math.min(v, 1 - v);
            const road = Math.max(1 - smoothstep(0.02, 0.07, du), 1 - smoothstep(0.02, 0.07, dv));
            // Lamps every quarter block along each road.
            const lamp = (along, across) => {
                const d = Math.hypot((along * 4 - Math.round(along * 4)) / 4, across - 0.03);
                return Math.exp(-(d * d) / 0.0004);
            };
            const pools = Math.max(lamp(v, du), lamp(u, dv));
            return sodium.scale(0.15 * road + 1.2 * pools);
        });
    });
}
