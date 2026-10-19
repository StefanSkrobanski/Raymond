import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as raymond from "../../src/index.mjs";

// The library's modules that aren't part of the public API.
const INTERNAL = ["index", "Mat2", "Mat3", "shaders"];

const src = new URL("../../src/", import.meta.url);

test("the entry point exports every public class in src/", async () => {

    for (const file of readdirSync(src)) {

        const name = file.replace(/\.mjs$/, "");
        if (INTERNAL.includes(name))
            continue;

        const module = await import(new URL(file, src).href);
        assert.equal(raymond[name], module[name], `${name} is exported`);
    }
});

test("package.json points at the entry point", () => {

    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

    assert.equal(pkg.exports["."].default, "./src/index.mjs");
    assert.equal(pkg.exports["."].types, "./types/index.d.mts");
    assert.deepEqual(pkg.files, ["src", "types"]);
    assert.equal(pkg.dependencies, undefined, "no runtime dependencies");
});
