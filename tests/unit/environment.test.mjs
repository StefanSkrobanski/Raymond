// Environment maps: their layout, reading .hdr files, and the table the
// renderer picks directions from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentMap, Sky, Vec3 } from "../../src/index.mjs";
import { assertClose, assertVecClose } from "./helpers.mjs";

test("directions and texture coordinates go round the horizon from -z, and down from straight up", () => {

    assertVecClose(EnvironmentMap.direction(0.5, 0.5), new Vec3(0, 0, -1), "the middle is ahead", 1e-12);
    assertVecClose(EnvironmentMap.direction(0.75, 0.5), new Vec3(1, 0, 0), "three quarters is +x", 1e-12);
    assertClose(EnvironmentMap.direction(0.3, 0).y, 1, "the top is straight up", 1e-12);
    assertClose(EnvironmentMap.direction(0.3, 1).y, -1, "the bottom straight down", 1e-12);

    for (const [u, v] of [[0.1, 0.2], [0.6, 0.7], [0.95, 0.4]]) {
        const [u2, v2] = EnvironmentMap.uv(EnvironmentMap.direction(u, v));
        assertClose(u2, u, "u round trip", 1e-12);
        assertClose(v2, v, "v round trip", 1e-12);
    }
});

test("procedural maps take each pixel's centre, and sample back smoothly", () => {

    const env = EnvironmentMap.procedural(64, 32, (d) => new Vec3(d.y + 1, 0, 0));
    assertClose(env.data[0], Math.cos(Math.PI / 64) + 1, "the top row is half a pixel down", 1e-6);
    assertClose(env.sample(new Vec3(0, 0, -1)).x, 1, "level is 1", 0.02);
    assert.throws(() => new EnvironmentMap(2, 2, [1, 2, 3]), RangeError);
    assert.equal(new EnvironmentMap(1, 1, [-1, NaN, 2]).data.join(), "0,0,2", "negative and broken values are dropped");
});

// A Radiance .hdr file of the given pixels, run-length encoded or flat.
function encodeHDR(width, height, pixels, rle) {

    const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
    const bytes = [...header];
    const rgbe = (r, g, b) => {
        const m = Math.max(r, g, b);
        if (m < 1e-32)
            return [0, 0, 0, 0];
        const e = Math.ceil(Math.log2(m) + 1e-9);
        const scale = 256 / 2 ** e;
        return [r * scale, g * scale, b * scale, e + 128].map(Math.floor);
    };

    for (let y = 0; y < height; ++y) {
        const row = Array.from({ length: width }, (_, x) => rgbe(...pixels(x, y)));
        if (!rle) {
            bytes.push(...row.flat());
            continue;
        }
        bytes.push(2, 2, width >> 8, width & 255);
        // Each channel as a run of its first value, then the rest literally.
        for (let c = 0; c < 4; ++c) {
            const values = row.map((p) => p[c]);
            bytes.push(128 + 3, values[0]);
            for (let x = 3; x < width; x += 100) {
                const chunk = values.slice(x, Math.min(x + 100, width));
                bytes.push(chunk.length, ...chunk);
            }
        }
    }
    return new Uint8Array(bytes);
}

test("Radiance .hdr files read back, flat and run-length encoded", () => {

    // The first three pixels of each row match, for the run.
    const pixels = (x, y) => x < 3 ? [0.5, 1, 2] : [x * 0.25, y * 3, 100 + x];
    for (const rle of [false, true]) {
        const env = EnvironmentMap.fromHDR(encodeHDR(16, 4, pixels, rle));
        assert.equal(env.width, 16);
        assert.equal(env.height, 4);
        for (const [x, y] of [[0, 0], [2, 3], [5, 1], [15, 3]]) {
            const expected = pixels(x, y);
            // RGBE shares one exponent across a pixel, so each channel is
            // good to 1/128 of its brightest.
            for (let c = 0; c < 3; ++c)
                assertClose(env.data[(y * 16 + x) * 3 + c], expected[c], `${rle ? "rle" : "flat"} (${x}, ${y})`, Math.max(...expected) / 128);
        }
    }

    assert.throws(() => EnvironmentMap.fromHDR(new TextEncoder().encode("P6\n1 1\n255\n")), /Not a Radiance/);
    assert.throws(() => EnvironmentMap.fromHDR(new TextEncoder().encode("#?RADIANCE\n\n+Y 1 +X 1\n")), /top to bottom/);
});

test("the importance table picks directions in proportion to their light", () => {

    const env = EnvironmentMap.procedural(256, 128, (d) => d.y > 0.95 ? new Vec3(50, 40, 30) : new Vec3(0.2, 0.3, 0.5 * (d.x > 0 ? 1 : 0)));
    const random = mulberry(5);

    // The pdf integrates to 1 over the sphere.
    let integral = 0;
    const n = 100000;
    for (let i = 0; i < n; ++i) {
        const z = 2 * random() - 1, a = 2 * Math.PI * random(), r = Math.sqrt(1 - z * z);
        integral += env.pdf(new Vec3(r * Math.cos(a), z, r * Math.sin(a))) * 4 * Math.PI / n;
    }
    assertClose(integral, 1, "the pdf integrates to 1", 0.02);

    // The bright cap overhead (about 1.6% of the sphere) gets most picks.
    let up = 0;
    for (let i = 0; i < 20000; ++i) {
        const { direction, pdf } = env.sampleDirection([random(), random(), random(), random()]);
        assertClose(pdf, env.pdf(direction), "sampleDirection reports its pdf", 1e-9);
        if (direction.y > 0.95)
            up++;
    }
    assert.ok(up / 20000 > 0.7, `${up} of 20000 picks overhead`);

    // A black panorama picks uniformly by area, like any other.
    const black = new EnvironmentMap(8, 4, new Float32Array(96));
    assert.ok(black.importance().data.every(Number.isFinite));
});

test("a sky's radiance comes from its environment, turned and scaled", () => {

    const env = EnvironmentMap.procedural(64, 32, (d) => new Vec3(d.x > 0 ? 1 : 0, 0, 0));
    const ahead = new Vec3(0.9, 0, -0.43).normalized();
    assert.ok(Sky.environment(env, 2).radiance(ahead).x > 1.9, "towards +x is bright, doubled");
    // Turned a half turn, the bright half is the other way.
    assert.ok(Sky.environment(env, 2, Math.PI).radiance(ahead).x < 0.1);
    assert.ok(Sky.environment(env, 2, Math.PI).radiance(new Vec3(-0.9, 0, 0.43).normalized()).x > 1.9);
    // Without one, it's the gradient.
    assertVecClose(new Sky().radiance(new Vec3(0, 1, 0)), new Sky().zenith, "straight up", 1e-12);
});

function mulberry(seed) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
