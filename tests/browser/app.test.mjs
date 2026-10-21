// Drives the library and the app in headless Chromium, on WebGPU emulated
// by SwiftShader. Checks the GPU against the CPU raycast and against exact
// answers for simple lighting, then the app's controls, the example page
// and the error shown without WebGPU.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";
import { Sky, Vec3 } from "../../src/index.mjs";
import { ENVIRONMENT, ROTATION, STRENGTH } from "./environment.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const TYPES = {
    ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png",
};

// Headless Chromium only presents WebGPU canvases with Vulkan and ANGLE on
// SwiftShader, in the new headless mode (the "chromium" channel).
const GPU_LAUNCH = {
    channel: "chromium",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-angle=swiftshader"],
};

let server;
let browser;
let base_url;

before(async () => {

    // A minimal static file server for the repository.
    server = createServer(async (request, response) => {
        let path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
        if (path.endsWith("/"))
            path += "index.html";
        try {
            const body = await readFile(join(ROOT, path));
            response.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
            response.end(body);
        }
        catch {
            response.writeHead(404);
            response.end();
        }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base_url = `http://127.0.0.1:${server.address().port}/`;

    browser = await chromium.launch(GPU_LAUNCH);
});

after(async () => {
    await browser?.close();
    server?.close();
});

// Opens a page, collecting its errors (missing favicons aside). Service
// workers are blocked unless asked for, so cached copies never stand in
// for the files under test.
async function open(path, { viewport = { width: 480, height: 320 }, serviceWorkers = false } = {}) {

    const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: serviceWorkers ? "allow" : "block" });
    const page = await context.newPage();
    const errors = [];

    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() == "error" && !m.text().includes("404"))
            errors.push(m.text());
    });

    await page.goto(base_url + path);
    return { page, errors, context };
}

let fixture;

async function trace(name, options) {

    if (!fixture) {
        fixture = (await open("tests/browser/fixture.html")).page;
        await fixture.waitForFunction(() => window.ready);
    }

    return fixture.evaluate(([n, o]) => window.trace(n, o), [name, options]);
}

const rgb = (pixels, i) => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));

// Pixels whose centre and four neighbours all see the same object, so
// antialiasing doesn't blend it with another.
function interior(hits, size, object = null) {

    const keep = [];
    for (let y = 1; y < size - 1; ++y) {
        for (let x = 1; x < size - 1; ++x) {
            const i = y * size + x;
            const h = hits[i];
            if (!h || (object !== null && h.object != object))
                continue;
            if ([i - 1, i + 1, i - size, i + size].every((j) => hits[j] && hits[j].object == h.object))
                keep.push(i);
        }
    }
    return keep;
}

// ---- The GPU against the CPU ----

test("the GPU sees what the CPU raycast sees, through every pixel", async () => {

    const size = 64;
    const depth = await trace("mixed", { view: "depth", spp: 1, size });
    const normal = await trace("mixed", { view: "normal", spp: 1, size });

    let compared = 0;
    let wrong = 0;

    for (let i = 0; i < size * size; ++i) {

        const hit = depth.hits[i];
        const gpu_depth = depth.pixels[i * 4];

        if (!hit) {
            if (gpu_depth != 0)
                wrong++;
            continue;
        }

        compared++;
        const gpu_normal = rgb(normal.pixels, i);
        if (Math.abs(gpu_depth - hit.distance) > 1e-3 * hit.distance || dot(gpu_normal, hit.normal) < 0.999)
            wrong++;
    }

    assert.ok(compared > size * size * 0.5, "most pixels see something");
    // A few pixels on silhouettes may round differently.
    assert.ok(wrong <= size * size * 0.005, `${wrong} pixels disagree`);
});

test("the albedo view shows each surface's colour", async () => {

    const size = 48;
    const { pixels, hits } = await trace("mixed", { view: "albedo", spp: 1, size });

    // The sphere (object 1) is red, the floor (object 0) grey.
    for (const i of interior(hits, size, 1))
        assert.deepEqual(rgb(pixels, i).map((c) => +c.toFixed(3)), [1, 0, 0]);
    for (const i of interior(hits, size, 0))
        assert.deepEqual(rgb(pixels, i).map((c) => +c.toFixed(3)), [0.5, 0.5, 0.5]);
});

test("the GPU's textures match the CPU's, on every kind of primitive", async () => {

    const size = 64;
    const { pixels, hits } = await trace("textured", { view: "albedo", spp: 1, size });

    let compared = 0, wrong = 0;
    for (const i of interior(hits, size)) {
        compared++;
        const gpu = rgb(pixels, i), cpu = hits[i].albedo;
        if ([0, 1, 2].some((c) => Math.abs(gpu[c] - cpu[c]) > 0.02))
            wrong++;
    }

    assert.ok(compared > size * size * 0.6, `most pixels see something (${compared})`);
    // A few pixels where the grid's colours change may filter differently.
    assert.ok(wrong <= compared * 0.01, `${wrong} of ${compared} pixels disagree`);
});

test("the GPU's normal maps match the CPU's, on every kind of primitive", async () => {

    const size = 64;
    const { pixels, hits } = await trace("bumpy", { view: "normal", spp: 1, size });

    let compared = 0, wrong = 0, tilted = 0;
    for (const i of interior(hits, size)) {
        compared++;
        if (dot(rgb(pixels, i), hits[i].normal) < 0.995)
            wrong++;
        if (Math.abs(hits[i].normal[1]) < 0.98 && hits[i].object == 0)
            tilted++;
    }

    assert.ok(compared > size * size * 0.6, `most pixels see something (${compared})`);
    assert.ok(tilted > 100, `the bumps tilt the floor's normals (${tilted})`);
    assert.ok(wrong <= compared * 0.01, `${wrong} of ${compared} pixels disagree`);
});

test("the GPU's patterned lamps match the CPU's", async () => {

    const size = 48;
    const { pixels, hits } = await trace("patternedLamps", { view: "albedo", spp: 1, size });

    let compared = 0, wrong = 0;
    for (const i of interior(hits, size)) {
        compared++;
        const gpu = rgb(pixels, i), cpu = hits[i].albedo;
        if ([0, 1, 2].some((c) => Math.abs(gpu[c] - cpu[c]) > 0.02))
            wrong++;
    }

    assert.ok(compared > size * size * 0.4, `most pixels see a lamp (${compared})`);
    assert.ok(wrong <= compared * 0.01, `${wrong} of ${compared} pixels disagree`);
});

// ---- Light, against exact answers ----

test("a white furnace: a diffuse ball reflects exactly its albedo", async () => {

    const size = 32;
    const { pixels, hits } = await trace("furnaceDiffuse", { spp: 64, size });

    const ball = interior(hits, size, 0).map((i) => mean(rgb(pixels, i)));
    // Sky pixels clear of the ball's edge, which antialiasing blends in.
    const sky = hits.map((h, i) => [i, i - 1, i + 1, i - size, i + size].every((j) => j >= 0 && j < hits.length && !hits[j]) ? mean(rgb(pixels, i)) : null)
        .filter((v) => v !== null);

    assert.ok(Math.abs(mean(ball) - 0.8) < 0.01, `ball ${mean(ball)}`);
    assert.ok(Math.abs(mean(sky) - 1.0) < 1e-4, `sky ${mean(sky)}`);
});

test("a white furnace: clear glass neither gains nor loses light", async () => {

    const size = 32;
    const { pixels, hits } = await trace("furnaceGlass", { spp: 128, size, bounces: 32 });

    const ball = interior(hits, size, 0).map((i) => mean(rgb(pixels, i)));

    assert.ok(Math.abs(mean(ball) - 1.0) < 0.015, `ball ${mean(ball)}`);
});

test("a white furnace: glass that splits colours still looks white", async () => {

    const size = 32;
    const { pixels, hits } = await trace("furnaceDispersive", { spp: 256, size, bounces: 32 });

    const ball = interior(hits, size, 0);
    for (const c of [0, 1, 2]) {
        const channel = mean(ball.map((i) => pixels[i * 4 + c]));
        assert.ok(Math.abs(channel - 1.0) < 0.03, `channel ${c}: ${channel}`);
    }
});

test("splitting colours fringes what's seen through glass, and plain glass doesn't", async () => {

    const size = 48;
    // How far from grey the most colourful pixel is.
    const colourfulness = ({ pixels }) => Math.max(...Array.from({ length: size * size }, (_, i) => {
        const [r, g, b] = rgb(pixels, i);
        const total = r + g + b;
        return total > 0.05 ? (Math.max(r, g, b) - Math.min(r, g, b)) / total : 0;
    }));

    const plain = colourfulness(await trace("stripThroughGlass", { arg: "0", spp: 64, size, bounces: 8 }));
    const split = colourfulness(await trace("stripThroughGlass", { arg: "15", spp: 64, size, bounces: 8 }));

    assert.ok(plain < 1e-3, `plain glass ${plain}`);
    assert.ok(split > 0.3, `splitting glass ${split}`);
});

test("a white furnace: fog that only scatters neither makes nor loses light", async () => {

    const size = 32;
    const { pixels } = await trace("furnaceFog", { spp: 128, size, bounces: 64 });

    const all = mean(Array.from({ length: size * size }, (_, i) => mean(rgb(pixels, i))));
    assert.ok(Math.abs(all - 1.0) < 0.01, `mean ${all}`);
});

test("light through black smoke falls off as exp(-density × distance)", async () => {

    const size = 48;
    const { pixels, rays } = await trace("blackSmoke", { spp: 256, size });

    // Where each pixel's centre ray crosses the sphere, and the box (in its
    // own space, where it spans -1..1).
    const sphereChord = ({ origin, direction }) => {
        const oc = sub(origin, [-0.7, 0, 0]);
        const a = dot(direction, direction), b = dot(oc, direction), c = dot(oc, oc) - 0.64;
        const disc = b * b - a * c;
        return disc > 0 ? 2 * Math.sqrt(disc) / a * length(direction) : 0;
    };
    const box = { center: [0.6, 0, 0], size: [0.6, 0.5, 0.4], rx: 0.4, ry: 0.6 };
    const toBox = (v) => {
        // Undo the box's turns: rotateY(0.6) then rotateX(0.4), applied as Y(X(v)).
        const cy = Math.cos(-box.ry), sy = Math.sin(-box.ry), cx = Math.cos(-box.rx), sx = Math.sin(-box.rx);
        const y = [cy * v[0] + sy * v[2], v[1], -sy * v[0] + cy * v[2]];
        return [y[0], cx * y[1] - sx * y[2], sx * y[1] + cx * y[2]];
    };
    const boxChord = ({ origin, direction }) => {
        const o = toBox(sub(origin, box.center)).map((c, k) => c / box.size[k]);
        const d = toBox(direction).map((c, k) => c / box.size[k]);
        let near = -Infinity, far = Infinity;
        for (let k = 0; k < 3; ++k) {
            const t0 = (-1 - o[k]) / d[k], t1 = (1 - o[k]) / d[k];
            near = Math.max(near, Math.min(t0, t1));
            far = Math.min(far, Math.max(t0, t1));
        }
        return far > near && far > 0 ? (far - Math.max(near, 0)) * length(direction) : 0;
    };
    const expected = rays.map((ray) => Math.exp(-1.5 * (sphereChord(ray) + boxChord(ray))));

    // Pixels away from the edges, where antialiasing blends values.
    const smooth = [];
    for (let y = 1; y < size - 1; ++y)
        for (let x = 1; x < size - 1; ++x) {
            const i = y * size + x;
            if (expected[i] < 0.98 && [i - 1, i + 1, i - size, i + size].every((j) => Math.abs(expected[j] - expected[i]) < 0.05))
                smooth.push(i);
        }

    assert.ok(smooth.length > 100, `${smooth.length} pixels through smoke`);
    const ratio = mean(smooth.map((i) => pixels[i * 4] / expected[i]));
    assert.ok(Math.abs(ratio - 1.0) < 0.02, `rendered / exact = ${ratio}`);
});

test("the GPU's environment map matches the CPU's, turned and all", async () => {

    const size = 48;
    const { pixels, rays } = await trace("environmentSky", { view: "albedo", spp: 1, size });
    const sky = Sky.environment(ENVIRONMENT, STRENGTH, ROTATION);

    let wrong = 0;
    for (let i = 0; i < size * size; ++i) {
        const d = new Vec3(...rays[i].direction).normalized();
        const cpu = sky.radiance(d), gpu = rgb(pixels, i);
        // Half floats on the GPU: about 3 significant figures.
        if ([cpu.x, cpu.y, cpu.z].some((c, k) => Math.abs(gpu[k] - c) > 0.01 * c + 0.005))
            wrong++;
    }

    assert.ok(wrong <= size * size * 0.01, `${wrong} pixels disagree`);
});

test("light from an environment map matches the exact answer", async () => {

    // The irradiance on a floor facing up: the radiance above, times
    // cos(θ), over the hemisphere, by the midpoint rule.
    const sky = Sky.environment(ENVIRONMENT, STRENGTH, ROTATION);
    const rows = 400, columns = 800;
    let irradiance = 0;
    for (let i = 0; i < rows; ++i) {
        const theta = (i + 0.5) / rows * Math.PI / 2;
        for (let j = 0; j < columns; ++j) {
            const phi = (j + 0.5) / columns * 2 * Math.PI;
            const d = new Vec3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
            const l = sky.radiance(d);
            irradiance += mean([l.x, l.y, l.z]) * Math.cos(theta) * Math.sin(theta) * (Math.PI / 2 / rows) * (2 * Math.PI / columns);
        }
    }

    const size = 32;
    const result = await trace("environmentFloor", { spp: 64, size, bounces: 1 });

    const ratios = interior(result.hits, size, 0).map((i) => mean(rgb(result.pixels, i)) / (0.5 / Math.PI * irradiance));
    assert.ok(ratios.length > 200, `${ratios.length} floor pixels`);
    assert.ok(Math.abs(mean(ratios) - 1.0) < 0.015, `rendered / exact = ${mean(ratios)}`);
});

// The brightness of the floor (albedo 0.5) at each pixel, against the
// exact value from irradiance(point), averaged over the floor.
function assertFloorMatches(result, size, irradiance, tolerance) {

    const ratios = [];
    for (const i of interior(result.hits, size, 0)) {
        const expected = 0.5 / Math.PI * irradiance(result.hits[i].point);
        if (expected > 0.02)
            ratios.push(result.pixels[i * 4] / expected);
    }

    assert.ok(ratios.length > 200, `${ratios.length} floor pixels`);
    const average = mean(ratios);
    assert.ok(Math.abs(average - 1.0) < tolerance, `rendered / exact = ${average}`);
}

test("direct light from a sphere matches the exact answer", async () => {

    const size = 48;
    const result = await trace("sphereLight", { spp: 64, size, bounces: 1 });

    // A sphere wholly above the horizon gives E = pi L (r / d)^2 cos(theta).
    const centre = [0.5, 1.5, -1], radius = 0.5, emission = 6.0;

    assertFloorMatches(result, size, (p) => {
        const to = sub(centre, p);
        const d = length(to);
        const cos_theta = to[1] / d;
        return cos_theta < radius / d ? 0 : Math.PI * emission * (radius / d) ** 2 * cos_theta;
    }, 0.015);
});

test("direct light from a quad matches the exact answer", async () => {

    const size = 48;
    const result = await trace("quadLight", { spp: 128, size, bounces: 1 });

    // Lambert's formula for a polygon: E = L/2 sum over edges of the angle
    // each edge subtends times the cosine of its plane's normal with up.
    const corners = [[-0.5, 1.5, -1.5], [0.7, 1.5, -1.5], [0.7, 1.5, -0.7], [-0.5, 1.5, -0.7]];
    const emission = 6.0;

    assertFloorMatches(result, size, (p) => {
        let sum = 0;
        for (let k = 0; k < 4; ++k) {
            const a = sub(corners[k], p), b = sub(corners[(k + 1) % 4], p);
            const c = cross(a, b);
            const angle = Math.acos(dot(a, b) / (length(a) * length(b)));
            sum += angle * c[1] / length(c);
        }
        return emission / 2 * Math.abs(sum);
    }, 0.015);
});

test("light from an overhead sun matches the exact answer", async () => {

    const size = 32;
    const result = await trace("sun", { spp: 16, size, bounces: 1 });

    // The disc's radiance times its projected solid angle.
    const size_angle = 0.05;
    const irradiance = 2.0 * (1 + Math.cos(size_angle)) / 2;

    assertFloorMatches(result, size, () => irradiance, 0.005);
});

for (const material of ["diffuse", "plastic", "metal"]) {

    test(`sampling a light directly agrees with finding it by bouncing, on ${material}`, async () => {

        // The sphere is sampled as a light, combining both strategies by
        // multiple importance sampling; the mesh can only be found by
        // bouncing. Wrong weights would make them differ.
        const size = 32;
        const direct = await trace("lightAsSphere", { arg: material, spp: 256, size, bounces: 1 });
        const bounced = await trace("lightAsMesh", { arg: material, spp: 1024, size, bounces: 1 });

        const floor = interior(direct.hits, size, 0).filter((i) => bounced.hits[i]?.object == 0);
        const a = mean(floor.map((i) => mean(rgb(direct.pixels, i))));
        const b = mean(floor.map((i) => mean(rgb(bounced.pixels, i))));

        assert.ok(floor.length > 200);
        assert.ok(Math.abs(a / b - 1.0) < 0.03, `direct ${a}, bounced ${b}`);
    });
}

test("sampling a patterned lamp directly agrees with finding it by bouncing, patch by patch", async () => {

    const size = 32;
    const direct = await trace("patternedLamp", { arg: "light", spp: 256, size, bounces: 1 });
    const bounced = await trace("patternedLamp", { arg: "glow", spp: 1024, size, bounces: 1 });

    // The floor in quarters: a lamp lit the wrong way round would light
    // them differently.
    const floor = interior(direct.hits, size, 0).filter((i) => bounced.hits[i]?.object == 0);
    for (const quarter of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const patch = floor.filter((i) => Math.floor((i % size) / (size / 2)) == quarter[0] && Math.floor(i / size / (size / 2)) == quarter[1]);
        for (const c of [0, 1, 2]) {
            const a = mean(patch.map((i) => direct.pixels[i * 4 + c]));
            const b = mean(patch.map((i) => bounced.pixels[i * 4 + c]));
            assert.ok(Math.abs(a / b - 1.0) < 0.04, `quarter ${quarter}, channel ${c}: direct ${a}, bounced ${b}`);
        }
    }
});

test("sampling a light through fog agrees with finding it by scattering", async () => {

    const size = 32;
    const direct = await trace("lampInFog", { arg: "light", spp: 256, size, bounces: 1 });
    const bounced = await trace("lampInFog", { arg: "mesh", spp: 1024, size, bounces: 1 });

    const a = mean(Array.from({ length: size * size }, (_, i) => mean(rgb(direct.pixels, i))));
    const b = mean(Array.from({ length: size * size }, (_, i) => mean(rgb(bounced.pixels, i))));
    assert.ok(Math.abs(a / b - 1.0) < 0.03, `direct ${a}, bounced ${b}`);
});

// ---- The denoiser ----

// The root mean square difference between two images' RGB.
function rmse(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4)
        for (let c = 0; c < 3; ++c)
            sum += (a[i + c] - b[i + c]) ** 2;
    return Math.sqrt(sum / (a.length / 4 * 3));
}

// The converged image of the room, rendered once.
let room_reference;

async function roomReference(size) {
    room_reference ??= await trace("room", { spp: 1024, size, bounces: 4 });
    return room_reference;
}

test("denoising brings a few samples much closer to the converged image", async () => {

    const size = 96;
    const reference = await roomReference(size);

    for (const [spp, factor] of [[1, 0.5], [4, 0.7]]) {

        const noisy = await trace("room", { spp, size, bounces: 4, denoise: true });
        const before = rmse(noisy.pixels, reference.pixels);
        const after = rmse(noisy.denoised, reference.pixels);

        assert.ok(noisy.denoised.every(Number.isFinite), "no NaNs");
        assert.ok(after < before * factor, `${spp} spp: error ${before.toFixed(4)} noisy, ${after.toFixed(4)} denoised`);
    }
});

test("denoising keeps the checkerboard's edges", async () => {

    const size = 96;
    const reference = await roomReference(size);
    const noisy = await trace("room", { spp: 4, size, bounces: 4, denoise: true });

    // On the checkered floor, blurring the squares together would put the
    // denoised image further from the converged one than the noise was.
    const floor = interior(reference.hits, size, 0);
    const error = (pixels) => Math.sqrt(mean(floor.map((i) =>
        mean([0, 1, 2].map((c) => (pixels[i * 4 + c] - reference.pixels[i * 4 + c]) ** 2)))));

    assert.ok(floor.length > 1000);
    assert.ok(error(noisy.denoised) < error(noisy.pixels),
        `floor error ${error(noisy.pixels).toFixed(4)} noisy, ${error(noisy.denoised).toFixed(4)} denoised`);
});

test("as the samples build up, the denoised image becomes the average", async () => {

    const size = 32;
    const { pixels, denoised } = await trace("room", { spp: 512, size, bounces: 4, denoise: true });

    const difference = rmse(pixels, denoised);
    const brightness = Math.sqrt(pixels.reduce((s, v, i) => s + (i % 4 == 3 ? 0 : v * v), 0) / (pixels.length * 0.75));

    assert.ok(difference < 0.05 * brightness, `difference ${difference.toFixed(4)} against brightness ${brightness.toFixed(4)}`);
});

test("the Cornell box renders with colour bleeding and no NaNs", async () => {

    const { page, errors, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 16, null, { timeout: 120000 });

    const pixels = await page.evaluate(async () => Array.from(await window.raymond.renderer.readPixels()));
    const width = await page.evaluate(() => window.raymond.renderer.canvas.width);
    const height = pixels.length / 4 / width;

    assert.ok(pixels.every(Number.isFinite), "no NaNs or infinities");

    // Average a block of pixels at a fraction (fx, fy) across the image.
    const block = (fx, fy) => {
        const cx = Math.floor(fx * width), cy = Math.floor(fy * height);
        const sums = [0, 0, 0];
        for (let y = cy - 3; y <= cy + 3; ++y)
            for (let x = cx - 3; x <= cx + 3; ++x)
                for (let c = 0; c < 3; ++c)
                    sums[c] += pixels[(y * width + x) * 4 + c] / 49;
        return sums;
    };

    // At 480 x 320, the room spans about the middle two thirds.
    const left = block(0.21, 0.5);
    const right = block(0.79, 0.5);
    const ceiling = block(0.5, 0.03);

    assert.ok(left[0] > 2 * left[1], `left wall is red: ${left}`);
    assert.ok(right[1] > 2 * right[0], `right wall is green: ${right}`);
    assert.ok(mean(ceiling) > 0.02, "the ceiling is lit by the floor");

    assert.deepEqual(errors, []);
    await context.close();
});

// ---- The app ----

test("the app accumulates samples and reports them", async () => {

    const { page, errors, context } = await open("index.html");

    await page.waitForFunction(() => window.raymond?.renderer.samples >= 4, null, { timeout: 60000 });

    assert.equal(await page.isHidden("#error"), true);
    assert.match(await page.textContent("#stats"), /^\d+ \/ 4096 samples · 480×320/);
    assert.equal(await page.textContent("#scene-name"), "Cornell box");

    // The image is on screen, and isn't black.
    const shot = decodePng(await page.screenshot());
    const centre = shot.pixel(240, 200);
    assert.ok(centre[0] + centre[1] + centre[2] > 60, `centre pixel ${centre}`);

    assert.deepEqual(errors, []);
    await context.close();
});

test("pausing stops the samples, and a camera move still redraws", async () => {

    const { page, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 2, null, { timeout: 60000 });

    await page.click("#play");
    await page.waitForTimeout(500);
    const paused = await page.evaluate(() => window.raymond.renderer.samples);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.raymond.renderer.samples), paused, "no new samples");
    assert.match(await page.textContent("#stats"), /paused/);

    // Dragging moves the camera, which starts the image again with one frame.
    const before = await page.evaluate(() => window.raymond.camera.position.x);
    await page.mouse.move(240, 160);
    await page.mouse.down();
    await page.mouse.move(300, 160, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => window.raymond.renderer.samples == 1, null, { timeout: 30000 });
    assert.notEqual(await page.evaluate(() => window.raymond.camera.position.x), before);

    await context.close();
});

test("moving the camera shows a fast preview, then the full image once it stops", async () => {

    const { page, errors, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 2, null, { timeout: 60000 });

    const full = await page.evaluate(() => ({ width: document.getElementById("view").width, bounces: window.raymond.renderer.maxBounces }));
    const now = () => page.evaluate(() => ({
        width: document.getElementById("view").width,
        bounces: window.raymond.renderer.maxBounces,
        samplesPerFrame: window.raymond.renderer.samplesPerFrame,
        stats: document.getElementById("stats").textContent,
    }));

    // Mid-drag: smaller, fewer bounces, a sample a frame, and it says so,
    // straight away, before the frame being drawn (which on a slow machine
    // takes seconds) is done.
    await page.mouse.move(240, 160);
    await page.mouse.down();
    await page.mouse.move(260, 160, { steps: 4 });
    const during = await now();
    assert.ok(during.width < full.width, `preview width ${during.width} of ${full.width}`);
    assert.ok(during.bounces <= 3 && during.samplesPerFrame == 1);
    assert.match(during.stats, /preview/);

    // Held still, then let go: back to full quality.
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForFunction((w) => document.getElementById("view").width == w, full.width, { timeout: 30000 });
    const after = await now();
    assert.equal(after.bounces, full.bounces);
    assert.doesNotMatch(after.stats, /preview/);

    // With the preview turned off, moving keeps the full image.
    await page.click("#settings-button");
    await page.click("#fast-preview");
    await page.mouse.move(240, 160);
    await page.mouse.down();
    await page.mouse.move(270, 170, { steps: 4 });
    const off = await now();
    await page.mouse.up();
    assert.equal(off.width, full.width);
    assert.equal(off.bounces, full.bounces);
    assert.equal(await page.evaluate(() => window.raymond.settings.fast_preview), false);

    assert.deepEqual(errors, []);
    await context.close();
});

test("the settings panel changes the scene, view and resolution, and remembers them", async () => {

    const { page, errors, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 1, null, { timeout: 60000 });

    await page.click("#settings-button");
    await page.selectOption("#scene", "spheres");
    await page.waitForFunction(() => document.getElementById("scene-name").textContent == "Sphere field");

    await page.selectOption("#view-mode", "normal");
    await page.selectOption("#resolution", "0.5");
    await page.waitForFunction(() => window.raymond.renderer.view == "normal" && window.raymond.renderer.canvas.width == 240);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("raymond-settings")));
    assert.equal(stored.scene, "spheres");
    assert.equal(stored.view, "normal");
    assert.equal(stored.resolution, 0.5);

    // Reloading keeps them.
    await page.reload();
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 1, null, { timeout: 60000 });
    assert.equal(await page.textContent("#scene-name"), "Sphere field");
    assert.equal(await page.inputValue("#view-mode"), "normal");

    assert.deepEqual(errors, []);
    await context.close();
});

test("turning denoising off and on doesn't start the image again", async () => {

    const { page, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 3, null, { timeout: 60000 });

    await page.click("#settings-button");
    const before = await page.evaluate(() => window.raymond.renderer.samples);
    await page.uncheck("#denoise");
    await page.waitForFunction(() => window.raymond.renderer.denoise == false);
    await page.waitForTimeout(500);

    assert.ok(await page.evaluate(() => window.raymond.renderer.samples) >= before, "the samples carried on");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("raymond-settings")));
    assert.equal(stored.denoise, false);

    await context.close();
});

test("tapping the image focuses there", async () => {

    const { page, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 1, null, { timeout: 60000 });

    // The middle of the Cornell box's back wall, about 4.85 away along
    // the view direction (the camera is at z = 3.85, the wall at z = -1).
    await page.mouse.click(240, 110);
    await page.waitForSelector("#toast.show");

    const focus = await page.evaluate(() => window.raymond.camera.focusDistance);
    assert.ok(Math.abs(focus - 4.85) < 0.05, `focus ${focus}`);

    await context.close();
});

test("the save button downloads the image as a PNG", async () => {

    const { page, context } = await open("index.html");
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 1, null, { timeout: 60000 });

    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
    assert.match(download.suggestedFilename(), /^raymond-cornell-\d+spp\.png$/);

    const image = decodePng(await readFile(await download.path()));
    assert.equal(image.width, 480);
    const centre = image.pixel(240, 200);
    assert.ok(centre[0] + centre[1] + centre[2] > 60, `the saved image isn't black: ${centre}`);

    await context.close();
});

test("the example page renders with the library by its package name", async () => {

    const { page, errors, context } = await open("examples/basic.html", { viewport: { width: 640, height: 480 } });

    // The first frame at 640 × 480 on SwiftShader can take a while on a
    // slow machine (compiling the shaders, mostly), so look until it's
    // there.
    let sky = [0, 0, 0];
    for (const deadline = Date.now() + 90000; sky[2] <= 100 && Date.now() < deadline;) {
        await page.waitForTimeout(1000);
        sky = decodePng(await page.screenshot({ timeout: 60000 })).pixel(320, 20);
    }
    assert.ok(sky[2] > 100, `the sky is blue: ${sky}`);

    assert.deepEqual(errors, []);
    await context.close();
});

test("the service worker registers and takes control", async () => {

    const { page, errors, context } = await open("index.html", { serviceWorkers: true });

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    // The first frame waits for the shaders to compile, slow on SwiftShader.
    await page.waitForFunction(() => window.raymond?.renderer.samples >= 1, null, { timeout: 120000 });

    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);
    assert.deepEqual(errors, []);
    await context.close();
});

test("without WebGPU, the page explains instead of going blank", async () => {

    // The headless shell has no WebGPU adapter without the flags.
    const plain = await chromium.launch();
    const page = await plain.newPage();
    await page.goto(base_url + "index.html");

    await page.waitForSelector("#error:not([hidden])");
    assert.match(await page.textContent("#error h1"), /WebGPU/);

    await plain.close();
});

// Decodes an 8-bit RGB or RGBA PNG, as Chromium writes them, enough to
// read pixels from screenshots.
function decodePng(buffer) {

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const color_type = buffer[25];
    const channels = color_type == 6 ? 4 : 3;
    assert.equal(buffer[24], 8, "8 bits per channel");

    const chunks = [];
    for (let offset = 8; offset < buffer.length;) {
        const size = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        if (type == "IDAT")
            chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
    }

    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);

    for (let y = 0; y < height; ++y) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; ++x) {
            const value = raw[y * (stride + 1) + 1 + x];
            const a = x >= channels ? out[y * stride + x - channels] : 0;
            const b = y > 0 ? out[(y - 1) * stride + x] : 0;
            const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
            let predicted = 0;
            if (filter == 1) predicted = a;
            else if (filter == 2) predicted = b;
            else if (filter == 3) predicted = (a + b) >> 1;
            else if (filter == 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[y * stride + x] = (value + predicted) & 255;
        }
    }

    return {
        width,
        height,
        pixel: (x, y) => [...out.subarray(y * stride + x * channels, y * stride + x * channels + 3)],
    };
}
