// Normal maps, glowing materials, dispersion and volumes, on the CPU: how
// they're made and packed, and the frames the normal maps tilt in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Box, Mat4, Material, Mesh, NONE, Quad, Scene, Sphere, Texture, Vec2, Vec3 } from "../../src/index.mjs";
import { assertClose } from "./helpers.mjs";

const WHITE = new Vec3(1, 1, 1);

/** A normal map tilting every normal the same way, given as a unit vector. */
const constantNormalMap = (n) => new Texture(1, 1, [n.x, n.y, n.z, 1].map((c) => Math.round((c * 0.5 + 0.5) * 255)).with(3, 255));

test("normal maps are made from heights, tilting away from slopes", () => {

    const flat = Texture.normalMap(4, 4, () => 0.25);
    assert.deepEqual([...flat.data.slice(0, 4)], [128, 128, 255, 255], "flat is straight out");

    // Rising to the right by 0.1 per texture width: the normal leans left.
    const right = Texture.normalMap(64, 64, (u) => 0.1 * u);
    const i = (32 * 64 + 32) * 4;
    assert.deepEqual([...right.data.slice(i, i + 3)], [115, 128, 254]);

    // Rising downwards: the normal leans up.
    const down = Texture.normalMap(64, 64, (u, v) => 0.1 * v);
    assert.deepEqual([...down.data.slice(i, i + 3)], [128, 140, 254]);
});

test("normal maps sample and resize as plain numbers, not sRGB", () => {

    const t = new Texture(1, 1, [64, 128, 255, 255]);
    const raw = t.sample(0.5, 0.5, false);
    assertClose(raw.x, 64 / 255, "red", 1e-9);
    assertClose(raw.y, 128 / 255, "green", 1e-9);
    assert.ok(t.sample(0.5, 0.5).x < 0.06, "as colour, it's decoded from sRGB");
    assert.deepEqual([...t.resized(2, 2, false).data.slice(0, 4)], [64, 128, 255, 255]);
});

test("materials gain bumps, glow and dispersion, keeping everything else", () => {

    const bumps = Texture.normalMap(8, 8, () => 0);
    const pattern = Texture.procedural(2, 2, () => WHITE);
    const base = Material.plastic(new Vec3(0.5, 0.2, 0.1), 0.3).withTexture(pattern, 3, new Vec3(0.9, 0.9, 0.9));

    const bumpy = base.withNormalMap(bumps, 2);
    assert.equal(bumpy.normalMap, bumps);
    assert.equal(bumpy.normalScale, 2);
    assert.equal(bumpy.texture, pattern, "the texture stays");
    assert.equal(bumpy.roughness, 0.3, "and the roughness");
    assert.equal(bumpy.type, "plastic");

    const glowing = bumpy.withEmission(new Vec3(1, 0.5, 0), 4, pattern);
    assert.deepEqual([glowing.emission.x, glowing.emission.y, glowing.emission.z], [4, 2, 0]);
    assert.equal(glowing.emissionTexture, pattern);
    assert.equal(glowing.normalMap, bumps, "the bumps stay");
    assert.ok(glowing.glows && !glowing.emissive, "it glows, but isn't a light to aim at");
    assert.ok(Material.light(WHITE).emissive);

    // Crown glass: n_d 1.5168, Abbe number 64.17, so n_F - n_C = 0.00805.
    const crown = Material.glass(1.5168, WHITE, 64.17);
    assertClose(crown.iorAt(587.6), 1.5168, "n at the d line", 1e-9);
    assertClose(crown.iorAt(486.1) - crown.iorAt(656.3), (1.5168 - 1) / 64.17, "n_F - n_C", 1e-9);
    assert.ok(crown.iorAt(400) > crown.iorAt(700), "blue bends more than red");
    assert.equal(Material.glass(1.5).dispersion, 0, "no Abbe number, no dispersion");
});

test("volumes stay out of the BVH, listed after the surfaces", () => {

    const fog = Material.volume(new Vec3(0.9, 0.9, 0.9), 0.5, 0.3);
    const floor = new Quad(new Vec3(-5, 0, 5), new Vec3(10, 0, 0), new Vec3(0, 0, -10), Material.diffuse(WHITE));
    const ball = new Sphere(new Vec3(0, 1, 0), 1, Material.diffuse(WHITE));
    const cloud = new Sphere(new Vec3(0, 3, 0), 2, fog);
    const haze = Box.fromCorners(new Vec3(-4, 0, -4), new Vec3(4, 3, 4), fog);
    const packed = new Scene().add(cloud, floor, haze, ball).pack();

    assert.equal(packed.primitiveCount, 2, "two surfaces in the BVH");
    assert.deepEqual(packed.volumes, [2, 3], "then the volumes");
    assert.equal(new Float32Array(packed.primitives).length, 4 * 16);

    const f = new Float32Array(packed.materials);
    const m = packed.materialList.indexOf(fog) * 24;
    assertClose(f[m + 20], 0.5, "density", 1e-6);
    assertClose(f[m + 21], 0.3, "anisotropy", 1e-6);

    // Rays go through volumes: the raycast sees the ball inside the cloud.
    const hit = new Scene().add(cloud, ball).raycast(new Vec3(0, 1, 6), new Vec3(0, 0, -1));
    assert.equal(hit?.object, ball);

    assert.throws(() => new Scene().add(Mesh.icosphere(fog, 1)).pack(), /Sphere or a Box/);
    assert.throws(() => new Scene().add(new Quad(new Vec3(), new Vec3(1, 0, 0), new Vec3(0, 1, 0), fog)).pack(), /Sphere or a Box/);
});

test("packed materials say which normal map and emission texture they use", () => {

    const bumps = Texture.normalMap(8, 8, () => 0);
    const pattern = Texture.procedural(2, 2, () => WHITE);
    const a = Material.diffuse(WHITE).withTexture(pattern).withNormalMap(bumps, 1.5);
    const b = Material.light(WHITE).withEmission(WHITE, 2, pattern);
    const packed = new Scene().add(new Sphere(new Vec3(), 1, a), new Sphere(new Vec3(3, 0, 0), 1, b)).pack();

    const f = new Float32Array(packed.materials), u = new Uint32Array(packed.materials);
    const at = (m) => packed.materialList.indexOf(m) * 24;

    assert.deepEqual(packed.textures, [pattern], "colour and emission textures share a list");
    assert.deepEqual(packed.normalMaps, [bumps]);
    assert.equal(u[at(a) + 16], 0);
    assert.equal(f[at(a) + 17], 1.5);
    assert.equal(u[at(a) + 18], NONE);
    assert.equal(u[at(b) + 16], NONE);
    assert.equal(u[at(b) + 18], 0);
});

// For each kind of primitive: a normal map leaning right tilts the normal
// towards increasing u, and one leaning up, towards decreasing v. Which
// way those are is found from the raycast's own texture coordinates,
// nearby.
const SHAPES = {
    sphere: (m) => new Sphere(new Vec3(0, 0, 0), 1, m, { rotation: Mat4.rotateZ(0.5).multiplyMat4(Mat4.rotateY(0.8)) }),
    quad: (m) => new Quad(new Vec3(-1, -1, 0.2), new Vec3(2, 0.3, 0), new Vec3(-0.2, 2, 0.1), m),
    box: (m) => new Box(Mat4.rotateY(0.7).multiplyMat4(Mat4.rotateX(0.5)).multiplyMat4(Mat4.scale(1, 0.8, 0.6)), m),
    torus: (m) => Mesh.torus(m, { radius: 0.7, tube: 0.3 }).transformed(Mat4.rotateX(1.1)),
    // One triangle (a mesh's triangles each have their own barycentric
    // coordinates), without texture coordinates and with mirrored ones.
    triangle: (m) => new Mesh([new Vec3(-1.5, -1, 0), new Vec3(1.5, -0.8, 0.3), new Vec3(-0.2, 1.5, -0.2)], [0, 1, 2], m),
    "mirrored triangle": (m) => new Mesh([new Vec3(-1.5, -1, 0), new Vec3(1.5, -0.8, 0.3), new Vec3(-0.2, 1.5, -0.2)], [0, 1, 2], m,
        { uvs: [new Vec2(1, 1), new Vec2(0, 0.9), new Vec2(0.6, 0)] }),
};

for (const [name, make] of Object.entries(SHAPES)) {

    test(`normal maps tilt the right way on a ${name}`, () => {

        const plain = new Scene().add(make(Material.diffuse(WHITE)));
        const right = new Scene().add(make(Material.diffuse(WHITE).withNormalMap(constantNormalMap(new Vec3(0.6, 0, 0.8)))));
        const up = new Scene().add(make(Material.diffuse(WHITE).withNormalMap(constantNormalMap(new Vec3(0, 0.6, 0.8)))));

        let checked = 0;
        for (const [ox, oy] of [[0, 0], [0.31, 0.12], [-0.25, 0.3], [0.1, -0.35], [-0.4, -0.2], [0.45, 0.4]]) {
            for (const from of [new Vec3(0, 0, 5), new Vec3(3, 3, 3), new Vec3(-4, 1, 2), new Vec3(1, -4, 2)]) {

                const target = new Vec3(ox, oy, 0);
                const ray = (dx, dy) => plain.raycast(from, target.add(new Vec3(dx, dy, 0)).subtract(from));
                const h = ray(0, 0), h1 = ray(1e-3, 0), h2 = ray(0, 1e-3);
                if (!h || !h1 || !h2 || h1.object != h.object || h2.object != h.object)
                    continue;

                // Solve for how the point moves with u and v.
                const e1 = h1.point.subtract(h.point), e2 = h2.point.subtract(h.point);
                const t1 = [h1.uv.x - h.uv.x, h1.uv.y - h.uv.y], t2 = [h2.uv.x - h.uv.x, h2.uv.y - h.uv.y];
                const det = t1[0] * t2[1] - t2[0] * t1[1];
                if (Math.abs(det) < 1e-9 || Math.abs(t1[0]) > 0.1 || Math.abs(t2[0]) > 0.1)
                    continue; // on a seam
                const dpdu = e1.scale(t2[1]).subtract(e2.scale(t1[1])).scale(1 / det).normalized();
                const dpdv = e2.scale(t1[0]).subtract(e1.scale(t2[0])).scale(1 / det).normalized();

                const n = h.normal;
                const leanRight = right.raycast(from, target.subtract(from)).normal.subtract(n);
                const leanUp = up.raycast(from, target.subtract(from)).normal.subtract(n);

                assert.ok(leanRight.length() > 0.3 && leanRight.normalized().dot(dpdu) > 0.8,
                    `${name}: leaning right tilts towards increasing u (${leanRight.normalized().dot(dpdu)})`);
                assert.ok(leanUp.length() > 0.3 && leanUp.normalized().dot(dpdv.negate()) > 0.8,
                    `${name}: leaning up tilts towards decreasing v (${leanUp.normalized().dot(dpdv.negate())})`);
                checked++;
            }
        }

        assert.ok(checked >= 4, `${checked} points checked`);
    });
}
