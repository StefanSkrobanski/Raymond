import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BVH, Box, Mat4, Material, Mesh, NONE, PRIMITIVE_KINDS, Quad, Scene, Sphere, Vec3,
} from "../../src/index.mjs";
import { assertClose, assertVecClose, random } from "./helpers.mjs";

const WHITE = Material.diffuse(new Vec3(0.8, 0.8, 0.8));
const LAMP = Material.light(new Vec3(1, 1, 1), 5.0);

function prim(packed, i) {
    const f = new Float32Array(packed.primitives, i * 64, 16);
    const u = new Uint32Array(packed.primitives, i * 64, 16);
    return { kind: u[0], material: u[1], light: u[2], normals: u[3], f };
}

test("packing gives one primitive per sphere, quad and box, and per triangle", () => {

    const scene = new Scene().add(
        new Sphere(new Vec3(0, 0, 0), 1, WHITE),
        new Quad(new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, 1), WHITE),
        Box.fromCorners(new Vec3(-1, -1, -1), new Vec3(1, 1, 1), WHITE),
        Mesh.icosphere(WHITE, 1));

    const packed = scene.pack();

    assert.equal(packed.primitiveCount, 3 + 80);
    assert.equal(scene.primitiveCount, 83);
    assert.equal(packed.primitives.byteLength, 83 * 64);
    assert.equal(packed.nodes.byteLength, packed.nodeCount * BVH.NODE_BYTES);
    assert.equal(packed.objects.length, 83);

    const kinds = Array.from({ length: 83 }, (_, i) => prim(packed, i).kind).sort();
    assert.deepEqual(kinds.filter((k) => k == PRIMITIVE_KINDS.triangle).length, 80);
    assert.ok([PRIMITIVE_KINDS.sphere, PRIMITIVE_KINDS.quad, PRIMITIVE_KINDS.box].every((k) => kinds.includes(k)));
});

test("materials are shared, not repeated", () => {

    const red = Material.plastic(new Vec3(1, 0, 0), 0.3);
    const scene = new Scene().add(
        new Sphere(new Vec3(0, 0, 0), 1, red),
        new Sphere(new Vec3(3, 0, 0), 1, red),
        new Sphere(new Vec3(6, 0, 0), 1, WHITE));

    const packed = scene.pack();
    const f = new Float32Array(packed.materials);
    const u = new Uint32Array(packed.materials);
    const r = packed.materialList.indexOf(red);

    assert.equal(packed.materialCount, 2);
    assert.deepEqual([...f.subarray(r * 16, r * 16 + 3)], [1, 0, 0]);
    assert.equal(u[r * 16 + 3], 2, "plastic's type code");
    assertClose(f[r * 16 + 7], 0.3, "roughness", 1e-6);
    assertClose(f[r * 16 + 12], 1.5, "ior", 1e-6);
});

test("only emissive spheres and quads are sampled as lights", () => {

    const scene = new Scene().add(
        new Sphere(new Vec3(0, 5, 0), 1, LAMP),
        new Quad(new Vec3(0, 4, 0), new Vec3(1, 0, 0), new Vec3(0, 0, 1), LAMP),
        Box.fromCorners(new Vec3(-1, -1, -1), new Vec3(1, 1, 1), LAMP),
        new Sphere(new Vec3(0, 0, 0), 1, WHITE),
        new Sphere(new Vec3(4, 0, 0), 1, Material.light(new Vec3(1, 1, 1), 0.0)));

    const packed = scene.pack();

    assert.equal(packed.lights.length, 2);
    for (const [index, p] of [...packed.lights].entries()) {
        const record = prim(packed, p);
        assert.equal(record.light, index, "a light knows its index");
        assert.ok(packed.objects[p] instanceof Sphere || packed.objects[p] instanceof Quad);
    }

    // Everything else says it isn't a light.
    for (let i = 0; i < packed.primitiveCount; ++i) {
        if (![...packed.lights].includes(i))
            assert.equal(prim(packed, i).light, NONE);
    }
});

test("smooth triangles point at their vertex normals; flat ones don't", () => {

    const smooth = Mesh.icosphere(WHITE, 0);
    const flat = Mesh.icosphere(WHITE, 0, { shading: "flat" });
    const packed = new Scene().add(smooth, flat).pack();

    for (let i = 0; i < packed.primitiveCount; ++i) {
        const record = prim(packed, i);
        if (packed.objects[i] === flat) {
            assert.equal(record.normals, NONE);
        }
        else {
            // A unit sphere's vertex normals are its vertices.
            for (let k = 0; k < 3; ++k) {
                const n = packed.normals.subarray((record.normals + k) * 4, (record.normals + k) * 4 + 3);
                const v = record.f.subarray(4 + k * 4, 7 + k * 4);
                [0, 1, 2].forEach((a) => assertClose(n[a], v[a], "normal", 1e-6));
            }
        }
    }
});

test("packing is cached until objects change", () => {

    const scene = new Scene();
    const first = scene.pack();
    assert.equal(scene.pack(), first);

    const version = scene.version;
    const sphere = new Sphere(new Vec3(0, 0, 0), 1, WHITE);
    scene.add(sphere);
    assert.equal(scene.version, version + 1);
    assert.notEqual(scene.pack(), first);

    assert.equal(scene.remove(sphere), true);
    assert.equal(scene.remove(sphere), false);
    assert.equal(scene.pack().primitiveCount, 0);
});

test("an empty scene packs to something bindable that no ray hits", () => {

    const scene = new Scene();
    const packed = scene.pack();

    assert.equal(packed.primitiveCount, 0);
    assert.ok(packed.primitives.byteLength >= 64);
    assert.ok(packed.lights.length >= 1 && packed.normals.length >= 4);
    assert.equal(prim(packed, 0).kind, NONE);
    assert.equal(new Uint32Array(packed.nodes)[7], 1, "the root is a leaf");
    assert.equal(scene.raycast(new Vec3(0, 0, 5), new Vec3(0, 0, -1)), null);
    assert.equal(scene.bounds(), null);
});

test("add only takes scene objects", () => {
    assert.throws(() => new Scene().add(/** @type {any} */ ({})), TypeError);
});

test("a ray hits the near side of a sphere, or the far side from inside", () => {

    const scene = new Scene().add(new Sphere(new Vec3(0, 0, 0), 1, WHITE));

    const outside = scene.raycast(new Vec3(0, 0, 5), new Vec3(0, 0, -1));
    assertClose(outside.distance, 4, "distance", 1e-6);
    assertVecClose(outside.normal, new Vec3(0, 0, 1));
    assert.equal(outside.frontFace, true);

    const inside = scene.raycast(new Vec3(0, 0, 0), new Vec3(1, 0, 0));
    assertClose(inside.distance, 1, "distance", 1e-6);
    assertVecClose(inside.normal, new Vec3(-1, 0, 0), "facing back into the sphere");
    assert.equal(inside.frontFace, false);

    assert.equal(scene.raycast(new Vec3(0, 2, 5), new Vec3(0, 0, -1)), null);
    assert.equal(scene.raycast(new Vec3(0, 0, 5), new Vec3(0, 0, -1), 3.9), null, "beyond maxDistance");
});

test("distances are in units of the direction's length", () => {

    const scene = new Scene().add(new Sphere(new Vec3(0, 0, 0), 1, WHITE));
    const hit = scene.raycast(new Vec3(0, 0, 5), new Vec3(0, 0, -2));

    assertClose(hit.distance, 2, "distance", 1e-6);
    assertVecClose(hit.point, new Vec3(0, 0, 1));
});

test("a quad is hit inside its edges only, from either side", () => {

    const quad = new Quad(new Vec3(-1, 0, 1), new Vec3(2, 0, 0), new Vec3(0, 0, -2), WHITE);
    const scene = new Scene().add(quad);

    assertVecClose(quad.normal, new Vec3(0, 1, 0));
    assertClose(quad.area, 4);

    const above = scene.raycast(new Vec3(0.5, 3, 0.5), new Vec3(0, -1, 0));
    assertClose(above.distance, 3, "distance", 1e-6);
    assert.equal(above.frontFace, true);

    const below = scene.raycast(new Vec3(0.5, -3, 0.5), new Vec3(0, 1, 0));
    assert.equal(below.frontFace, false);
    assertVecClose(below.normal, new Vec3(0, -1, 0));

    assert.equal(scene.raycast(new Vec3(1.5, 3, 0), new Vec3(0, -1, 0)), null);
});

test("a turned, stretched box is hit on the right face", () => {

    // 4 wide, 2 tall and 2 deep, turned 90 degrees about y, so it's 4 deep.
    const transform = Mat4.translate(0, 1, 0)
        .multiplyMat4(Mat4.rotateY(Math.PI / 2))
        .multiplyMat4(Mat4.scale(2, 1, 1));
    const scene = new Scene().add(new Box(transform, WHITE));

    const front = scene.raycast(new Vec3(0, 1, 10), new Vec3(0, 0, -1));
    assertClose(front.distance, 8, "front face at z = 2", 1e-5);
    assertVecClose(front.normal, new Vec3(0, 0, 1));

    const side = scene.raycast(new Vec3(10, 1, 0), new Vec3(-1, 0, 0));
    assertClose(side.distance, 9, "side face at x = 1", 1e-5);
    assertVecClose(side.normal, new Vec3(1, 0, 0));

    const top = scene.raycast(new Vec3(0.5, 10, 1.5), new Vec3(0, -1, 0));
    assertClose(top.distance, 8, "top face at y = 2", 1e-5);
    assertVecClose(top.normal, new Vec3(0, 1, 0));

    const inside = scene.raycast(new Vec3(0, 1, 0), new Vec3(0, 1, 0));
    assertClose(inside.distance, 1, "from inside, the exit", 1e-5);
    assert.equal(inside.frontFace, false);
});

test("smooth triangles interpolate their normals, keeping them on the hit side", () => {

    const ball = Mesh.icosphere(WHITE, 3);
    const scene = new Scene().add(ball);
    const next = random(5);

    for (let n = 0; n < 50; ++n) {

        const target = new Vec3(next() - 0.5, next() - 0.5, next() - 0.5).normalized().scale(0.3);
        const origin = new Vec3(next() - 0.5, next() - 0.5, next() - 0.5).normalized().scale(4);
        const hit = scene.raycast(origin, target.subtract(origin));

        // Near the true sphere's surface and normal.
        assertClose(hit.point.length(), 1.0, "radius", 0.01);
        assert.ok(hit.normal.dot(hit.point.normalized()) > 0.999, "normal close to the sphere's");
        assert.equal(hit.frontFace, true);
    }
});

test("the raycast finds the nearest of many objects, as testing each would", () => {

    const next = random(11);
    const objects = [];

    for (let i = 0; i < 60; ++i) {
        const c = new Vec3(next() * 10 - 5, next() * 10 - 5, next() * 10 - 5);
        const kind = i % 4;
        if (kind == 0)
            objects.push(new Sphere(c, 0.2 + next(), WHITE));
        else if (kind == 1)
            objects.push(new Quad(c, new Vec3(next() * 2, next(), 0), new Vec3(0, next(), next() * 2), WHITE));
        else if (kind == 2)
            objects.push(Box.fromCorners(c, c.add(new Vec3(next() + 0.1, next() + 0.1, next() + 0.1)), WHITE, next() * 3));
        else
            objects.push(Mesh.torus(WHITE, { radius: 0.5, tube: 0.2, segments: 12, sides: 6 }).transformed(Mat4.translate(c.x, c.y, c.z).multiplyMat4(Mat4.rotateX(next() * 3))));
    }

    const scene = new Scene().add(...objects);
    const singles = objects.map((o) => new Scene().add(o));

    for (let n = 0; n < 300; ++n) {

        const origin = new Vec3(next() * 30 - 15, next() * 30 - 15, next() * 30 - 15);
        const direction = new Vec3(next() - 0.5, next() - 0.5, next() - 0.5);

        let best = null;
        for (const single of singles) {
            const hit = single.raycast(origin, direction);
            if (hit && (!best || hit.distance < best.distance))
                best = hit;
        }

        const hit = scene.raycast(origin, direction);

        if (!best) {
            assert.equal(hit, null);
        }
        else {
            assert.ok(hit, "hits something");
            assertClose(hit.distance, best.distance, "nearest distance", 1e-6);
        }
    }
});

test("bounds hold every object", () => {

    const scene = new Scene().add(
        new Sphere(new Vec3(5, 0, 0), 1, WHITE),
        Box.fromCorners(new Vec3(-3, -2, -1), new Vec3(0, 0, 0), WHITE));

    const { min, max } = scene.bounds();

    assert.ok(min.x <= -3 && min.y <= -2 && min.z <= -1);
    assert.ok(max.x >= 6 && max.y >= 1 && max.z >= 1);
    assert.ok(min.x > -3.01 && max.x < 6.01, "and not much more");
});
