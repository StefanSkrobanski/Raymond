# Raymond

A progressive path tracer for WebGPU, in plain JavaScript ES modules with no dependencies and no build step. Each frame adds more light paths through every pixel to a running average, so the image starts grainy and clears up while you watch.

**Live demo:** <https://stefanskrobanski.github.io/Raymond/>. It needs WebGPU: a recent Chrome or Edge, Safari 26, or Firefox 141 on Windows.

## What it does

- **Path tracing in a compute shader**, with next event estimation (aiming rays straight at lights) combined with BSDF sampling by multiple importance sampling, and Russian roulette to end dim paths.
- **Shapes:** spheres, quads (flat parallelograms), boxes under any affine transform (including sticks between two points), and triangle meshes with smooth or flat shading: generated spheres, tori, tubes round any closed curve, solids turned on a lathe, and parametric surfaces. Everything goes in one bounding volume hierarchy, built on the CPU with the surface area heuristic and traversed on the GPU.
- **Materials:** diffuse, metal and plastic (GGX microfacets, from polished to rough), glass (exact Fresnel, refraction, tint), lights, and 3D checkerboards.
- **Lights:** emissive quads and spheres, sampled directly; a sky gradient; a sun with a soft-edged disc.
- **A denoiser** that clears the grain from the first few samples: an edge-avoiding à-trous wavelet filter guided by each pixel's albedo, normal and distance, and steered by an estimate of its noise (as in SVGF), so it backs off as the samples build up and the image still converges to the exact answer.
- **A thin-lens camera** with depth of field, and **inspection views** of albedo, normals and depth.
- **Orbit controls** for mouse, touch and pen, adapted from [Styx](https://github.com/StefanSkrobanski/Styx), whose maths library Raymond also uses.
- **A CPU raycast** with exactly the shader's tests, on the same packed data, for picking (tap to focus) and for testing the GPU.

The demo app has seventeen scenes: two Cornell boxes, a field of spheres, a material chart, a glass garden with caustics, a level-3 Menger sponge, a noise-generated island at sunset, a swimming pool with caustics, cut gems, a still life, Newton's cradle, a hall of mirrors, sunbeams through a blind, seashells, neon signs, a tiny city and a DNA helix.

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

function frame() {
    renderer.render();             // adds renderer.samplesPerFrame paths per pixel
    if (renderer.samples < 512)
        requestAnimationFrame(frame);
}
frame();
```

Changing anything that affects the image (the camera, the scene's objects or sky, the canvas size, `maxBounces`, `view`) is noticed on the next `render()`, which starts the average again; `exposure` and `denoise` (on by default) only change how it's shown. Colours are linear RGB from 0 to 1; `hexColor("#ff8800")` converts from CSS's sRGB. [`examples/basic.html`](examples/basic.html) is this example as a page.

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
