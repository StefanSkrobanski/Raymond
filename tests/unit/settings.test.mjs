import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from "../../Settings.mjs";

test("sanitizeSettings falls back to the defaults field by field", () => {

    assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(sanitizeSettings("junk"), DEFAULT_SETTINGS);

    const s = sanitizeSettings({
        scene: "nowhere",
        view: "normal",
        bounces: 1000,
        samples_per_frame: 2.6,
        resolution: 0.33,
        exposure: -9,
        sample_limit: 0,
        tame_fireflies: "yes",
        denoise: false,
        theme: "dark",
    });

    assert.equal(s.scene, DEFAULT_SETTINGS.scene);
    assert.equal(s.view, "normal");
    assert.equal(s.bounces, 32);
    assert.equal(s.samples_per_frame, 3);
    assert.equal(s.resolution, DEFAULT_SETTINGS.resolution);
    assert.equal(s.exposure, -4);
    assert.equal(s.sample_limit, 0);
    assert.equal(s.tame_fireflies, DEFAULT_SETTINGS.tame_fireflies);
    assert.equal(s.denoise, false);
    assert.equal(s.theme, "dark");
});

test("inherited object properties aren't taken for options", () => {
    assert.equal(sanitizeSettings({ view: "toString", theme: "constructor" }).view, DEFAULT_SETTINGS.view);
});

test("settings survive a round trip through storage, and blocked storage", () => {

    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, v),
    };

    try {
        saveSettings({ ...DEFAULT_SETTINGS, bounces: 5, theme: "light" });
        const loaded = loadSettings();
        assert.equal(loaded.bounces, 5);
        assert.equal(loaded.theme, "light");

        globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
        saveSettings(DEFAULT_SETTINGS);
    }
    finally {
        delete globalThis.localStorage;
    }
});
