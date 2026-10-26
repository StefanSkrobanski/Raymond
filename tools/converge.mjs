// Measures how quickly Raymond's images converge, in headless Chromium on
// SwiftShader:
//
//     node tools/converge.mjs [--reference=4096] [--samples=4,16,64] [scene ids...]
//
// For each scene it renders a reference at many samples per pixel (saved
// in tools/.references/, so later runs reuse it: delete them after a change
// that alters the converged image), then images at fewer, and prints each
// one's error against the reference (relative mean squared error, so dim
// and bright pixels count alike) and the error × seconds, whose inverse is
// the efficiency: lower is better, and a change that halves it reaches
// the same quality in half the time.

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REFERENCES = join(ROOT, "tools", ".references");
const options = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SCENES = ids.length > 0 ? ids :
    ["cornell", "materials", "studio", "wavy-mirror", "neon", "candles", "city-night", "sunbeams", "alpine", "still-life"];
const REFERENCE_SAMPLES = Number(options.reference ?? 4096);
const SAMPLES = (options.samples ?? "4,16,64").split(",").map(Number);
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript" };

const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
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

// The same flags as the browser tests: see CLAUDE.md.
const browser = await chromium.launch({
    channel: "chromium",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-angle=swiftshader"],
});

/** @param {Float32Array} a @param {Float32Array} reference */
function relativeError(a, reference) {
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
        for (let c = 0; c < 3; ++c) {
            const r = reference[i + c];
            sum += (a[i + c] - r) ** 2 / (r * r + 1e-2);
        }
        n += 3;
    }
    return sum / n;
}

try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(e.message));
    page.on("console", (m) => m.type() == "error" && console.error(m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/converge.html`);
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
    await mkdir(REFERENCES, { recursive: true });

    console.log("scene            spp     seconds    rel. MSE   MSE × s");
    for (const id of SCENES) {
        const file = join(REFERENCES, `${id}-${REFERENCE_SAMPLES}.f32`);
        let reference;
        try {
            reference = new Float32Array((await readFile(file)).buffer.slice(0));
        }
        catch {
            const r = await page.evaluate(([id, n]) => window.render(id, n), [id, REFERENCE_SAMPLES]);
            reference = new Float32Array(r.pixels);
            await writeFile(file, Buffer.from(reference.buffer));
            console.log(`${id.padEnd(16)} reference: ${r.samples} spp in ${r.seconds.toFixed(0)} s`);
        }
        for (const n of SAMPLES) {
            const r = await page.evaluate(([id, n]) => window.render(id, n), [id, n]);
            const error = relativeError(new Float32Array(r.pixels), reference);
            console.log(`${id.padEnd(16)} ${String(r.samples).padStart(4)} ${r.seconds.toFixed(2).padStart(10)} ${error.toFixed(5).padStart(11)} ${(error * r.seconds).toFixed(5).padStart(9)}`);
        }
    }
}
finally {
    await browser.close();
    server.close();
}
