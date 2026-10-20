import { DENOISE_SHADER, DISPLAY_SHADER, TRACE_SHADER } from "./shaders.mjs";
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

const PARAMS_BYTES = 192;
// The denoiser's à-trous passes, each spreading twice as far as the last.
const ATROUS_STEPS = [1, 2, 4, 8, 16];
const STORAGE_READ = /** @type {GPUBufferBindingType} */ ("read-only-storage");
const COMPUTE_STAGE = 0x4;
// The part of the uniforms that decides the image: see shaders.mjs.
const IMAGE_KEY_BYTES = 168;

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

    #trace_pipeline;
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
     * @param {GPUComputePipeline} trace_pipeline
     * @param {GPURenderPipeline} display_pipeline
     * @param {{ prepare: GPUComputePipeline, atrous: GPUComputePipeline, compose: GPUComputePipeline }} denoise_pipelines
     */
    constructor(device, canvas, context, format, trace_pipeline, display_pipeline, denoise_pipelines) {

        this.#device = device;
        this.#canvas = canvas;
        this.#context = context;
        this.#format = format;
        this.#trace_pipeline = trace_pipeline;
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

        const [trace_pipeline, display_pipeline, denoise_pipelines] = await Promise.all([
            Renderer.#computePipeline(device, TRACE_SHADER),
            Renderer.#renderPipeline(device, DISPLAY_SHADER, format),
            Renderer.#denoisePipelines(device),
        ]);

        return new Renderer(device, canvas, context, format, trace_pipeline, display_pipeline, denoise_pipelines);
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

        if (!this.#accum || width != this.#width || height != this.#height)
            this.#resize(width, height);

        this.#writeParams(scene, camera, width, height);

        const encoder = this.#device.createCommandEncoder();

        const compute = encoder.beginComputePass();
        compute.setPipeline(this.#trace_pipeline);
        compute.setBindGroup(0, this.#trace_group);
        compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));

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

        this.#scene_buffers = [
            storage("primitives", packed.primitives),
            storage("nodes", packed.nodes),
            storage("materials", packed.materials),
            storage("attributes", packed.attributes),
            storage("lights", packed.lights),
        ];

        this.#light_count = packed.lights[0] == 0xffffffff ? 0 : packed.lights.length;
        this.#uploadTextures(packed.textures);
        this.#uploaded_scene = scene;
        this.#uploaded_version = scene.version;
        this.#trace_group = null;
        this.#samples = 0;

        if (this.#accum)
            this.#bind();
    }

    // Packs the textures into one array texture, one layer each, resized
    // to the largest one's size. With none, a single white pixel stands in,
    // since something must be bound.
    /** @param {import("./Texture.mjs").Texture[]} textures */
    #uploadTextures(textures) {

        this.#textures?.destroy();

        const width = Math.min(MAX_TEXTURE_SIZE, Math.max(1, ...textures.map((t) => t.width)));
        const height = Math.min(MAX_TEXTURE_SIZE, Math.max(1, ...textures.map((t) => t.height)));
        const layers = Math.max(1, textures.length);

        this.#textures = this.#device.createTexture({
            label: "textures",
            size: { width, height, depthOrArrayLayers: layers },
            format: "rgba8unorm-srgb",
            usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
        });

        const data = textures.length > 0 ?
            textures.map((t) => t.resized(width, height).data) :
            [new Uint8Array([255, 255, 255, 255])];

        data.forEach((bytes, layer) => this.#device.queue.writeTexture(
            { texture: /** @type {GPUTexture} */ (this.#textures), origin: { x: 0, y: 0, z: layer } },
            bytes,
            { bytesPerRow: width * 4, rowsPerImage: height },
            { width, height, depthOrArrayLayers: 1 }));
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
        this.#pixel_buffers = ["guide albedo", "guide normal", "light a", "light b", "denoised"].map(pixels);

        this.#width = width;
        this.#height = height;
        this.#samples = 0;
        this.#bind();
    }

    #bind() {

        const accum = /** @type {GPUBuffer} */ (this.#accum);
        const [primitives, nodes, materials, attributes, lights] = this.#scene_buffers;
        const [guide_albedo, guide_normal, light_a, light_b, denoised] = this.#pixel_buffers;

        this.#trace_group = this.#device.createBindGroup({
            layout: this.#trace_pipeline.getBindGroupLayout(0),
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

        this.#device.queue.writeBuffer(this.#params_buffer, 0, this.#params);
    }

    /**
     * @param {GPUDevice} device
     * @param {string} code
     */
    static async #computePipeline(device, code) {

        const module = await Renderer.#shaderModule(device, code, "trace");

        return device.createComputePipelineAsync({
            label: "trace",
            layout: "auto",
            compute: { module, entryPoint: "main" },
        });
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
