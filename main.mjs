import { Camera, OrbitControls, Renderer } from "./src/index.mjs";
import { SCENES } from "./Scenes.mjs";
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

let playing = true;
let demo = SCENES[0];
let frame_requested = false;
let dirty = true;
let in_flight = false;
let frame_ms = 0.0;
let aperture = 0.0;
// The scene's field of view, kept across the narrower side of the window.
let scene_fov = camera.fov;

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

    frame_ms = 0.8 * frame_ms + 0.2 * (performance.now() - start);
    in_flight = false;

    updateStats();

    if (dirty || (playing && !limitReached()))
        requestFrame();
}

function updateStats() {

    const view = settings.view == "color" ? "" : ` · ${VIEWS[settings.view]}`;
    const limit = settings.sample_limit > 0 ? ` / ${settings.sample_limit}` : "";

    $("stats").textContent =
        `${renderer.samples}${limit} samples · ${canvas.width}×${canvas.height} · ${frame_ms.toFixed(0)} ms${view}` +
        (playing ? "" : " · paused");

    const fraction = settings.sample_limit > 0 ? Math.min(renderer.samples / settings.sample_limit, 1.0) : 0.0;
    $("progress").firstElementChild.style.width = `${(fraction * 100).toFixed(1)}%`;
}

// ---- Sizing ----

function resize() {

    const ratio = settings.resolution > 0 ? settings.resolution : (window.devicePixelRatio || 1);
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
    controls.setHome(OrbitControls.viewFrom(position, target), { animate: false });

    const focus = camera.effectiveFocusDistance;
    aperture = Math.min((options.aperture ?? 0.0) / (focus * APERTURE_SCALE), 1.0);
    $("aperture").value = aperture;

    // A newly picked scene starts with the bounces it suggests.
    if (changed)
        settings.bounces = built.bounces ?? DEFAULT_SETTINGS.bounces;

    $("scene-name").textContent = demo.name;
    applySettings();
}

function applySettings() {

    renderer.view = /** @type {import("./src/Renderer.mjs").View} */ (settings.view);
    renderer.maxBounces = settings.bounces;
    renderer.samplesPerFrame = settings.samples_per_frame;
    renderer.exposure = 2.0 ** settings.exposure;
    renderer.fireflyClamp = settings.tame_fireflies ? 10.0 : 0.0;
    renderer.denoise = settings.denoise;
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

    saveSettings(settings);
    applyTheme();
    resize();
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

// ---- Theme ----

const dark_query = matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
    const dark = settings.theme == "dark" || (settings.theme == "auto" && dark_query.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
}

dark_query.addEventListener("change", applyTheme);

// ---- Controls ----

controls.addEventListener("change", invalidate);

// Tapping the image focuses the lens on whatever is there.
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

    // The focus distance is measured along the view direction, to a plane.
    camera.focusDistance = hit.distance * ray.direction.dot(camera.basis().forward);
    applySettings();

    toast(aperture > 0 ?
        `Focused at ${camera.focusDistance.toFixed(2)}` :
        `Focus set at ${camera.focusDistance.toFixed(2)}: raise the aperture to blur the rest`);
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
