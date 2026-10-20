import { SCENES } from "./Scenes.mjs";

// The settings panel's values, with their defaults, remembered between
// visits in localStorage. Storage can be missing or blocked (private
// browsing, some embedded views), so every access is guarded and the app
// works with the defaults when it fails.

const STORAGE_KEY = "raymond-settings";

export const DEFAULT_SETTINGS = {
    scene: SCENES[0].id,             // an id from SCENES
    view: "color",                   // a key of VIEWS
    bounces: 8,                      // most bounces per path, 1 to 32
    samples_per_frame: 1,            // 1 to 16
    resolution: 1.0,                 // a key of RESOLUTIONS: canvas pixels per CSS pixel
    exposure: 0.0,                   // in stops, -4 to 4
    sample_limit: 4096,              // a key of SAMPLE_LIMITS: stop when reached
    tame_fireflies: true,            // clamp each path's brightness
    theme: "auto",                   // a key of THEMES
};

export const VIEWS = { color: "Path traced", albedo: "Albedo", normal: "Normals", depth: "Depth" };

// 0 means the device's pixel ratio (sharpest, and slowest).
export const RESOLUTIONS = { 0.25: "Quarter", 0.5: "Half", 0.75: "Three quarters", 1: "Full", 0: "Retina (device pixels)" };

// 0 means no limit.
export const SAMPLE_LIMITS = { 256: "256", 1024: "1024", 4096: "4096", 16384: "16384", 0: "No limit" };

// "auto" follows the device's light or dark setting.
export const THEMES = { auto: "Auto", light: "Light", dark: "Dark" };

export const BOUNCES_RANGE = { min: 1, max: 32 };
export const SAMPLES_PER_FRAME_RANGE = { min: 1, max: 16 };
export const EXPOSURE_RANGE = { min: -4.0, max: 4.0 };

// Returns a valid settings object built from anything (stored JSON from an
// older version, hand edits), falling back to defaults field by field.
/** @param {any} value */
export function sanitizeSettings(value) {

    const v = (typeof value === "object" && value !== null) ? value : {};
    const d = DEFAULT_SETTINGS;
    /** @type {(x: any, min: number, max: number, fallback: number) => number} */
    const number = (x, min, max, fallback) =>
        (typeof x === "number" && Number.isFinite(x)) ? Math.min(Math.max(x, min), max) : fallback;

    return {
        scene: SCENES.some((s) => s.id === v.scene) ? v.scene : d.scene,
        view: Object.hasOwn(VIEWS, v.view) ? v.view : d.view,
        bounces: Math.round(number(v.bounces, BOUNCES_RANGE.min, BOUNCES_RANGE.max, d.bounces)),
        samples_per_frame: Math.round(number(v.samples_per_frame, SAMPLES_PER_FRAME_RANGE.min, SAMPLES_PER_FRAME_RANGE.max, d.samples_per_frame)),
        resolution: typeof v.resolution === "number" && Object.hasOwn(RESOLUTIONS, String(v.resolution)) ? v.resolution : d.resolution,
        exposure: number(v.exposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max, d.exposure),
        sample_limit: typeof v.sample_limit === "number" && Object.hasOwn(SAMPLE_LIMITS, String(v.sample_limit)) ? v.sample_limit : d.sample_limit,
        tame_fireflies: typeof v.tame_fireflies === "boolean" ? v.tame_fireflies : d.tame_fireflies,
        theme: Object.hasOwn(THEMES, v.theme) ? v.theme : d.theme,
    };
}

export function loadSettings() {

    try {
        const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
        return sanitizeSettings(stored ? JSON.parse(stored) : {});
    }
    catch {
        return sanitizeSettings({});
    }
}

/** @param {ReturnType<typeof sanitizeSettings>} settings */
export function saveSettings(settings) {

    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    catch {
        // Not remembered this time; the app still works.
    }
}
