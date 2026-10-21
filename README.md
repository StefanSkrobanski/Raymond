# Raymond

A progressive path tracer for WebGPU, in plain JavaScript ES modules with no dependencies and no build step. Each frame adds more light paths through every pixel to a running average, so the image starts grainy and clears up while you watch.

**Live demo:** <https://stefanskrobanski.github.io/Raymond/>. It needs WebGPU: a recent Chrome or Edge, Safari 26, or Firefox 141 on Windows.

## What it does

- **Path tracing in a compute shader**, with next event estimation (aiming rays straight at lights) combined with BSDF sampling by multiple importance sampling, and Russian roulette to end dim paths.
- **Shapes:** spheres, quads (flat parallelograms), boxes under any affine transform (including sticks between two points), and triangle meshes with smooth or flat shading: generated spheres, tori, tubes round any closed curve, solids turned on a lathe, and parametric surfaces. Everything goes in one bounding volume hierarchy, built on the CPU with the surface area heuristic and traversed on the GPU.
- **Materials:** diffuse, metal and plastic (GGX microfacets, from polished to rough), glass (exact Fresnel, refraction, tint, and optionally dispersion, which splits white light into rainbows by tracing a wavelength per path), lights, glowing surfaces, and 3D checkerboards.
- **Fog, smoke and haze:** spheres and boxes filled with a scattering medium (Henyey-Greenstein phase function, sampled exactly and aimed at lights through the fog), for sunbeams and mist.
- **Textures** on every shape: from image files (`Texture.load`) or drawn by a function (`Texture.procedural`), filtered and repeating, with spheres mapped by latitude and longitude, box faces by their size in world units, and meshes by their own texture coordinates (generated for the built-in shapes). Normal maps add bumps (made from a height function with `Texture.normalMap`), and emission textures make patterns glow: lit windows, city lights, the sun's surface. The demo's wood, marble, brick, stone, planets and their bumps are all procedural.
- **Lights:** emissive quads and spheres, sampled directly; a sky gradient; a sun with a soft-edged disc; and HDR environment maps (Radiance .hdr panoramas, or drawn in code), importance-sampled by brightness, so a bright sun in a photographed sky lights the scene cleanly.
- **Light tracing for caustics:** alongside the paths from the camera, light is traced from the lamps and the sun through mirrors and glass and connected straight to the camera, so the light they focus onto surfaces comes out sharp in a fraction of the samples; the path tracer leaves those paths to it, so nothing is counted twice. Caustics seen through glass or water, like a pool's floor, come from the same light stored as a photon map, gathered at whatever the camera sees through the glass.
- **A denoiser** that clears the grain from the first few samples: an edge-avoiding à-trous wavelet filter guided by each pixel's albedo, normal and distance, and steered by an estimate of its noise (as in SVGF), so it backs off as the samples build up and the image still converges to the exact answer.
- **A thin-lens camera** with depth of field, and **inspection views** of albedo, normals and depth.
- **A fast preview while you move the camera** in the demo: fewer bounces at a lower resolution, which adapts to keep about 30 frames a second on whatever device it's on, then the full image the moment you stop.
- **Orbit controls** for mouse, touch and pen, adapted from [Styx](https://github.com/StefanSkrobanski/Styx), whose maths library Raymond also uses.
- **A CPU raycast** with exactly the shader's tests, on the same packed data, for picking (tap to focus) and for testing the GPU.

The demo app has 50 scenes in five groups:

- **Classics:** two Cornell boxes, a field of spheres, a material chart, a texture gallery, a studio shot of chrome and glass and Eric Haines's sphereflake.
- **Light and glass:** a glass garden, a swimming pool and a coffee cup's caustics, cut gems, a hall of mirrors, the inside of a mirror ball, sunbeams through a blind, neon, a crystal cave, candlelight, a magnifying glass, a glass of water and a prism.
- **Objects:** a still life, Newton's cradle, chess, bowling, billiards, a Rubik's cube, toy bricks, a pendulum wave, a domino spiral, DNA, an atom and a rocket launch.
- **Places:** an island at sunset, an alpine meadow, sunset on the water, a tiny city by day and by night, the solar system, Stonehenge, a spiral staircase, a low-poly forest (and the same forest on a misty morning), a snowman, a lighthouse, the pyramids and hot-air balloons.
- **Maths:** a Menger sponge, seashells, a Sierpinski tetrahedron, and a Möbius strip, Klein bottle and Dini's surface.

## Using the library

```sh
npm install @stefanskrobanski/raymond
```

```js
import { Camera, Material, Quad, Renderer, Scene, Sky, Sphere, Vec3 } from "@stefanskrobanski/raymond";

const scene = new Scene({ sky: new Sky({ sunStrength: 3 }) });

scene.add(
    new Quad(new Vec3(-10, 0, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20),
        Material.checkered(new Vec3(0.8, 0.8, 0.8), new Vec3(0.2, 0.2, 0.2), 0.5)),
    new Sphere(new Vec3(-0.6, 0.5, 0), 0.5, Material.glass(1.5)),
    new Sphere(new Vec3(0.6, 0.5, 0), 0.5, Material.metal(new Vec3(1.0, 0.78, 0.34), 0.2)));

const renderer = await Renderer.create(document.querySelector("canvas"));
renderer.scene = scene;
renderer.camera = new Camera({ position: new Vec3(0, 1.5, 4), target: new Vec3(0, 0.4, 0) });

async function frame() {
    renderer.render();             // adds renderer.samplesPerFrame paths per pixel
    await renderer.device.queue.onSubmittedWorkDone();   // don't outrun the GPU
    if (renderer.samples < 512)
        requestAnimationFrame(frame);
}
frame();
```

Changing anything that affects the image (the camera, the scene's objects or sky, the canvas size, `maxBounces`, `view`) is noticed on the next `render()`, which starts the average again; `exposure` and `denoise` (on by default) only change how it's shown. Colours are linear RGB from 0 to 1; `hexColor("#ff8800")` converts from CSS's sRGB. [`examples/basic.html`](examples/basic.html) is this example as a page.

To wrap an image round something, give its material a texture; the material's colour tints it:

```js
const earth = await Texture.load("earth.jpg");
scene.add(new Sphere(new Vec3(0, 1, 0), 1, Material.diffuse(new Vec3(1, 1, 1)).withTexture(earth),
    { rotation: Mat4.rotateZ(0.41) }));  // tilt the globe's axis
```

`withTexture(texture, scale)` repeats it `scale` times (a number, or a `Vec2` for across and down) over a sphere, a quad or a mesh's texture coordinates, and `scale` times per unit of length on a box's faces. A mesh takes its texture coordinates as `{ uvs }`, one `Vec2` per vertex.

More, on any material:

```js
// Bumps: heights as fractions of the texture's width.
const dimples = Texture.normalMap(256, 256, (u, v) => 0.01 * Math.sin(u * 40) * Math.sin(v * 40));
const golfBall = Material.plastic(new Vec3(0.9, 0.9, 0.9), 0.3).withNormalMap(dimples);

// Glowing, in a pattern (lights are sampled directly; glowing surfaces aren't).
const screen = Material.diffuse(new Vec3(0, 0, 0)).withEmission(new Vec3(1, 1, 1), 3, await Texture.load("tv.png"));

// Glass that splits colours: the last argument is its Abbe number (lower is more).
const prism = Material.glass(1.65, new Vec3(1, 1, 1), 20);

// Light from an HDR panorama all round, turned a quarter.
scene.sky = Sky.environment(await EnvironmentMap.load("meadow.hdr"), 1.0, Math.PI / 2);

// Haze filling a box: colour (what it scatters rather than absorbs), density, anisotropy.
scene.add(Box.fromCorners(new Vec3(-5, 0, -5), new Vec3(5, 3, 5), Material.volume(new Vec3(0.95, 0.95, 0.95), 0.1, 0.6)));
```

## Running and testing

```sh
python3 -m http.server 8000      # then open http://localhost:8000/
npm ci                           # Playwright and TypeScript, for the tests
npm test                         # unit tests (plain Node) and browser tests (headless Chromium)
npm run typecheck                # the JSDoc types, strictly
```

The browser tests render on WebGPU emulated by SwiftShader and check the GPU against things with exact answers: the CPU raycast through every pixel, white furnace tests (a diffuse ball must reflect exactly its albedo; clear glass must neither gain nor lose light), the direct light from a sphere, a quad and the sun against their closed-form irradiance, light sampling against bouncing on diffuse, plastic and metal, and the denoiser against a converged image.

## Licence

MIT
