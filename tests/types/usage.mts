// Uses the API the way a TypeScript project would, through the package's
// own name, so the declarations are what npm users get. Type-checked only,
// never run. The @ts-expect-error lines must fail to compile: they prove the
// types aren't just `any`.

import {
    Box, Camera, Mat4, Material, Mesh, OrbitControls, Quad, Renderer, Scene, Sky, Sphere, Texture, Vec2, Vec3,
    hexColor, type View,
} from "@stefanskrobanski/raymond";

declare const canvas: HTMLCanvasElement;

const scene = new Scene({ sky: new Sky({ sunStrength: 3 }) });

scene.add(
    new Sphere(new Vec3(0, 1, 0), 1, Material.glass(1.5)),
    new Quad(new Vec3(-5, 0, 5), new Vec3(10, 0, 0), new Vec3(0, 0, -10), Material.checkered(hexColor("#eee"), hexColor("#333"))),
    Box.fromCorners(new Vec3(1, 0, 1), new Vec3(2, 1, 2), Material.metal(new Vec3(1, 0.8, 0.4), 0.2), 0.5),
    Mesh.torus(Material.plastic(new Vec3(0.8, 0.1, 0.1))).transformed(Mat4.translate(-2, 0.4, 0)));

const camera = new Camera({ position: new Vec3(0, 2, 6), target: new Vec3(0, 1, 0), aperture: 0.05 });
const controls = new OrbitControls(camera, canvas, OrbitControls.viewFrom(camera.position, camera.target));
controls.addEventListener("change", () => renderer.render());

const renderer: Renderer = await Renderer.create(canvas);
renderer.scene = scene;
renderer.camera = camera;
renderer.maxBounces = 12;
renderer.denoise = true;

const view: View = "normal";
renderer.view = view;

const pixels: Float32Array = await renderer.readPixels();
const denoised: Float32Array = await renderer.readPixels({ denoised: true });
const hit = scene.raycast(camera.position, camera.target.subtract(camera.position));
const distance: number | undefined = hit?.distance;

// @ts-expect-error: not a view
renderer.view = "wireframe";

// @ts-expect-error: a sphere needs a material
new Sphere(new Vec3(0, 0, 0), 1);

// @ts-expect-error: a lathe's profile is Vec2s
Mesh.lathe([new Vec3(0, 0, 0)], Material.diffuse(new Vec3(1, 1, 1)));

const stick: Box = Box.between(new Vec3(0, 0, 0), new Vec3(0, 1, 0), 0.1, Material.metal(new Vec3(1, 1, 1)));

// @ts-expect-error: colours are Vec3s
Material.diffuse("#ff0000");

const checks: Texture = Texture.procedural(64, 64, (u, v) => new Vec3(u, v, 0.5));
const loaded: Promise<Texture> = Texture.load("wood.png");
const globe = new Sphere(new Vec3(0, 1, 0), 1, Material.diffuse(new Vec3(1, 1, 1)).withTexture(checks, new Vec2(2, 1)), { rotation: Mat4.rotateZ(0.4) });
const strip = new Mesh(
    [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)], [0, 1, 2],
    Material.diffuse(new Vec3(1, 1, 1)).withTexture(checks, 3),
    { uvs: [new Vec2(0, 0), new Vec2(1, 0), new Vec2(0, 1)] });
const uv: Vec2 | undefined = scene.add(globe, strip).raycast(new Vec3(0, 1, 5), new Vec3(0, 0, -1))?.uv;

// @ts-expect-error: a texture's scale is a number or a Vec2
Material.diffuse(new Vec3(1, 1, 1)).withTexture(checks, "2");

const bumps: Texture = Texture.normalMap(64, 64, (u, v) => 0.01 * Math.sin(u * 20) * Math.sin(v * 20));
const bumpy: Material = Material.plastic(new Vec3(0.8, 0.2, 0.2)).withTexture(checks).withNormalMap(bumps, 1.5);
const screen: Material = Material.diffuse(new Vec3(0, 0, 0)).withEmission(new Vec3(1, 1, 1), 3, checks);
const flint: Material = Material.glass(1.65, new Vec3(1, 1, 1), 30);
const redder: number = flint.iorAt(700) - flint.iorAt(400);
const haze: Material = Material.volume(new Vec3(0.9, 0.9, 0.9), 0.2, 0.6);
scene.add(new Box(Mat4.scale(5, 5, 5), haze), new Sphere(new Vec3(0, 0, 0), 1, flint), new Sphere(new Vec3(2, 0, 0), 1, bumpy));
const glows: boolean = screen.glows;

// @ts-expect-error: a normal map's strength is a number
bumpy.withNormalMap(bumps, "deep");

// @ts-expect-error: volumes need a density
Material.volume(new Vec3(1, 1, 1));

export { pixels, denoised, distance, stick, loaded, uv, redder, glows };
