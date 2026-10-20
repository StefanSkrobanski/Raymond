import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));

// A PNG's size and colour type, from its header.
function pngInfo(path) {
    const data = read(path);
    assert.equal(data.toString("latin1", 1, 4), "PNG", `${path} is a PNG`);
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
}

test("the manifest's icons exist at the sizes it says", () => {

    const manifest = JSON.parse(read("manifest.json"));

    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.icons.some((i) => i.purpose == "maskable"), "Android can mask one");

    for (const icon of manifest.icons) {
        const [width, height] = icon.sizes.split("x").map(Number);
        assert.deepEqual(
            (({ width, height }) => ({ width, height }))(pngInfo(icon.src)),
            { width, height }, icon.src);
    }
});

test("the page links the manifest and an Apple touch icon of 180 pixels", () => {

    const html = read("index.html").toString();

    for (const [rel, file] of [["manifest", "manifest.json"], ["apple-touch-icon", "icon-180.png"]]) {
        assert.match(html, new RegExp(`<link rel="${rel}" href="${file}">`));
        assert.ok(existsSync(new URL(file, root)), `${file} exists`);
    }

    const { width, height } = pngInfo("icon-180.png");
    assert.deepEqual([width, height], [180, 180]);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /viewport-fit=cover/, "so the safe-area insets apply");
});
