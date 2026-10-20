# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Raymond is a progressive path tracer for WebGPU, in plain JavaScript ES modules (`.mjs`). It has no runtime dependencies or build step: the browser loads the `.mjs` files directly, and GitHub Pages serves the repo root as the live site. It's a sibling of [Styx](https://github.com/StefanSkrobanski/Styx) (a Canvas 2D wireframe renderer) and follows its conventions; `Vec2`, `Vec3`, `Vec4`, `Mat2`, `Mat3` and `Mat4` were copied from Styx (with additions: `Vec3.scale/multiply/negate/lerp`, `Mat4.multiplyDirection/transpose`, a faster `multiplyVector3`), and `OrbitControls` is adapted from Styx's `CameraTool`.

The repo holds:

- **The library** in `src/`, published to npm as `@stefanskrobanski/raymond` (MIT). `src/index.mjs` is the entry point and the public API; `Mat2`, `Mat3` and `shaders.mjs` are internal. Types are JSDoc comments; TypeScript (a dev dependency only) checks them and generates `types/*.d.mts` when packing (gitignored). Type-only names (`View`, `CameraOptions`, `Hit`, ...) are re-exported from `index.mjs` as `@typedef`s.
- **The demo app** at the root (`index.html`, `main.mjs`, `Settings.mjs`, `Scenes.mjs`, `scenes/`), which imports the library only through `src/index.mjs`. `examples/basic.html` uses it by package name through an import map.

## Commands

```sh
python3 -m http.server 8000      # run: open http://localhost:8000/ (not file://)
npm ci                           # install Playwright and TypeScript
npm test                         # all tests
npm run test:unit                # unit tests only: plain Node, no install needed
npm run test:browser             # headless Chromium on SwiftShader WebGPU (about 2 minutes)
npm run typecheck                # check the library's JSDoc types (strict)
npm run test:types               # build the .d.mts files and type-check tests/types/usage.mts against them
npm pack --dry-run               # see what would be published
node --test --test-name-pattern="furnace" tests/browser/app.test.mjs   # one browser test
```

Tests use Node's built-in runner. Playwright is pinned to an exact version matching the Chromium preinstalled in Claude Code's cloud environment. GitHub Actions (`.github/workflows/test.yml`) runs everything on PRs and pushes to `main`.

**WebGPU in headless Chromium:** only the full Chromium in new headless mode (`channel: "chromium"`) with `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-angle=swiftshader` can present a WebGPU canvas. With other flags, or the headless shell, compute works but `getCurrentTexture()` kills the GPU process ("A valid external Instance reference no longer exists"). The headless shell without flags has no adapter at all, which the no-WebGPU test relies on. SwiftShader is slow (roughly 150k paths per second at 8 bounces), so keep browser-test images small.

## Architecture

Rendering, on the GPU:

1. **`Scene.pack()`** turns the objects into typed arrays, cached until objects are added or removed (`scene.version` counts changes). Every sphere, quad, box and mesh triangle becomes one 64-byte *primitive* (`u32 kind, material, light, normals; vec4 p0, p1, p2`; layout documented on `PackedScene`). Materials are deduplicated into 64-byte records. Emissive spheres and quads go in the `lights` list, which the shader samples directly; emissive boxes and meshes glow but aren't sampled. Buffers are never empty (WebGPU can't bind empty buffers): an empty scene gets a root leaf holding one primitive of kind `NONE`, which nothing hits.
2. **`BVH.build`** (binned SAH, 12 bins, leaves of up to 4) reorders the primitives so each leaf's are contiguous. Nodes are 32 bytes: min, `first`, max, `count`; `count > 0` is a leaf, otherwise the children are `first` and `first + 1`. The shader's traversal stack is 64 deep; a test checks the depth.
3. **`Renderer.render()`** uploads the scene if `scene.version` changed, (re)creates the per-pixel buffers if the canvas size changed, writes the uniforms, dispatches `TRACE_SHADER` (8 × 8 workgroups), then (when denoising the color view) the `DENOISE_SHADER` passes, and draws `DISPLAY_SHADER` (a full-screen triangle: average or denoised, exposure, ACES, sRGB). The accumulation buffer is one `vec4f` per pixel: the colour sum, with the sum of each sample's luminance squared in w. The trace also sums two guide buffers for the denoiser: albedo, and normal with distance in w. The first frame after a reset overwrites instead of adding, so there's no clear. The trace shader uses 8 storage buffers, WebGPU's guaranteed minimum per stage, so a ninth needs packing into an existing one.
4. **The denoiser** (`DENOISE_SHADER`, three entry points sharing one explicit pipeline layout) runs `prepare`, then `atrous` five times with steps 1, 2, 4, 8 and 16 (ping-ponging between two buffers), then `compose`. It filters the light at each surface (the average divided by the guide albedo), so textures stay sharp, and weights neighbours by matching normals and distances and by how much their luminance differs relative to the estimated noise. The noise is the samples' own variance once there are 4 or more, and the spread among similar neighbours before that; each pass blurs it over 3 × 3 pixels first, so a pixel whose few samples agreed doesn't refuse all neighbours and stay a speck. As samples build up the noise estimate falls and the filter backs off, converging to the plain average (a browser test checks this). The guides come from the first surface that isn't a delta lobe, so reflections and refractions keep their edges. A sample with any non-finite value is dropped from the guides too: one NaN there spreads through the passes as black blocks.
5. **Restarting the average is automatic:** the first 168 bytes of the 192-byte uniform block hold everything that decides the image (camera, sky, bounces, clamp, view, size). If they differ from last frame's, `samples` goes back to 0. Exposure, the denoise flag and the per-frame fields come after, so they don't restart it. `tests/unit/shaders.test.mjs` lays out the WGSL structs and checks every offset `Renderer.#writeParams` writes; update both together.

The shader (`src/shaders.mjs`, WGSL in template strings so it loads wherever the library is served or bundled):

- **Paths:** `radiance()` loops `depth = 0..maxBounces`. Each surface does next event estimation (one light chosen uniformly from the lights plus the sun) and then samples the BSDF. Both are weighted by the power heuristic; emission found by a BSDF ray is weighted against `light_pdf()` of the light it hit. Delta lobes (glass, polished metal) skip NEE and count emission fully. At `depth == maxBounces` only emission is counted, so `maxBounces = 1` is exactly direct lighting. Russian roulette starts at depth 3.
- **Materials:** diffuse (cosine sampling), metal (GGX with `alpha = roughness²`, Schlick Fresnel tinted by the colour; roughness under 0.01 is a delta mirror), plastic (a GGX dielectric coat over diffuse, choosing the lobe by `plastic_spec_chance`), glass (exact dielectric Fresnel, tint applied on the way in), light (emits from its front only: `Surface.front`). Non-delta BSDFs return `f·cos` and `pdf` from `eval_bsdf`, and the sample weight is their ratio, so sampling and evaluation can't drift apart.
- **Normals:** `Surface.ng` is the geometric normal and `Surface.n` the shading normal, both flipped to face the incoming ray; `front` says whether the ray hit the outside. Glass relies on meshes winding anticlockwise seen from outside (`Mesh` keeps this, including when `transformed()` mirrors). Directions below the geometric surface are rejected.
- **Ray offsets:** new rays start `1e-4 × max(1, |p|)` off the surface along `ng`, on the side they leave by (`offset()`). Shadow rays measure their reach from that offset origin and stop 0.1% short of the light. Measuring from the surface point instead once made shadow rays hit the light itself and darkened direct light by up to half.
- **Division by zero:** `safe()` replaces zero direction components before taking reciprocals, since GPUs needn't produce consistent infinities. Non-finite samples are dropped (checked via bit patterns, which the compiler can't optimise away).
- **Views:** `albedo`, `normal` and `depth` trace one unjittered ray through each pixel centre, so they match `Camera.pixelRay` and `Scene.raycast` exactly; the browser tests compare them.

On the CPU, `Scene.raycast` mirrors the shader's intersection tests and traversal over the same packed data. When changing an intersection test, change both, and the browser test "the GPU sees what the CPU raycast sees" will catch any mismatch.

### Conventions

- **Maths:** as in Styx. `Mat4` takes its arguments row by row, vectors are columns (`M * v`), `a.multiplyMat4(b)` applies `b` first, rotations follow the right-hand rule, and the camera is right-handed, looking down its −z axis (`Mat4.lookAt`). `Camera.basis()` reads right/up/forward from `lookAt`.
- **Colours** are linear RGB `Vec3`s from 0 to 1 (emission may exceed 1). `hexColor()` converts from sRGB hex.
- **Encapsulation:** private `#fields` with getters; scene objects, materials and skies are immutable (change a scene by adding and removing objects; change a sky with `sky.with({...})` and assign it). `Camera` is mutable.
- **Naming:** the public API is camelCase; private fields and locals are snake_case; settings keys are snake_case (saved in `localStorage` as `raymond-settings`).
- **Types:** every public class, method and parameter has a JSDoc type, checked strictly. TypeScript's DOM library declares the WebGPU interfaces but not the `GPUBufferUsage`/`GPUMapMode` globals, so `Renderer` spells those flag values out. A new public module goes in `src/index.mjs` (`tests/unit/package.test.mjs` checks every module in `src/` is exported, apart from `INTERNAL`).

## The demo app

- **Scenes:** `Scenes.mjs` lists `{ id, name, category, build }` in picker order; the picker groups them by `category` (Classics, Light and glass, Objects, Places, Maths) with `<optgroup>`s. `build()` returns `{ scene, camera, bounces? }`, where `camera` holds `Camera` options and `bounces` is a suggested `maxBounces`, applied when the scene is picked. Scene files live in `scenes/`, with shared helpers in `scenes/helpers.mjs`: `seededRandom`, `floor`, `hsv`, `profile` (lathe points from `[radius, height]` pairs), `cylinder` (sharp-edged, by repeating the rim points so sides and caps don't share normals), `placed`, and `stars`. Stars, and any other small glowing things that shouldn't light the scene, are emissive meshes rather than spheres: emissive spheres and quads are sampled as lights, chosen uniformly, so hundreds of stars would starve the real lights of samples. A lathe profile for a closed solid goes up the outside and back down the inside (a vessel) or ends on the axis; `tests/unit/scenes-more.test.mjs` checks that glass ones wind outwards. `tests/unit/scenes.test.mjs` checks every scene is lit, that its camera sees it from outside, and that no lamp panel is in shot (a quad light seen face-on looks like a floating white rectangle; only the Cornell boxes and the hall of mirrors show theirs on purpose). A quad light shines from its front, along u × v, so work out which way it faces. Add tests for what makes a new scene correct too, in `scenes.test.mjs` or `scenes-more.test.mjs` (the cradle's balls touching, the city standing on the ground, the gems closed for glass, the water inside its tumbler, and so on). Look at every new scene rendered before adding it: lamps facing the wrong way, objects lined up behind each other, clear glass against black (which shows nothing), and caustics too faint to find are the usual problems.
- **Drawing on demand:** `main.mjs` renders while playing and under the sample limit, waiting for `queue.onSubmittedWorkDone()` before sending the next frame, so a slow GPU never builds up a queue. Anything that changes the image calls `invalidate()`, which draws one frame even when paused or done.
- **Sizing:** the canvas's pixel size is its CSS size times the resolution setting (0 means `devicePixelRatio`). On portrait screens the field of view widens, so the scene's fov stays across the narrower side.
- **Tap to focus:** `OrbitControls` fires `tap` (CSS pixels); `main.mjs` raycasts there and sets `camera.focusDistance`, measured along the view direction to match the thin-lens shader. The aperture slider sets the lens radius as a fraction of the focus distance (`APERTURE_SCALE`).
- **Saving:** a WebGPU canvas holds its image only until the frame is presented, so the save button renders and calls `toBlob` in the same task.
- **Errors:** a classic script in `index.html` shows the first error in `#error`, including WebGPU being unavailable or the device being lost.
- **Theme:** `auto`/`light`/`dark` for the panels (the image is on black either way), set on `<html>` as `data-theme` before first paint, as in Styx.
- **Home-screen app:** `manifest.json`, the `apple-mobile-web-app-*` meta tags and `viewport-fit=cover` let it run full screen from a phone's home screen; the panels keep clear of the notch with `env(safe-area-inset-*)`. The icons (`icon-512.png`, `icon-192.png`, `icon-180.png` for Apple) are rendered by Raymond itself: `tools/icon.html` holds the scene and `node tools/render-icons.mjs` renders and saves them (about 3 minutes on SwiftShader). They must be opaque, as iOS fills transparency with black.
- **Tests' hook:** `main.mjs` puts `{ renderer, camera, controls, settings }` on `window.raymond` for the browser tests.
