// Scenes for the browser tests, and window.trace(), which renders one and
// returns the GPU's pixels alongside what the CPU raycast sees through
// each pixel's centre.

import {
    Box, Camera, Mat4, Material, Mesh, Quad, Renderer, Scene, Sky, Sphere, Vec3,
} from "../../src/index.mjs";

const BLACK = new Vec3(0, 0, 0);
const WHITE_SKY = new Sky({ zenith: new Vec3(1, 1, 1), horizon: new Vec3(1, 1, 1), ground: new Vec3(1, 1, 1) });
const FLOOR_ALBEDO = 0.5;

const floor = (material = Material.diffuse(new Vec3(FLOOR_ALBEDO, FLOOR_ALBEDO, FLOOR_ALBEDO))) =>
    new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), material);

const LOOK_DOWN = { position: new Vec3(0, 4, 4), target: new Vec3(0, 0, 0), fov: Math.PI / 3 };

/** @type {Record<string, (arg?: any) => { scene: Scene, camera: any }>} */
const SCENES = {

    // One of each primitive, for comparing the GPU's hits with the CPU's.
    mixed: () => ({
        scene: new Scene({ sky: Sky.black() }).add(
            floor(),
            new Sphere(new Vec3(-1.2, 0.6, 0), 0.6, Material.diffuse(new Vec3(1, 0, 0))),
            Box.fromCorners(new Vec3(0.2, 0, -1.4), new Vec3(1.2, 1.4, -0.4), Material.metal(new Vec3(1, 1, 1), 0.2), 0.6),
            Mesh.torus(Material.plastic(new Vec3(0, 0, 1)), { radius: 0.5, tube: 0.2, segments: 32, sides: 16 })
                .transformed(Mat4.translate(0.9, 0.5, 1.0).multiplyMat4(Mat4.rotateX(1.2))),
            Mesh.icosphere(Material.glass(), 1, { shading: "flat" })
                .transformed(Mat4.translate(-0.3, 0.4, 1.4).multiplyMat4(Mat4.scale(0.4, 0.4, 0.4)))),
        camera: { position: new Vec3(1.5, 3, 4.5), target: new Vec3(0, 0.4, 0), fov: Math.PI / 3 },
    }),

    // A convex object under a uniform white sky: each path bounces off it
    // at most once, so the brightness is its reflectance: 0.8 for diffuse,
    // 1 for clear glass.
    furnaceDiffuse: () => ({
        scene: new Scene({ sky: WHITE_SKY }).add(new Sphere(new Vec3(0, 0, 0), 1, Material.diffuse(new Vec3(0.8, 0.8, 0.8)))),
        camera: { position: new Vec3(0, 0, 3.2), target: new Vec3(0, 0, 0), fov: Math.PI / 3 },
    }),

    furnaceGlass: () => ({
        scene: new Scene({ sky: WHITE_SKY }).add(new Sphere(new Vec3(0, 0, 0), 1, Material.glass(1.5))),
        camera: { position: new Vec3(0, 0, 3.2), target: new Vec3(0, 0, 0), fov: Math.PI / 3 },
    }),

    // Direct light on a diffuse floor, from lights with exact formulas.
    sphereLight: () => ({
        scene: new Scene({ sky: Sky.black() }).add(
            floor(),
            new Sphere(new Vec3(0.5, 1.5, -1), 0.5, Material.light(new Vec3(1, 1, 1), 6.0))),
        camera: LOOK_DOWN,
    }),

    quadLight: () => ({
        scene: new Scene({ sky: Sky.black() }).add(
            floor(),
            new Quad(new Vec3(-0.5, 1.5, -1.5), new Vec3(1.2, 0, 0), new Vec3(0, 0, 0.8), Material.light(new Vec3(1, 1, 1), 6.0))),
        camera: LOOK_DOWN,
    }),

    sun: () => ({
        scene: new Scene({
            sky: new Sky({ zenith: BLACK, horizon: BLACK, ground: BLACK, sunStrength: 2.0, sunDirection: new Vec3(0, 1, 0), sunSize: 0.05 }),
        }).add(floor()),
        camera: LOOK_DOWN,
    }),

    // A big ball of light over a floor of the given material: sampled
    // directly as a sphere light, or (as a mesh, which isn't sampled) only
    // found by bouncing. The two should agree.
    lightAsSphere: (material) => ({
        scene: new Scene({ sky: Sky.black() }).add(
            floor(MATERIALS[material]),
            new Sphere(new Vec3(0, 1.6, -0.5), 1.0, Material.light(new Vec3(1, 1, 1), 2.0))),
        camera: LOOK_DOWN,
    }),

    lightAsMesh: (material) => ({
        scene: new Scene({ sky: Sky.black() }).add(
            floor(MATERIALS[material]),
            Mesh.icosphere(Material.light(new Vec3(1, 1, 1), 2.0), 5)
                .transformed(Mat4.translate(0, 1.6, -0.5))),
        camera: LOOK_DOWN,
    }),
};

const MATERIALS = {
    diffuse: Material.diffuse(new Vec3(0.7, 0.7, 0.7)),
    plastic: Material.plastic(new Vec3(0.7, 0.2, 0.2), 0.3),
    metal: Material.metal(new Vec3(0.9, 0.8, 0.6), 0.4),
};

/** @type {Renderer | undefined} */
let renderer;

/**
 * Renders a scene and returns { pixels, hits }: pixels is the GPU's
 * average, 4 floats per pixel; hits holds, for each pixel, what the CPU
 * raycast through its centre found (null for nothing).
 * @param {string} name
 * @param {{ arg?: string, spp?: number, bounces?: number, view?: import("../../src/Renderer.mjs").View, size?: number }} options
 */
async function trace(name, { arg, spp = 16, bounces = 8, view = "color", size = 48 } = {}) {

    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
    canvas.width = size;
    canvas.height = size;

    renderer ??= await Renderer.create(canvas);

    const { scene, camera: options } = SCENES[name](arg);
    const camera = new Camera(options);

    renderer.scene = scene;
    renderer.camera = camera;
    renderer.view = view;
    renderer.maxBounces = bounces;
    renderer.fireflyClamp = 0;
    renderer.samplesPerFrame = Math.min(spp, 16);
    renderer.reset();

    while (renderer.samples < spp)
        renderer.render();

    const pixels = Array.from(await renderer.readPixels());

    const hits = [];
    for (let y = 0; y < size; ++y) {
        for (let x = 0; x < size; ++x) {
            const ray = camera.pixelRay(x, y, size, size);
            const hit = scene.raycast(ray.origin, ray.direction);
            hits.push(hit && {
                object: scene.objects.indexOf(hit.object),
                distance: hit.distance,
                point: [hit.point.x, hit.point.y, hit.point.z],
                normal: [hit.normal.x, hit.normal.y, hit.normal.z],
            });
        }
    }

    return { pixels, hits, samples: renderer.samples };
}

Object.assign(window, { trace, ready: true });
