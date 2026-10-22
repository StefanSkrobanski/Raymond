// Measures how fast Raymond renders, in headless Chromium on SwiftShader:
//
//     node tools/bench.mjs [scene ids...]     (a spread of scenes by default)
//
// For each scene it prints the primitives, the time to build and to pack
// it (the BVH, mostly), and millions of paths per second. SwiftShader runs
// on the CPU, so compare runs on the same machine, and its speed-ups are a
// guide to a real GPU's rather than the same.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCENES = process.argv.slice(2).length > 0 ? process.argv.slice(2) :
    ["cornell", "sphereflake", "menger", "forest", "city", "gems", "mirror-ball", "pool", "sunbeams"];
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

try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/bench.html`);
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 });

    console.log("scene            primitives   build ms   pack ms   Mpaths/s");
    for (const id of SCENES) {
        const r = await page.evaluate((id) => window.bench(id), id);
        console.log(`${r.id.padEnd(16)} ${String(r.primitives).padStart(10)} ${r.build_ms.toFixed(0).padStart(10)} ${r.pack_ms.toFixed(0).padStart(9)} ${r.mpaths.toFixed(3).padStart(10)}`);
    }
}
finally {
    await browser.close();
    server.close();
}
