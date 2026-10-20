import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, Material, Mesh, Quad, Sphere, Vec3 } from "../../src/index.mjs";
import { SCENES } from "../../Scenes.mjs";
import { cornellBox } from "../../scenes/cornell.mjs";
import { mengerSolid, mengerSponge } from "../../scenes/menger.mjs";

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

test("every camera sees the scene and isn't inside anything", () => {

    for (const { demo, scene, camera: options } of built) {

        const camera = new Camera(options);
        let hits = 0;

        // A 9 x 9 grid of rays across the image.
        for (let i = 0; i < 9; ++i) {
            for (let j = 0; j < 9; ++j) {

                const ray = camera.ray(i / 4 - 1, j / 4 - 1, 16 / 9);
                const hit = scene.raycast(ray.origin, ray.direction);
                if (!hit)
                    continue;

                hits++;
                // Seeing the inside of a sphere or a closed glass mesh would
                // mean the camera is in it.
                if (hit.object instanceof Sphere || hit.object instanceof Mesh && hit.material.type == "glass")
                    assert.ok(hit.frontFace, `${demo.id}: camera outside the ${hit.object.constructor.name}`);
            }
        }

        assert.ok(hits > 40, `${demo.id}: the camera sees mostly scene (${hits} of 81 rays hit)`);
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
