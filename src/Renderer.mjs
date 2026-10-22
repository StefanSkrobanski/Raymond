import { Box } from "./Box.mjs";
import { Mesh } from "./Mesh.mjs";
import { Quad } from "./Quad.mjs";
import { PRIMITIVE_KINDS } from "./Scene.mjs";
import { DENOISE_SHADER, DISPLAY_SHADER, TRACE_SHADER } from "./shaders.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Camera } from "./Camera.mjs" */
/** @import { Scene } from "./Scene.mjs" */

/**
 * What the renderer shows: the path-traced image, or for inspecting a
 * scene, the colour, normal (as RGB) or distance of the first surface each
 * pixel sees.
 * @typedef {"color" | "albedo" | "normal" | "depth"} View
 */

const VIEWS = Object.freeze({ color: 0, albedo: 1, normal: 2, depth: 3 });

// The WebGPU flag values, spelled out because TypeScript's DOM library
// doesn't declare the GPUBufferUsage and GPUMapMode globals. They're fixed
// by the specification.
const BUFFER_MAP_READ = 0x0001;
const BUFFER_COPY_SRC = 0x0004;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_UNIFORM = 0x0040;
const BUFFER_STORAGE = 0x0080;
const MAP_READ = 0x0001;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;

// Textures are packed into one array texture, all resized to the largest
// one's size, up to this.
const MAX_TEXTURE_SIZE = 2048;

const PARAMS_BYTES = 208;
// Photon mapping's hash table of grid cells and the most photons it stores
// a frame: see shaders.mjs.
const PHOTON_TABLE = 1048576;
const PHOTON_CAPACITY = 524288;
// Light tracing aims at the spheres round at most this many groups of
// mirrors and glass.
const MAX_TARGETS = 16;
// The denoiser's à-trous passes, each spreading twice as far as the last.
const ATROUS_STEPS = [1, 2, 4, 8, 16];
const STORAGE_READ = /** @type {GPUBufferBindingType} */ ("read-only-storage");
const COMPUTE_STAGE = 0x4;
// The part of the uniforms that decides the image: see shaders.mjs.
const IMAGE_KEY_BYTES = 168;

/**
 * The path tracer's pipelines: the trace, and light tracing's passes.
 * @typedef {{ trace: GPUComputePipeline, light: GPUComputePipeline, resolve: GPUComputePipeline, gather: GPUComputePipeline }} TracePipelines
 */

/**
 * Which of the trace shader's optional features a scene uses: its
 * override constants.
 * @typedef {{ VOLUMES: boolean, TEXTURES: boolean, ENVIRONMENT: boolean, DISPERSION: boolean }} Features
 */

/**
 * A scene's mirrors and glass, for light tracing: the sphere round them
 * all, the spheres round up to MAX_TARGETS groups of them for photons to
 * aim at, and how far out from those to start the sun's light so it
 * passes everything that might shade them.
 * @typedef {{ centre: Vec3, radius: number, reach: number, targets: { centre: Vec3, radius: number }[] }} DeltaObjects
 */

/** @type {Features} */
const ALL_FEATURES = Object.freeze({ VOLUMES: true, TEXTURES: true, ENVIRONMENT: true, DISPERSION: true });

/**
 * A progressive path tracer on WebGPU. Each render() adds samplesPerFrame
 * more paths through every pixel to a running average, so the image starts
 * noisy and clears up. Anything that changes the image (the scene's
 * objects, sky, the camera, the canvas size, maxBounces, the view and so
 * on) is noticed on the next render(), which starts the average again.
 * Exposure and denoising only change how the average is shown, so they
 * don't.
 *
 * The image is canvas.width × canvas.height pixels; the canvas's CSS size
 * can differ, to render at a lower resolution and scale up.
 */
export class Renderer {

    #device;
    #context;
    #canvas;
    #format;

    #trace_module;
    // The trace pipelines for each combination of features (keyed by
    // featureKey()), made in the background when a scene first needs
    // them, and null until they're ready; until then the ones with every
    // feature do. Leaving out code a scene doesn't use makes the rest
    // faster.
    /** @type {Map<string, TracePipelines | null>} */
    #trace_pipelines = new Map();
    /** @type {TracePipelines} */
    #all_pipelines;
    #display_pipeline;
    #denoise_pipelines;
    #params_buffer;
    // One small uniform buffer per denoising pass, holding its step.
    #pass_buffers;

    /** @type {Scene | null} */
    #scene = null;
    /** @type {Camera | null} */
    #camera = null;

    #max_bounces = 8;
    #samples_per_frame = 1;
    #exposure = 1.0;
    #firefly_clamp = 20.0;
    /** @type {View} */
    #view = "color";
    #denoise = true;
    #caustics = true;
    // Whether light tracing ran last frame, and the lights it starts from.
    #caustics_active = false;
    /** @type {GPUBuffer | null} */
    #emitters = null;
    // From the uploaded scene, for light tracing: each light's primitive
    // and power, and the mirrors and glass (null for none: no caustics).
    /** @type {{ prim: number, power: number }[]} */
    #light_powers = [];
    /** @type {DeltaObjects | null} */
    #deltas = null;
    /** @type {GPUBindGroup | null} */
    #light_group = null;
    /** @type {GPUBindGroup | null} */
    #resolve_group = null;
    /** @type {GPUBindGroup | null} */
    #gather_group = null;
    // Photon mapping's grid of lists, and its photons, made when first
    // needed.
    /** @type {GPUBuffer | null} */
    #photon_heads = null;
    /** @type {GPUBuffer | null} */
    #photons = null;

    #samples = 0;
    #params = new ArrayBuffer(PARAMS_BYTES);
    #image_key = new Uint8Array(IMAGE_KEY_BYTES);

    // The uploaded scene, and which version of which scene it was.
    /** @type {GPUBuffer[]} */
    #scene_buffers = [];
    /** @type {GPUTexture | null} */
    #textures = null;
    #sampler;
    /** @type {Scene | null} */
    #uploaded_scene = null;
    #uploaded_version = -1;
    #light_count = 0;
    #volume_count = 0;
    #textured = false;
    #dispersive = false;
    // The sky's environment map, and its table for picking directions, as
    // uploaded, and which environment they came from (undefined: none yet).
    /** @type {GPUTexture | null} */
    #env_map = null;
    /** @type {GPUTexture | null} */
    #env_table = null;
    /** @type {import("./EnvironmentMap.mjs").EnvironmentMap | null | undefined} */
    #uploaded_environment = undefined;
    #env_sampler;
    /** @type {GPUTexture | null} */
    #normal_maps = null;

    // Per pixel: the accumulated colour, the denoiser's guides, two
    // buffers it filters back and forth between, and its result.
    /** @type {GPUBuffer | null} */
    #accum = null;
    /** @type {GPUBuffer[]} */
    #pixel_buffers = [];
    #width = 0;
    #height = 0;

    /** @type {GPUBindGroup | null} */
    #trace_group = null;
    /** @type {GPUBindGroup | null} */
    #display_group = null;
    /** @type {GPUBindGroup[]} */
    #denoise_groups = [];

    /**
     * Use Renderer.create() rather than calling this directly.
     * @param {GPUDevice} device
     * @param {HTMLCanvasElement | OffscreenCanvas} canvas
     * @param {GPUCanvasContext} context
     * @param {GPUTextureFormat} format
     * @param {GPUShaderModule} trace_module
     * @param {TracePipelines} trace_pipelines with every feature
     * @param {GPURenderPipeline} display_pipeline
     * @param {{ prepare: GPUComputePipeline, atrous: GPUComputePipeline, compose: GPUComputePipeline }} denoise_pipelines
     */
    constructor(device, canvas, context, format, trace_module, trace_pipelines, display_pipeline, denoise_pipelines) {

        this.#device = device;
        this.#canvas = canvas;
        this.#context = context;
        this.#format = format;
        this.#trace_module = trace_module;
        this.#all_pipelines = trace_pipelines;
        this.#trace_pipelines.set(featureKey(ALL_FEATURES), trace_pipelines);
        this.#display_pipeline = display_pipeline;
        this.#denoise_pipelines = denoise_pipelines;

        this.#params_buffer = device.createBuffer({
            label: "params",
            size: PARAMS_BYTES,
            usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
        });

        // Bilinear, repeating: the CPU's Texture.sample does the same.
        this.#sampler = device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
        });

        // Round the horizon, but not over the poles: EnvironmentMap.sample
        // does the same.
        this.#env_sampler = device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "clamp-to-edge",
        });

        // prepare, the à-trous passes, then compose.
        this.#pass_buffers = [0, ...ATROUS_STEPS, 0].map((step) => {
            const buffer = device.createBuffer({ label: "denoise pass", size: 16, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });
            device.queue.writeBuffer(buffer, 0, new Uint32Array([step, 0, 0, 0]));
            return buffer;
        });
    }

    /**
     * Sets up WebGPU on a canvas. Rejects with an Error saying why if the
     * browser or device can't.
     * @param {HTMLCanvasElement | OffscreenCanvas} canvas
     * @param {{ powerPreference?: GPUPowerPreference }} [options]
     */
    static async create(canvas, { powerPreference = "high-performance" } = {}) {

        const gpu = globalThis.navigator?.gpu;
        if (!gpu)
            throw new Error("WebGPU isn't available in this browser.");

        const adapter = await gpu.requestAdapter({ powerPreference });
        if (!adapter)
            throw new Error("WebGPU is available, but found no suitable graphics adapter.");

        // Ask for the largest buffers the adapter allows, for big meshes.
        const device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: adapter.limits.maxBufferSize,
            },
        });

        const context = /** @type {GPUCanvasContext | null} */ (canvas.getContext("webgpu"));
        if (!context)
            throw new Error("Couldn't get a WebGPU context for the canvas.");

        const format = gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "opaque" });

        const trace_module = await Renderer.#shaderModule(device, TRACE_SHADER, "trace");
        const [trace_pipelines, display_pipeline, denoise_pipelines] = await Promise.all([
            Renderer.#tracePipelines(device, trace_module, ALL_FEATURES),
            Renderer.#renderPipeline(device, DISPLAY_SHADER, format),
            Renderer.#denoisePipelines(device),
        ]);

        return new Renderer(device, canvas, context, format, trace_module, trace_pipelines, display_pipeline, denoise_pipelines);
    }

    get device() {
        return this.#device;
    }

    get canvas() {
        return this.#canvas;
    }

    /** @type {Scene | null} */
    get scene() {
        return this.#scene;
    }

    set scene(value) {
        this.#scene = value;
    }

    /** @type {Camera | null} */
    get camera() {
        return this.#camera;
    }

    set camera(value) {
        this.#camera = value;
    }

    /**
     * The most times a path scatters. 1 gives direct light only; glass
     * needs several to see through.
     */
    get maxBounces() {
        return this.#max_bounces;
    }

    set maxBounces(value) {
        this.#max_bounces = Math.max(1, Math.min(64, Math.floor(value)));
    }

    /** Paths per pixel added by each render(). */
    get samplesPerFrame() {
        return this.#samples_per_frame;
    }

    set samplesPerFrame(value) {
        this.#samples_per_frame = Math.max(1, Math.min(64, Math.floor(value)));
    }

    /** Multiplies the light before tone mapping. */
    get exposure() {
        return this.#exposure;
    }

    set exposure(value) {
        this.#exposure = Math.max(value, 0.0);
    }

    /**
     * Each path's light is scaled down to at most this bright, taming the
     * rare very bright samples ("fireflies") that take ages to average
     * out, at the cost of some accuracy. 0 turns it off.
     */
    get fireflyClamp() {
        return this.#firefly_clamp;
    }

    set fireflyClamp(value) {
        this.#firefly_clamp = Math.max(value, 0.0);
    }

    /** @type {View} */
    get view() {
        return this.#view;
    }

    set view(value) {
        if (!(value in VIEWS))
            throw new RangeError(`Unknown view "${value}".`);
        this.#view = value;
    }

    /**
     * Whether to show the image denoised: smoothed where it's still noisy,
     * guided by each pixel's surface so edges and textures stay sharp. The
     * smoothing fades as samples build up, so it converges to the same
     * image either way.
     */
    get denoise() {
        return this.#denoise;
    }

    set denoise(value) {
        this.#denoise = value;
    }

    /**
     * Whether to trace light from the lamps and the sun as well, through
     * mirrors and glass, so caustics (the light they focus onto surfaces)
     * come out sharp in a fraction of the samples. It takes effect with a
     * pinhole camera (aperture 0), in the color view, and in scenes without
     * volumes, which have mirrors or glass for it to go through; otherwise
     * path tracing finds caustics alone, slowly. Either way the image
     * converges to the same thing.
     */
    get caustics() {
        return this.#caustics;
    }

    set caustics(value) {
        this.#caustics = value;
    }

    /** Paths per pixel averaged so far. */
    get samples() {
        return this.#samples;
    }

    /** Throws the accumulated samples away, starting the average again. */
    reset() {
        this.#samples = 0;
    }

    /**
     * Adds samplesPerFrame paths per pixel and shows the result. Does
     * nothing without a scene and camera.
     */
    render() {

        const scene = this.#scene;
        const camera = this.#camera;
        if (!scene || !camera)
            return;

        const width = Math.max(1, this.#canvas.width);
        const height = Math.max(1, this.#canvas.height);

        if (scene != this.#uploaded_scene || scene.version != this.#uploaded_version)
            this.#upload(scene);

        if (scene.sky.environment !== this.#uploaded_environment)
            this.#uploadEnvironment(scene.sky.environment);

        if (!this.#accum || width != this.#width || height != this.#height)
            this.#resize(width, height);

        const caustics = this.#caustics && camera.aperture == 0 && this.#view == "color" && this.#volume_count == 0 &&
            this.#writeEmitters(scene);
        if (caustics != this.#caustics_active) {
            this.#caustics_active = caustics;
            this.#samples = 0;
        }

        this.#writeParams(scene, camera, width, height);

        const pipelines = this.#pipelinesFor({
            VOLUMES: this.#volume_count > 0,
            TEXTURES: this.#textured,
            ENVIRONMENT: scene.sky.environment != null,
            DISPERSION: this.#dispersive,
        });

        const encoder = this.#device.createCommandEncoder();

        // Photon mapping's grid starts each frame empty.
        if (caustics)
            encoder.clearBuffer(/** @type {GPUBuffer} */ (this.#photon_heads));

        const compute = encoder.beginComputePass();
        compute.setPipeline(pipelines.trace);
        compute.setBindGroup(0, this.#trace_group);
        compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));

        if (caustics) {
            compute.setPipeline(pipelines.light);
            compute.setBindGroup(0, this.#light_group);
            compute.dispatchWorkgroups(Math.ceil(Math.min(width * height * this.#samples_per_frame, PHOTON_CAPACITY) / 64));
            compute.setPipeline(pipelines.resolve);
            compute.setBindGroup(0, this.#resolve_group);
            compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
            compute.setPipeline(pipelines.gather);
            compute.setBindGroup(0, this.#gather_group);
            compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        }

        if (this.#denoising()) {
            const { prepare, atrous, compose } = this.#denoise_pipelines;
            const pipelines = [prepare, ...ATROUS_STEPS.map(() => atrous), compose];
            pipelines.forEach((pipeline, i) => {
                compute.setPipeline(pipeline);
                compute.setBindGroup(0, this.#denoise_groups[i]);
                compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
            });
        }

        compute.end();

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.#context.getCurrentTexture().createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        pass.setPipeline(this.#display_pipeline);
        pass.setBindGroup(0, this.#display_group);
        pass.draw(3);
        pass.end();

        this.#device.queue.submit([encoder.finish()]);
        this.#samples += this.#samples_per_frame;
    }

    /**
     * Reads back the average so far: 4 floats per pixel (red, green, blue,
     * then a value to ignore), row by row from the top left, in linear
     * light before exposure. For the albedo and normal views it's the
     * colour or normal; for depth, the distance (0 where nothing was hit).
     * With denoised, it's the denoised colour, as last shown (which needs
     * denoise on and the color view).
     * @param {{ denoised?: boolean }} [options]
     */
    async readPixels({ denoised = false } = {}) {

        if (!this.#accum || this.#samples == 0)
            throw new Error("Nothing has been rendered yet.");
        if (denoised && !this.#denoising())
            throw new Error("Only the color view is denoised, with denoise on.");

        const size = this.#width * this.#height * 16;
        const staging = this.#device.createBuffer({ size, usage: BUFFER_MAP_READ | BUFFER_COPY_DST });

        const encoder = this.#device.createCommandEncoder();
        encoder.copyBufferToBuffer(denoised ? this.#pixel_buffers[4] : this.#accum, 0, staging, 0, size);
        this.#device.queue.submit([encoder.finish()]);

        const samples = this.#samples;
        await staging.mapAsync(MAP_READ);
        const pixels = new Float32Array(staging.getMappedRange().slice(0));
        staging.destroy();

        // The denoised result is already an average.
        if (!denoised) {
            for (let i = 0; i < pixels.length; ++i)
                pixels[i] /= samples;
        }

        return pixels;
    }

    /** Frees the GPU resources. The renderer can't be used afterwards. */
    dispose() {

        for (const buffer of this.#scene_buffers)
            buffer.destroy();
        for (const buffer of [...this.#pixel_buffers, ...this.#pass_buffers])
            buffer.destroy();
        this.#textures?.destroy();
        this.#normal_maps?.destroy();
        this.#photon_heads?.destroy();
        this.#photons?.destroy();
        this.#env_map?.destroy();
        this.#env_table?.destroy();
        this.#accum?.destroy();
        this.#params_buffer.destroy();
        this.#context.unconfigure();
        this.#device.destroy();
    }

    /** @param {Scene} scene */
    #upload(scene) {

        const packed = scene.pack();

        for (const buffer of this.#scene_buffers)
            buffer.destroy();

        /** @type {(label: string, data: ArrayBuffer | ArrayBufferView) => GPUBuffer} */
        const storage = (label, data) => {
            const buffer = this.#device.createBuffer({
                label,
                size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
                usage: BUFFER_STORAGE | BUFFER_COPY_DST,
            });
            const bytes = ArrayBuffer.isView(data) ?
                new Uint8Array(data.buffer, data.byteOffset, data.byteLength) :
                new Uint8Array(data);
            this.#device.queue.writeBuffer(buffer, 0, bytes);
            return buffer;
        };

        const lights = packed.lights[0] == 0xffffffff ? [] : [...packed.lights];

        this.#scene_buffers = [
            storage("primitives", packed.primitives),
            storage("nodes", packed.nodes),
            storage("materials", packed.materials),
            storage("attributes", packed.attributes),
            storage("lights and volumes", new Uint32Array(lights.length + packed.volumes.length > 0 ? [...lights, ...packed.volumes] : [0xffffffff])),
        ];

        this.#light_count = lights.length;
        this.#volume_count = packed.volumes.length;
        this.#textured = packed.textures.length + packed.normalMaps.length > 0;
        this.#dispersive = packed.materialList.some((m) => m.dispersion > 0);

        // Each light's power, for light tracing to choose among them by:
        // its luminance times pi times its area.
        const prim_floats = new Float32Array(packed.primitives);
        const prim_uints = new Uint32Array(packed.primitives);
        const mat_floats = new Float32Array(packed.materials);
        this.#light_powers = lights.map((prim) => {
            const b = prim * 16, m = prim_uints[b + 1] * 24;
            const luminance = 0.2126 * mat_floats[m + 4] + 0.7152 * mat_floats[m + 5] + 0.0722 * mat_floats[m + 6];
            const v = (/** @type {number} */ i) => new Vec3(prim_floats[b + i], prim_floats[b + i + 1], prim_floats[b + i + 2]);
            const area = prim_uints[b] == PRIMITIVE_KINDS.quad ? v(8).cross(v(12)).length() : 4 * Math.PI * prim_floats[b + 7] ** 2;
            return { prim, power: luminance * Math.PI * area };
        });
        this.#deltas = deltaObjects(scene);
        this.#emitters?.destroy();
        this.#emitters = this.#device.createBuffer({
            label: "emitters",
            size: (2 + lights.length + MAX_TARGETS) * 16,
            usage: BUFFER_STORAGE | BUFFER_COPY_DST,
        });
        this.#textures?.destroy();
        this.#textures = this.#uploadTextures("textures", packed.textures, "rgba8unorm-srgb");
        this.#normal_maps?.destroy();
        this.#normal_maps = this.#uploadTextures("normal maps", packed.normalMaps, "rgba8unorm");
        this.#uploaded_scene = scene;
        this.#uploaded_version = scene.version;
        this.#trace_group = null;
        this.#samples = 0;

        if (this.#accum)
            this.#bind();
    }

    // Packs textures into one array texture, one layer each, resized to the
    // largest one's size. With none, a single white pixel stands in, since
    // something must be bound. Colour textures are sRGB; normal maps are
    // plain numbers, and resized as such.
    /**
     * @param {string} label
     * @param {import("./Texture.mjs").Texture[]} textures
     * @param {GPUTextureFormat} format
     */
    #uploadTextures(label, textures, format) {

        const width = Math.min(MAX_TEXTURE_SIZE, Math.max(1, ...textures.map((t) => t.width)));
        const height = Math.min(MAX_TEXTURE_SIZE, Math.max(1, ...textures.map((t) => t.height)));
        const layers = Math.max(1, textures.length);

        const texture = this.#device.createTexture({
            label,
            size: { width, height, depthOrArrayLayers: layers },
            format,
            usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
        });

        const data = textures.length > 0 ?
            textures.map((t) => t.resized(width, height, format == "rgba8unorm-srgb").data) :
            [new Uint8Array([255, 255, 255, 255])];

        data.forEach((bytes, layer) => this.#device.queue.writeTexture(
            { texture, origin: { x: 0, y: 0, z: layer } },
            bytes,
            { bytesPerRow: width * 4, rowsPerImage: height },
            { width, height, depthOrArrayLayers: 1 }));

        return texture;
    }

    // Writes the lights light tracing starts from, chosen by power: each as
    // two vec4s, the cumulative chance, its primitive (NONE for the sun),
    // its chance and how far out the sun's light starts; then the sphere
    // round the mirrors and glass, which is all the sun's light must pass
    // through to make a caustic.
    // Returns false if there's nothing for light tracing to do.
    /** @param {Scene} scene */
    #writeEmitters(scene) {

        const delta = this.#deltas;
        const sky = scene.sky;
        if (!delta || !this.#emitters)
            return false;

        // The sun's power is what falls on the targets' circles.
        const circles = delta.targets.reduce((sum, t) => sum + Math.PI * t.radius ** 2, 0);

        /** @type {{ prim: number, power: number }[]} */
        const sources = [...this.#light_powers];
        if (sky.sunStrength > 0) {
            const omc = 2.0 * Math.sin(sky.sunSize / 2.0) ** 2;
            const r = sky.sunRadiance;
            const luminance = 0.2126 * r.x + 0.7152 * r.y + 0.0722 * r.z;
            sources.push({ prim: 0xffffffff, power: luminance * 2 * Math.PI * omc * circles });
        }

        const total = sources.reduce((sum, e) => sum + e.power, 0);
        if (!(total > 0))
            return false;

        // A header (how many sources and targets, how far out the sun's
        // light starts, and the targets' circles' total area), then each
        // source's cumulative chance, primitive (NONE for the sun) and
        // chance, then each target's centre and radius.
        const data = new Float32Array(this.#emitters.size / 4);
        const uints = new Uint32Array(data.buffer);
        uints[0] = sources.length;
        uints[1] = delta.targets.length;
        data[2] = delta.reach;
        data[3] = circles;

        let running = 0;
        sources.forEach((source, k) => {
            running += source.power / total;
            data[4 + k * 4] = k == sources.length - 1 ? 1.0 : running;
            uints[4 + k * 4 + 1] = source.prim;
            data[4 + k * 4 + 2] = source.power / total;
        });
        delta.targets.forEach((t, j) => {
            data.set([t.centre.x, t.centre.y, t.centre.z, t.radius], 4 + (sources.length + j) * 4);
        });

        this.#device.queue.writeBuffer(this.#emitters, 0, data);
        return true;
    }

    // Uploads the environment map as half floats, and its table for picking
    // directions as full ones. Without one, black stand-ins are bound, which
    // the shader never reads, since it's told there's no environment.
    /** @param {import("./EnvironmentMap.mjs").EnvironmentMap | null} environment */
    #uploadEnvironment(environment) {

        this.#env_map?.destroy();
        this.#env_table?.destroy();

        const map = environment ?? { width: 1, height: 1, data: new Float32Array(3) };
        const table = environment?.importance() ?? { width: 1, height: 0, data: new Float32Array(1) };

        const rgba = new Uint16Array(map.width * map.height * 4);
        for (let i = 0; i < map.width * map.height; ++i) {
            for (let c = 0; c < 3; ++c)
                rgba[i * 4 + c] = toHalf(map.data[i * 3 + c]);
            rgba[i * 4 + 3] = toHalf(1.0);
        }

        this.#env_map = this.#device.createTexture({
            label: "environment",
            size: { width: map.width, height: map.height },
            format: "rgba16float",
            usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
        });
        this.#device.queue.writeTexture({ texture: this.#env_map }, rgba,
            { bytesPerRow: map.width * 8, rowsPerImage: map.height }, { width: map.width, height: map.height });

        this.#env_table = this.#device.createTexture({
            label: "environment table",
            size: { width: table.width, height: table.height + 1 },
            format: "r32float",
            usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
        });
        this.#device.queue.writeTexture({ texture: this.#env_table }, table.data,
            { bytesPerRow: table.width * 4, rowsPerImage: table.height + 1 }, { width: table.width, height: table.height + 1 });

        this.#uploaded_environment = environment;
        this.#samples = 0;
        if (this.#accum)
            this.#bind();
    }

    /**
     * @param {number} width
     * @param {number} height
     */
    #resize(width, height) {

        this.#accum?.destroy();
        for (const buffer of this.#pixel_buffers)
            buffer.destroy();

        /** @param {string} label */
        const pixels = (label) => this.#device.createBuffer({
            label,
            size: width * height * 16,
            usage: BUFFER_STORAGE | BUFFER_COPY_SRC,
        });

        this.#accum = pixels("accumulation");
        this.#pixel_buffers = ["guide albedo", "guide normal", "light a", "light b", "denoised", "splats"].map(pixels);

        this.#width = width;
        this.#height = height;
        this.#samples = 0;
        this.#bind();
    }

    #bind() {

        const accum = /** @type {GPUBuffer} */ (this.#accum);
        const [primitives, nodes, materials, attributes, lights] = this.#scene_buffers;
        const [guide_albedo, guide_normal, light_a, light_b, denoised, splats] = this.#pixel_buffers;
        const emitters = /** @type {GPUBuffer} */ (this.#emitters);

        this.#photon_heads ??= this.#device.createBuffer({
            label: "photon grid",
            size: (PHOTON_TABLE + 1) * 4,
            usage: BUFFER_STORAGE | BUFFER_COPY_DST,
        });
        this.#photons ??= this.#device.createBuffer({
            label: "photons",
            size: PHOTON_CAPACITY * 48,
            usage: BUFFER_STORAGE,
        });

        this.#light_group = this.#device.createBindGroup({
            layout: this.#all_pipelines.light.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 1, resource: { buffer: primitives } },
                { binding: 2, resource: { buffer: nodes } },
                { binding: 3, resource: { buffer: materials } },
                { binding: 4, resource: { buffer: attributes } },
                { binding: 9, resource: /** @type {GPUTexture} */ (this.#textures).createView({ dimension: "2d-array" }) },
                { binding: 10, resource: this.#sampler },
                { binding: 11, resource: /** @type {GPUTexture} */ (this.#normal_maps).createView({ dimension: "2d-array" }) },
                { binding: 15, resource: { buffer: splats } },
                { binding: 16, resource: { buffer: emitters } },
                { binding: 17, resource: { buffer: this.#photon_heads } },
                { binding: 18, resource: { buffer: this.#photons } },
            ],
        });

        this.#gather_group = this.#device.createBindGroup({
            layout: this.#all_pipelines.gather.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 1, resource: { buffer: primitives } },
                { binding: 2, resource: { buffer: nodes } },
                { binding: 3, resource: { buffer: materials } },
                { binding: 4, resource: { buffer: attributes } },
                { binding: 6, resource: { buffer: accum } },
                { binding: 9, resource: /** @type {GPUTexture} */ (this.#textures).createView({ dimension: "2d-array" }) },
                { binding: 10, resource: this.#sampler },
                { binding: 11, resource: /** @type {GPUTexture} */ (this.#normal_maps).createView({ dimension: "2d-array" }) },
                { binding: 17, resource: { buffer: this.#photon_heads } },
                { binding: 18, resource: { buffer: this.#photons } },
            ],
        });

        this.#resolve_group = this.#device.createBindGroup({
            layout: this.#all_pipelines.resolve.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 6, resource: { buffer: accum } },
                { binding: 15, resource: { buffer: splats } },
            ],
        });

        this.#trace_group = this.#device.createBindGroup({
            layout: this.#all_pipelines.trace.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 1, resource: { buffer: primitives } },
                { binding: 2, resource: { buffer: nodes } },
                { binding: 3, resource: { buffer: materials } },
                { binding: 4, resource: { buffer: attributes } },
                { binding: 5, resource: { buffer: lights } },
                { binding: 6, resource: { buffer: accum } },
                { binding: 7, resource: { buffer: guide_albedo } },
                { binding: 8, resource: { buffer: guide_normal } },
                { binding: 9, resource: /** @type {GPUTexture} */ (this.#textures).createView({ dimension: "2d-array" }) },
                { binding: 10, resource: this.#sampler },
                { binding: 11, resource: /** @type {GPUTexture} */ (this.#normal_maps).createView({ dimension: "2d-array" }) },
                { binding: 12, resource: /** @type {GPUTexture} */ (this.#env_map).createView() },
                { binding: 13, resource: /** @type {GPUTexture} */ (this.#env_table).createView() },
                { binding: 14, resource: this.#env_sampler },
            ],
        });

        this.#display_group = this.#device.createBindGroup({
            layout: this.#display_pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 1, resource: { buffer: accum } },
                { binding: 2, resource: { buffer: denoised } },
            ],
        });

        // Each pass reads one buffer and writes another: prepare fills
        // light a, the à-trous passes go back and forth, and compose writes
        // the result.
        /** @type {[GPUBuffer, GPUBuffer][]} */
        const flows = [[light_b, light_a]];
        ATROUS_STEPS.forEach((_, i) => flows.push(i % 2 == 0 ? [light_a, light_b] : [light_b, light_a]));
        flows.push([flows[flows.length - 1][1], denoised]);

        this.#denoise_groups = flows.map(([from, to], i) => this.#device.createBindGroup({
            layout: this.#denoise_pipelines.prepare.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.#params_buffer } },
                { binding: 1, resource: { buffer: this.#pass_buffers[i] } },
                { binding: 2, resource: { buffer: accum } },
                { binding: 3, resource: { buffer: guide_albedo } },
                { binding: 4, resource: { buffer: guide_normal } },
                { binding: 5, resource: { buffer: from } },
                { binding: 6, resource: { buffer: to } },
            ],
        }));
    }

    #denoising() {
        return this.#denoise && this.#view == "color";
    }

    /**
     * @param {Scene} scene
     * @param {Camera} camera
     * @param {number} width
     * @param {number} height
     */
    #writeParams(scene, camera, width, height) {

        const f = new Float32Array(this.#params);
        const u = new Uint32Array(this.#params);
        const { right, up, forward } = camera.basis();
        const sky = scene.sky;

        /** @type {(row: number, v: { x: number, y: number, z: number }) => void} */
        const row = (r, v) => f.set([v.x, v.y, v.z], r * 4);

        row(0, camera.position);
        f[3] = camera.aperture;
        row(1, right);
        f[7] = Math.tan(camera.fov / 2.0);
        row(2, up);
        f[11] = camera.effectiveFocusDistance;
        row(3, forward);
        f[15] = width / height;

        row(4, sky.zenith);
        // 1 - cos(size), written so it stays accurate for tiny suns.
        f[19] = 2.0 * Math.sin(sky.sunSize / 2.0) ** 2;
        row(5, sky.horizon);
        u[23] = sky.sunStrength > 0.0 ? 1 : 0;
        row(6, sky.ground);
        f[27] = this.#firefly_clamp;
        row(7, sky.sunDirection);
        u[31] = this.#light_count;
        row(8, sky.sunRadiance);
        u[35] = this.#max_bounces;

        u[36] = VIEWS[this.#view];
        u[37] = this.#volume_count;
        f[38] = sky.environment ? sky.environmentStrength : 0.0;
        f[39] = sky.environmentRotation;
        u[40] = width;
        u[41] = height;

        // Anything that changes the image starts the average again.
        const key = new Uint8Array(this.#params, 0, IMAGE_KEY_BYTES);
        if (!key.every((b, i) => b == this.#image_key[i])) {
            this.#image_key.set(key);
            this.#samples = 0;
        }

        u[42] = this.#samples;
        u[43] = this.#samples_per_frame;
        u[44] = this.#samples + this.#samples_per_frame;
        f[45] = this.#exposure;
        u[46] = this.#denoising() ? 1 : 0;
        u[47] = this.#caustics_active ? 1 : 0;

        // Photon mapping's radius: about 3 pixels across where the camera
        // sees the mirrors and glass, shrinking with each frame as
        // progressive photon mapping's does (r² ∝ frames^-1/3), so the
        // blur it leaves fades and the average converges. The grid is
        // rebuilt each frame with cells twice the radius, so a gather's 8
        // cells hold the photons it needs and few more.
        const sphere = this.#deltas;
        const distance = sphere ? Math.max(camera.position.subtract(sphere.centre).length(), sphere.radius) : 1;
        const start = Math.max(3 * 2 * Math.tan(camera.fov / 2) * distance / height, 1e-5);
        const frame = Math.floor(this.#samples / Math.max(this.#samples_per_frame, 1)) + 1;
        f[48] = start * frame ** (-1 / 6);
        f[49] = 2 * f[48];

        this.#device.queue.writeBuffer(this.#params_buffer, 0, this.#params);
    }

    /**
     * @param {GPUDevice} device
     * @param {string} code
     */
    // The trace pipelines for the features a scene uses, or the ones with
    // every feature while those are being made.
    /** @param {Features} features */
    #pipelinesFor(features) {

        const key = featureKey(features);
        const pipelines = this.#trace_pipelines.get(key);
        if (pipelines)
            return pipelines;

        if (pipelines === undefined) {
            this.#trace_pipelines.set(key, null);
            Renderer.#tracePipelines(this.#device, this.#trace_module, features)
                .then((made) => this.#trace_pipelines.set(key, made));
        }

        return this.#all_pipelines;
    }

    // The path tracer, and light tracing's passes, with the features
    // given. Their layouts are explicit, so bind groups work with every
    // combination of features (and each pass uses only some of the
    // module's bindings).
    /**
     * @param {GPUDevice} device
     * @param {GPUShaderModule} module
     * @param {Features} features
     * @returns {Promise<TracePipelines>}
     */
    static async #tracePipelines(device, module, features) {

        const constants = Object.fromEntries(Object.entries(features).map(([name, on]) => [name, on ? 1 : 0]));

        /** @type {(binding: number, layout: Omit<GPUBindGroupLayoutEntry, "binding" | "visibility">) => GPUBindGroupLayoutEntry} */
        const entry = (binding, layout) => ({ binding, visibility: COMPUTE_STAGE, ...layout });
        const uniform = (/** @type {number} */ b) => entry(b, { buffer: { type: "uniform" } });
        const read = (/** @type {number} */ b) => entry(b, { buffer: { type: STORAGE_READ } });
        const write = (/** @type {number} */ b) => entry(b, { buffer: { type: "storage" } });
        const array = (/** @type {number} */ b) => entry(b, { texture: { sampleType: "float", viewDimension: "2d-array" } });

        /** @type {(entryPoint: string, entries: GPUBindGroupLayoutEntry[]) => Promise<GPUComputePipeline>} */
        const pipeline = (entryPoint, entries) => device.createComputePipelineAsync({
            label: entryPoint,
            layout: device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries })] }),
            compute: { module, entryPoint, constants },
        });

        const [trace, light, resolve, gather] = await Promise.all([
            pipeline("main", [
                uniform(0), read(1), read(2), read(3), read(4), read(5), write(6), write(7), write(8),
                array(9), entry(10, { sampler: { type: "filtering" } }), array(11),
                entry(12, { texture: { sampleType: "float" } }), entry(13, { texture: { sampleType: "unfilterable-float" } }),
                entry(14, { sampler: { type: "filtering" } }),
            ]),
            pipeline("light_trace", [
                uniform(0), read(1), read(2), read(3), read(4),
                array(9), entry(10, { sampler: { type: "filtering" } }), array(11),
                write(15), read(16), write(17), write(18),
            ]),
            pipeline("resolve_splats", [uniform(0), write(6), write(15)]),
            pipeline("photon_gather", [
                uniform(0), read(1), read(2), read(3), read(4), write(6),
                array(9), entry(10, { sampler: { type: "filtering" } }), array(11),
                write(17), write(18),
            ]),
        ]);

        return { trace, light, resolve, gather };
    }

    /**
     * @param {GPUDevice} device
     * @param {string} code
     * @param {GPUTextureFormat} format
     */
    static async #renderPipeline(device, code, format) {

        const module = await Renderer.#shaderModule(device, code, "display");

        return device.createRenderPipelineAsync({
            label: "display",
            layout: "auto",
            vertex: { module, entryPoint: "vertex" },
            fragment: { module, entryPoint: "fragment", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
        });
    }

    // The denoiser's three pipelines share one layout, so their bind groups
    // are interchangeable.
    /** @param {GPUDevice} device */
    static async #denoisePipelines(device) {

        const module = await Renderer.#shaderModule(device, DENOISE_SHADER, "denoise");

        let binding = 0;
        /** @type {(type: GPUBufferBindingType) => GPUBindGroupLayoutEntry} */
        const entry = (type) => ({ binding: binding++, visibility: COMPUTE_STAGE, buffer: { type } });

        const layout = device.createPipelineLayout({
            bindGroupLayouts: [device.createBindGroupLayout({
                entries: [
                    entry("uniform"), entry("uniform"),
                    entry(STORAGE_READ), entry(STORAGE_READ), entry(STORAGE_READ), entry(STORAGE_READ),
                    entry("storage"),
                ],
            })],
        });

        const [prepare, atrous, compose] = await Promise.all(["prepare", "atrous", "compose"].map((entryPoint) =>
            device.createComputePipelineAsync({ label: `denoise ${entryPoint}`, layout, compute: { module, entryPoint } })));

        return { prepare, atrous, compose };
    }

    // Compiles a shader, turning compilation errors into an exception
    // that says where they are.
    /**
     * @param {GPUDevice} device
     * @param {string} code
     * @param {string} label
     */
    static async #shaderModule(device, code, label) {

        const module = device.createShaderModule({ label, code });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter((m) => m.type == "error");

        if (errors.length > 0) {
            const text = errors.map((m) => `${label} shader ${m.lineNum}:${m.linePos}: ${m.message}`).join("\n");
            throw new Error(text);
        }

        return module;
    }
}

// The nearest half-precision float to x, as its 16 bits, for rgba16float
// textures: large values become the largest half (65504) rather than
// infinity, and tiny ones zero.
/** @param {number} x */
function toHalf(x) {

    if (!(x > 0.0))
        return 0;
    if (x >= 65504.0)
        return 0x7bff;
    if (x < 6.1035e-5)
        return Math.round(x / 5.9605e-8); // subnormal

    const exponent = Math.floor(Math.log2(x));
    let mantissa = Math.round((x / 2 ** exponent - 1.0) * 1024);
    let e = exponent + 15;
    if (mantissa == 1024) {
        mantissa = 0;
        e++;
    }
    return (e << 10) | mantissa;
}

// The scene's mirrors and glass, for light tracing, or null if there are
// none.
/**
 * @param {Scene} scene
 * @returns {DeltaObjects | null}
 */
function deltaObjects(scene) {

    // Each mirror or glass object's box.
    /** @type {{ min: number[], max: number[], centre: number[] }[]} */
    const boxes = [];
    for (const object of scene.objects) {
        const m = object.material;
        if (!(m.type == "glass" || (m.type == "metal" && m.roughness < 0.01)))
            continue;
        /** @type {Vec3[]} */
        let points;
        if (object instanceof Mesh)
            points = object.positions;
        else if (object instanceof Box)
            points = object.corners();
        else if (object instanceof Quad)
            points = [object.corner, object.corner.add(object.u), object.corner.add(object.v), object.corner.add(object.u).add(object.v)];
        else {
            const r = new Vec3(object.radius, object.radius, object.radius);
            points = [object.center.subtract(r), object.center.add(r)];
        }
        const box = boxAround(points.map((p) => [p.x, p.y, p.z]));
        boxes.push({ ...box, centre: box.min.map((c, a) => (c + box.max[a]) / 2) });
    }

    if (boxes.length == 0)
        return null;

    // Split the biggest group in two, across its longest side, until
    // there are enough (or every object has its own).
    const groups = [boxes];
    while (groups.length < MAX_TARGETS) {
        let biggest = -1, size = 0;
        groups.forEach((g, i) => {
            const s = g.length > 1 ? radius(boxAround(g.flatMap((b) => [b.min, b.max]))) : 0;
            if (s > size) {
                biggest = i;
                size = s;
            }
        });
        if (biggest < 0)
            break;
        const group = groups[biggest];
        const spread = boxAround(group.map((b) => b.centre));
        const extent = spread.max.map((c, a) => c - spread.min[a]);
        const axis = extent.indexOf(Math.max(...extent));
        group.sort((p, q) => p.centre[axis] - q.centre[axis]);
        groups.splice(biggest, 1, group.slice(0, group.length >> 1), group.slice(group.length >> 1));
    }

    /** @type {(box: { min: number[], max: number[] }) => { centre: Vec3, radius: number }} */
    const sphereAround = (box) => ({
        centre: new Vec3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2),
        radius: Math.max(radius(box), 1e-3) * 1.001,
    });
    const targets = groups.map((g) => sphereAround(boxAround(g.flatMap((b) => [b.min, b.max]))));
    const all = sphereAround(boxAround(boxes.flatMap((b) => [b.min, b.max])));

    // Far enough out along any direction from any target to be outside the
    // whole scene, so sunlight starting there passes everything that might
    // shade the glass.
    const bounds = scene.bounds();
    const middle = bounds ? bounds.min.add(bounds.max).scale(0.5) : new Vec3(0, 0, 0);
    const reach = bounds ?
        Math.max(...targets.map((t) => t.centre.subtract(middle).length())) + bounds.max.subtract(bounds.min).length() / 2 + 1 : 1;

    return { ...all, reach, targets };
}

// The smallest box round some points, each [x, y, z].
/** @param {number[][]} points */
function boxAround(points) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
        for (let a = 0; a < 3; ++a) {
            min[a] = Math.min(min[a], p[a]);
            max[a] = Math.max(max[a], p[a]);
        }
    }
    return { min, max };
}

// Half a box's diagonal.
/** @param {{ min: number[], max: number[] }} box */
function radius(box) {
    return Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2;
}

// The key #trace_pipelines files pipelines with these features under.
/** @param {Features} features */
function featureKey(features) {
    return [features.VOLUMES, features.TEXTURES, features.ENVIRONMENT, features.DISPERSION].map(Number).join("");
}
