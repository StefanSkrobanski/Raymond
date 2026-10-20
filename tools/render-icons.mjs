// Renders the app icons with Raymond itself, in headless Chromium:
//
//     node tools/render-icons.mjs [samples]     (256 by default, denoised)
//
// It serves the repository, opens tools/icon.html and saves icon-512.png,
// icon-192.png and icon-180.png (the Apple touch icon) at the root.

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SIZES = process.env.SIZES ? process.env.SIZES.split(",").map(Number) : [512, 192, 180];
const samples = Number(process.argv[2] ?? 256);

const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    try {
        const body = await readFile(join(ROOT, path));
        response.writeHead(200, { "Content-Type": extname(path) == ".html" ? "text/html" : "text/javascript" });
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
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/icon.html`);
    await page.waitForFunction(() => window.ready);

    for (const size of SIZES) {
        const url = await page.evaluate(([s, n]) => window.renderIcon(s, n), [size, samples]);
        await writeFile(join(ROOT, `icon-${size}.png`), Buffer.from(url.split(",")[1], "base64"));
        console.log(`icon-${size}.png`);
    }
}
finally {
    await browser.close();
    server.close();
}
