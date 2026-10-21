import { test } from "node:test";
import assert from "node:assert/strict";
import { Box, Camera, Material, Mesh, Quad, Sphere, Vec3 } from "../../src/index.mjs";
import { SCENES } from "../../Scenes.mjs";
import { buildings } from "../../scenes/city.mjs";
import { cornellBox } from "../../scenes/cornell.mjs";
import { SHELL_RADIUS } from "../../scenes/mirrorball.mjs";
import { BALL_RADIUS, ballCentres } from "../../scenes/cradle.mjs";
import { basePairs } from "../../scenes/dna.mjs";
import { gemMesh } from "../../scenes/gems.mjs";
import { mengerSolid, mengerSponge } from "../../scenes/menger.mjs";
import { swimmingPool, waveHeight } from "../../scenes/pool.mjs";
import { BOWL, CARAFE, VASE } from "../../scenes/stilllife.mjs";

const built = SCENES.map((demo) => ({ demo, ...demo.build() }));

test("every scene has a unique id and builds", () => {

    assert.equal(new Set(SCENES.map((s) => s.id)).size, SCENES.length);

    for (const { demo, scene } of built)
        assert.ok(scene.primitiveCount > 0, `${demo.id} has something in it`);
});

test("every scene is lit", () => {

    for (const { demo, scene } of built) {

        const lamps = scene.objects.some((o) => o.material.emissive);
        const sky = scene.sky;
        const glow = [sky.zenith, sky.horizon].some((c) => c.x + c.y + c.z > 0) || sky.sunStrength > 0;

        assert.ok(lamps || glow, `${demo.id} has a light or a sky`);
    }
});

test("every camera looks at something, from outside it", () => {

    for (const { demo, scene, camera: options } of built) {

        const camera = new Camera(options);
        let centre_hits = 0;

        // A 9 x 9 grid of rays across the image.
        for (let i = 0; i < 9; ++i) {
            for (let j = 0; j < 9; ++j) {

                const ray = camera.ray(i / 4 - 1, j / 4 - 1, 16 / 9);
                const hit = scene.raycast(ray.origin, ray.direction);
                if (!hit)
                    continue;

                if (Math.abs(i - 4) <= 1 && Math.abs(j - 4) <= 1)
                    centre_hits++;

                // Seeing the inside of a sphere or a closed glass mesh would
                // mean the camera is in it: only the mirror ball means that.
                if (demo.id == "mirror-ball" && hit.object instanceof Sphere && hit.object.radius == SHELL_RADIUS)
                    continue;
                if (hit.object instanceof Sphere || hit.object instanceof Mesh && hit.material.type == "glass")
                    assert.ok(hit.frontFace, `${demo.id}: camera outside the ${hit.object.constructor.name}`);
            }
        }

        // Something in the middle of the frame: the camera points at its
        // subject, even one floating in empty space.
        assert.ok(centre_hits > 0, `${demo.id}: nothing in the middle of the frame`);
    }
});

test("the Menger sponge has 20^n cubes and no hidden faces", () => {

    let solid = 0;
    for (let x = 0; x < 27; ++x)
        for (let y = 0; y < 27; ++y)
            for (let z = 0; z < 27; ++z)
                solid += Number(mengerSolid(x, y, z, 3));

    assert.equal(solid, 20 ** 3);

    // Level 1: 20 cubes. Each has 6 faces, less the faces shared with a
    // neighbour: each of the 12 edge cubes touches 2 corners, so 24
    // touching pairs hide 48 faces.
    const sponge = mengerSponge(1, 3, Material.diffuse(new Vec3(1, 1, 1)));
    assert.equal(sponge.triangleCount, (20 * 6 - 48) * 2);
});

test("the Cornell box's lamp shines down into the room", () => {

    const { scene } = cornellBox();
    const lamp = scene.objects.find((o) => o.material.emissive);

    assert.ok(lamp instanceof Quad);
    assert.ok(lamp.normal.y < -0.99);

    // Straight down from the lamp is something facing up: the floor or a
    // block's top, not the inside of a block.
    const below = scene.raycast(lamp.corner.add(lamp.u.scale(0.5)).add(lamp.v.scale(0.5)), new Vec3(0, -1, 0));
    assert.ok(below.frontFace && below.normal.y > 0.99);
});

test("lamp panels stay out of shot, but for the Cornell box's ceiling lamp", () => {

    for (const { demo, scene, camera: options } of built) {

        if (demo.id.startsWith("cornell") || demo.id == "mirrors")
            continue; // their lamps are meant to be seen

        const camera = new Camera(options);
        for (let i = 0; i <= 32; ++i) {
            for (let j = 0; j <= 32; ++j) {
                const ray = camera.ray(i / 16 - 1, j / 16 - 1, 16 / 9);
                const hit = scene.raycast(ray.origin, ray.direction);
                assert.ok(!(hit && hit.object instanceof Quad && hit.material.emissive),
                    `${demo.id}: a lamp panel is in shot at (${i}, ${j})`);
            }
        }
    }
});

test("the cradle's resting balls touch, in a row under the bars", () => {

    const centres = ballCentres();
    for (let i = 1; i + 1 < centres.length; ++i)
        assert.ok(Math.abs(centres[i + 1].subtract(centres[i]).length() - 2 * BALL_RADIUS) < 1e-9);

    // The lifted ball is clear of the next.
    assert.ok(centres[1].subtract(centres[0]).length() > 2 * BALL_RADIUS);
});

test("each DNA base pair spans the helix, its bases meeting in the middle", () => {

    const pairs = basePairs();
    const complement = { A: "T", T: "A", G: "C", C: "G" };

    for (const { a, b, bases } of pairs) {
        assert.equal(complement[bases[0]], bases[1]);
        // 150 degrees apart on a circle of radius 0.8.
        assert.ok(Math.abs(a.subtract(b).length() - 2 * 0.8 * Math.sin(75 * Math.PI / 180)) < 1e-9);
    }
});

test("the city's buildings stand on the ground", () => {

    for (const box of buildings()) {
        const lowest = Math.min(...box.corners().map((c) => c.y));
        assert.ok(lowest >= -1e-9, "nothing below ground");
    }
    assert.ok(buildings().some((b) => Math.max(...b.corners().map((c) => c.y)) > 3), "some towers");
});

test("the gems and vessels are closed solids, wound outwards, as glass needs", () => {

    const glass = Material.glass();
    const meshes = {
        gem: gemMesh(glass),
        carafe: Mesh.lathe(CARAFE, glass),
        vase: Mesh.lathe(VASE, glass),
        bowl: Mesh.lathe(BOWL, glass),
    };

    for (const [name, mesh] of Object.entries(meshes)) {
        let volume = 0;
        const { positions: p, indices: t } = mesh;
        for (let i = 0; i < t.length; i += 3)
            volume += p[t[i]].dot(p[t[i + 1]].cross(p[t[i + 2]])) / 6;
        assert.ok(volume > 0, `${name} winds outwards`);
    }

    // The gem's every edge is shared, so no ray slips through a crack.
    const edges = new Map();
    const t = meshes.gem.indices;
    for (let i = 0; i < t.length; i += 3)
        for (let k = 0; k < 3; ++k) {
            const key = `${t[i + k]},${t[i + (k + 1) % 3]}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    for (const key of edges.keys()) {
        const [a, b] = key.split(",");
        assert.equal(edges.get(`${b},${a}`), 1, `gem edge ${key}`);
    }
});

test("the pool's water fills it, below the deck", () => {

    const { scene } = swimmingPool();
    const water = scene.objects.find((o) => o instanceof Mesh && o.material.type == "glass");

    for (const p of water.positions) {
        assert.ok(p.y < 0 && p.y > -0.3, "the surface is just below the deck");
        assert.ok(Math.abs(p.y - waveHeight(p.x, p.z)) < 1e-9);
    }

    // Straight down through the water is the tiled floor.
    const hit = scene.raycast(new Vec3(0.3, 2, 0.2), new Vec3(0, -1, 0));
    assert.equal(hit.object, water);
});
