import { Camera, OrbitControls, Renderer } from "./src/index.mjs";
import { SCENES } from "./Scenes.mjs";
/** @import { Vec3 } from "./src/index.mjs" */
import {
    BOUNCES_RANGE, DEFAULT_SETTINGS, EXPOSURE_RANGE, RESOLUTIONS, SAMPLES_PER_FRAME_RANGE, SAMPLE_LIMITS, THEMES, VIEWS,
    loadSettings, saveSettings,
} from "./Settings.mjs";

// The demo app: a full-window path-traced view of one of the scenes, with
// orbit controls and a settings panel.

/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);

const canvas = /** @type {HTMLCanvasElement} */ ($("view"));
const settings = loadSettings();

// The aperture slider's 0 to 1 sets the lens radius as a fraction of the
// focus distance, so it blurs about as much in a small room as on a
// mountain.
const APERTURE_SCALE = 0.04;

// Tapping a surface orbits round it and moves this fraction of the way
// from it to the camera, so a few taps cross a room.
const TAP_APPROACH = 0.5;

// Walking speed, in starting view distances a second, so it suits a room
// or a landscape.
const WALK_SPEED = 0.3;

// The fast preview while the camera moves: how long a frame should take,
// the most bounces, the range of its resolution (a fraction of the full
// one, each way), and how long after the last move to go back to full
// quality.
const PREVIEW_FRAME_MS = 33;
const PREVIEW_BOUNCES = 3;
const PREVIEW_SCALES = { min: 0.15, max: 1.0 };
const SETTLE_MS = 250;

let renderer;
try {
    renderer = await Renderer.create(canvas);
}
catch (error) {
    // @ts-ignore: defined by the classic script in index.html
    showError("WebGPU isn't working here", /** @type {Error} */ (error).message);
    throw error;
}

renderer.device.lost.then((info) => {
    if (info.reason != "destroyed") {
        // @ts-ignore: defined by the classic script in index.html
        showError("The graphics device was lost", info.message);
    }
});

const camera = new Camera();
const controls = new OrbitControls(camera, canvas);
renderer.camera = camera;

// With "Stop at walls", dragging, pinching, the wheel and walking stop the
// camera at surfaces (going home, or flying to a tapped point, don't).
/** @type {(origin: Vec3, direction: Vec3, distance: number) => number} */
const collide = (origin, direction, distance) =>
    renderer.scene?.raycast(origin, direction, distance)?.distance ?? Infinity;

let playing = true;
let demo = SCENES[0];
let frame_requested = false;
let dirty = true;
let in_flight = false;
let frame_ms = 0.0;
let aperture = 0.0;
// The scene's field of view, kept across the narrower side of the window.
let scene_fov = camera.fov;
// Whether the camera is moving, so the preview is showing, and the
// preview's resolution, which adapts to the device and is kept between
// moves.
let moving = false;
let walk_speed = 1.0;
let preview_scale = 0.5;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let settle_timer;
// Set while a scene places the camera, which isn't moving it.
let placing = false;

// ---- Drawing ----

function requestFrame() {
    if (!frame_requested) {
        frame_requested = true;
        requestAnimationFrame(frame);
    }
}

// Something on screen has changed: draw it even if paused or done.
function invalidate() {
    dirty = true;
    requestFrame();
}

function limitReached() {
    return settings.sample_limit > 0 && renderer.samples >= settings.sample_limit;
}

// Renders one frame, waiting for the GPU to finish the last before
// sending another, so a slow GPU never builds up a queue of work and the
// controls stay responsive.
async function frame() {

    frame_requested = false;
    if (in_flight)
        return;

    // Paused, or done: only render when something has changed.
    if (!dirty && (!playing || limitReached())) {
        updateStats();
        return;
    }

    dirty = false;
    in_flight = true;
    const start = performance.now();

    renderer.render();
    await renderer.device.queue.onSubmittedWorkDone();

    const ms = performance.now() - start;
    frame_ms = 0.8 * frame_ms + 0.2 * ms;
    in_flight = false;

    if (moving)
        adaptPreview(ms);

    updateStats();

    if (dirty || (playing && !limitReached()))
        requestFrame();
}

function updateStats() {

    const view = settings.view == "color" ? "" : ` · ${VIEWS[settings.view]}`;
    const limit = settings.sample_limit > 0 ? ` / ${settings.sample_limit}` : "";

    $("stats").textContent =
        `${renderer.samples}${limit} samples · ${canvas.width}×${canvas.height} · ${frame_ms.toFixed(0)} ms${view}` +
        (moving ? " · preview" : "") + (playing ? "" : " · paused");

    const fraction = settings.sample_limit > 0 ? Math.min(renderer.samples / settings.sample_limit, 1.0) : 0.0;
    $("progress").firstElementChild.style.width = `${(fraction * 100).toFixed(1)}%`;
}

// ---- Sizing ----

function resize() {

    const full = settings.resolution > 0 ? settings.resolution : (window.devicePixelRatio || 1);
    const ratio = moving ? full * preview_scale : full;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
    }

    // Keep the scene's field of view across the narrower side, so a
    // portrait phone sees as much of the scene's width as a laptop.
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    camera.fov = aspect >= 1.0 ? scene_fov : 2.0 * Math.atan(Math.tan(scene_fov / 2.0) / aspect);

    invalidate();
}

new ResizeObserver(resize).observe(canvas);

// ---- The fast preview ----

// The camera has moved: show the preview until it's been still a moment.
function moved() {

    if (!settings.fast_preview || placing)
        return;

    clearTimeout(settle_timer);
    settle_timer = setTimeout(() => {
        moving = false;
        applyQuality();
    }, SETTLE_MS);

    if (!moving) {
        moving = true;
        applyQuality();
    }
}

// Nudges the preview's resolution towards drawing a frame in
// PREVIEW_FRAME_MS: the time goes with the number of pixels, so with the
// square of the scale. Small changes are left, since each new size means
// new buffers.
/** @param {number} ms how long the last preview frame took */
function adaptPreview(ms) {

    const wanted = preview_scale * Math.min(Math.max(Math.sqrt(PREVIEW_FRAME_MS / Math.max(ms, 1)), 0.7), 1.3);
    const scale = Math.min(Math.max(wanted, PREVIEW_SCALES.min), PREVIEW_SCALES.max);

    if (Math.abs(scale / preview_scale - 1.0) > 0.1) {
        preview_scale = scale;
        resize();
    }
}

// The renderer's settings that the preview cheapens: fewer bounces, one
// sample a frame, always denoised.
function applyQuality() {
    renderer.maxBounces = moving ? Math.min(settings.bounces, PREVIEW_BOUNCES) : settings.bounces;
    renderer.samplesPerFrame = moving ? 1 : settings.samples_per_frame;
    renderer.denoise = moving || settings.denoise;
    resize();
    updateStats();
}

// ---- Scenes and settings ----

/** @param {{ changed?: boolean }} [options] changed: picked in the panel, rather than restored */
function loadScene({ changed = false } = {}) {

    demo = SCENES.find((s) => s.id == settings.scene) ?? SCENES[0];
    const built = demo.build();
    const options = built.camera;

    renderer.scene = built.scene;
    scene_fov = options.fov ?? scene_fov;
    camera.focusDistance = options.focusDistance ?? 0.0;

    const target = options.target ?? camera.target;
    const position = options.position ?? camera.position;
    placing = true;
    controls.setHome(OrbitControls.viewFrom(position, target), { animate: false });
    placing = false;

    const focus = camera.effectiveFocusDistance;
    aperture = Math.min((options.aperture ?? 0.0) / (focus * APERTURE_SCALE), 1.0);
    $("aperture").value = aperture;

    // A newly picked scene starts with the bounces it suggests.
    if (changed)
        settings.bounces = built.bounces ?? DEFAULT_SETTINGS.bounces;

    $("scene-name").textContent = demo.name;
    walk_speed = WALK_SPEED * controls.view.radius;
    applySettings();
}

function applySettings() {

    renderer.view = /** @type {import("./src/Renderer.mjs").View} */ (settings.view);
    renderer.exposure = 2.0 ** settings.exposure;
    renderer.fireflyClamp = settings.tame_fireflies ? 10.0 : 0.0;
    camera.aperture = aperture * APERTURE_SCALE * camera.effectiveFocusDistance;

    $("bounces").value = settings.bounces;
    $("bounces-value").textContent = String(settings.bounces);
    $("samples-per-frame").value = settings.samples_per_frame;
    $("samples-per-frame-value").textContent = String(settings.samples_per_frame);
    $("exposure").value = settings.exposure;
    $("exposure-value").textContent = `${settings.exposure > 0 ? "+" : ""}${settings.exposure.toFixed(2)} EV`;
    $("aperture-value").textContent = aperture > 0 ? aperture.toFixed(2) : "Pinhole";
    $("tame-fireflies").checked = settings.tame_fireflies;
    $("denoise").checked = settings.denoise;
    $("fast-preview").checked = settings.fast_preview;
    $("movement-pad").checked = settings.movement_pad;
    $("stop-at-walls").checked = settings.stop_at_walls;
    $("pad").hidden = !settings.movement_pad;
    controls.collide = settings.stop_at_walls ? collide : null;

    saveSettings(settings);
    applyTheme();
    applyQuality();
}

/**
 * Fills a select from { value: label } and keeps a setting in step with it.
 * @param {string} id
 * @param {Record<string, string>} options
 * @param {keyof typeof settings} key
 * @param {(value: string) => any} parse
 * @param {() => void} [after]
 */
function bindSelect(id, options, key, parse, after = applySettings) {

    const select = $(id);
    for (const [value, label] of Object.entries(options))
        select.add(new Option(label, value));

    select.value = String(settings[key]);
    select.addEventListener("change", () => {
        // @ts-ignore: each key gets a value of its own type from parse
        settings[key] = parse(select.value);
        after();
    });
}

/**
 * @param {string} id
 * @param {{ min: number, max: number }} range
 * @param {(value: number) => void} set
 */
function bindSlider(id, range, set) {

    const slider = $(id);
    slider.min = range.min;
    slider.max = range.max;
    slider.addEventListener("input", () => {
        set(Number(slider.value));
        applySettings();
    });
}

// The scene picker, in groups by category; bindSelect adds no options of
// its own, just keeps the setting in step.
for (const category of new Set(SCENES.map((s) => s.category))) {
    const group = document.createElement("optgroup");
    group.label = category;
    for (const s of SCENES.filter((s) => s.category == category))
        group.append(new Option(s.name, s.id));
    $("scene").append(group);
}

bindSelect("scene", {}, "scene", String, () => loadScene({ changed: true }));
bindSelect("view-mode", VIEWS, "view", String);
bindSelect("resolution", RESOLUTIONS, "resolution", Number);
bindSelect("sample-limit", SAMPLE_LIMITS, "sample_limit", Number);
bindSelect("theme", THEMES, "theme", String);

bindSlider("bounces", BOUNCES_RANGE, (v) => settings.bounces = v);
bindSlider("samples-per-frame", SAMPLES_PER_FRAME_RANGE, (v) => settings.samples_per_frame = v);
bindSlider("exposure", EXPOSURE_RANGE, (v) => settings.exposure = v);
bindSlider("aperture", { min: 0, max: 1 }, (v) => aperture = v);

$("tame-fireflies").addEventListener("change", () => {
    settings.tame_fireflies = $("tame-fireflies").checked;
    applySettings();
});

$("denoise").addEventListener("change", () => {
    settings.denoise = $("denoise").checked;
    applySettings();
});

$("movement-pad").addEventListener("change", () => {
    settings.movement_pad = $("movement-pad").checked;
    applySettings();
});

$("stop-at-walls").addEventListener("change", () => {
    settings.stop_at_walls = $("stop-at-walls").checked;
    applySettings();
});

$("fast-preview").addEventListener("change", () => {
    settings.fast_preview = $("fast-preview").checked;
    if (!settings.fast_preview) {
        clearTimeout(settle_timer);
        moving = false;
    }
    applySettings();
});

// ---- Walking ----

// What's held down (a pointer on the pad, or a key) and which way it moves.
/** @type {Map<string, string>} */
const held = new Map();
let walk_frame = 0;
let walk_time = 0.0;

// Forward, right and up for each way.
/** @type {Record<string, [number, number, number]>} */
const WAYS = {
    forward: [1, 0, 0], back: [-1, 0, 0], left: [0, -1, 0], right: [0, 1, 0], up: [0, 0, 1], down: [0, 0, -1],
};

const KEYS = /** @type {Record<string, string>} */ ({
    w: "forward", arrowup: "forward", s: "back", arrowdown: "back",
    a: "left", arrowleft: "left", d: "right", arrowright: "right",
    e: "up", pageup: "up", q: "down", pagedown: "down",
});

/** @param {number} time */
function walk(time) {

    walk_frame = 0;
    if (held.size == 0)
        return;

    const dt = walk_time > 0.0 ? Math.min(time - walk_time, 100.0) / 1000.0 : 0.0;
    walk_time = time;

    let [forward, right, up] = [0, 0, 0];
    for (const way of new Set(held.values())) {
        forward += WAYS[way][0];
        right += WAYS[way][1];
        up += WAYS[way][2];
    }
    const step = walk_speed * dt;
    if (step > 0.0 && (forward || right || up))
        controls.move(forward * step, right * step, up * step);

    walk_frame = requestAnimationFrame(walk);
}

/**
 * @param {string} source
 * @param {string} way
 */
function startWalking(source, way) {
    held.set(source, way);
    if (walk_frame == 0) {
        walk_time = 0.0;
        walk_frame = requestAnimationFrame(walk);
    }
}

/** @param {string} source */
function stopWalking(source) {
    held.delete(source);
}

for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("#pad button"))) {
    const way = /** @type {string} */ (button.dataset.move);
    button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        button.classList.add("held");
        startWalking(`pointer ${e.pointerId}`, way);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        button.addEventListener(type, (e) => {
            button.classList.remove("held");
            stopWalking(`pointer ${/** @type {PointerEvent} */ (e).pointerId}`);
        });
    }
    // A long press shouldn't open a menu.
    button.addEventListener("contextmenu", (e) => e.preventDefault());
}

addEventListener("keydown", (e) => {
    const way = KEYS[e.key.toLowerCase()];
    const target = /** @type {HTMLElement} */ (e.target);
    if (!way || e.ctrlKey || e.metaKey || e.altKey || target.closest("input, select, textarea"))
        return;
    e.preventDefault();
    startWalking(`key ${e.key.toLowerCase()}`, way);
});

addEventListener("keyup", (e) => stopWalking(`key ${e.key.toLowerCase()}`));
addEventListener("blur", () => held.clear());

// ---- Theme ----

const dark_query = matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
    const dark = settings.theme == "dark" || (settings.theme == "auto" && dark_query.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
}

dark_query.addEventListener("change", applyTheme);

// ---- Controls ----

controls.addEventListener("change", () => {
    moved();
    invalidate();
});

// Tapping the image makes what's there the point the camera orbits round,
// and moves halfway towards it. The lens focuses there too.
controls.addEventListener("tap", (e) => {

    const { x, y } = /** @type {CustomEvent<{ x: number, y: number }>} */ (e).detail;
    const scene = renderer.scene;
    if (!scene)
        return;

    const ray = camera.ray(
        2.0 * x / canvas.clientWidth - 1.0,
        1.0 - 2.0 * y / canvas.clientHeight,
        canvas.clientWidth / canvas.clientHeight);

    const hit = scene.raycast(ray.origin, ray.direction);
    if (!hit)
        return;

    const view = OrbitControls.viewFrom(camera.position, hit.point);
    controls.animateTo({ ...view, radius: view.radius * TAP_APPROACH }, { duration: 600 });

    // Looking straight at the point, the focus distance is the radius.
    camera.focusDistance = view.radius * TAP_APPROACH;
    applySettings();

    toast("Orbiting round the point you tapped: double-tap to go back");
});

$("play").addEventListener("click", () => {

    playing = !playing;

    const label = playing ? "Pause" : "Play";
    $("play").setAttribute("aria-label", label);
    $("play").title = label;
    $("play").innerHTML = playing ?
        '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="4" height="14" /><rect x="12" y="3" width="4" height="14" /></svg>' :
        '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z" /></svg>';

    updateStats();
    requestFrame();
});

$("home").addEventListener("click", () => controls.reset());

// Saves the image as shown. A WebGPU canvas only holds its image until the
// frame is presented, so render and read it in the same task.
$("save").addEventListener("click", () => {

    renderer.render();
    canvas.toBlob((blob) => {
        if (!blob)
            return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `raymond-${demo.id}-${renderer.samples}spp.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
});

const panel = $("settings");

/** @param {boolean} open */
function openSettings(open) {
    panel.classList.toggle("open", open);
    $("settings-button").setAttribute("aria-expanded", String(open));
}

$("settings-button").addEventListener("click", () => openSettings(!panel.classList.contains("open")));
$("settings-close").addEventListener("click", () => openSettings(false));

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toast_timer;

/** @param {string} message */
function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast_timer);
    toast_timer = setTimeout(() => element.classList.remove("show"), 2500);
}

// For the browser tests.
Object.assign(window, { raymond: { renderer, camera, controls, settings } });

loadScene();
