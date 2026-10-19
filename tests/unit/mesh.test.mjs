import { test } from "node:test";
import assert from "node:assert/strict";
import { Mat4, Material, Mesh, Vec3 } from "../../src/index.mjs";
import { assertClose } from "./helpers.mjs";

const WHITE = Material.diffuse(new Vec3(0.8, 0.8, 0.8));

// The volume a mesh encloses, by the divergence theorem: positive if its
// triangles wind anticlockwise seen from outside.
function signedVolume(mesh) {

    const { positions: p, indices: t } = mesh;
    let volume = 0.0;

    for (let i = 0; i < t.length; i += 3)
        volume += p[t[i]].dot(p[t[i + 1]].cross(p[t[i + 2]])) / 6.0;

    return volume;
}

// Closed and consistently wound: every edge is used once in each direction.
function assertWatertight(mesh, name) {

    const edges = new Map();
    const t = mesh.indices;

    for (let i = 0; i < t.length; i += 3) {
        for (let k = 0; k < 3; ++k) {
            const key = `${t[i + k]},${t[i + (k + 1) % 3]}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    }

    for (const [key, count] of edges) {
        const [a, b] = key.split(",");
        assert.equal(count, 1, `${name}: edge ${key} used once`);
        assert.equal(edges.get(`${b},${a}`), 1, `${name}: edge ${key} has a twin`);
    }
}

const knot = (t) => {
    const phi = t * 2.0 * Math.PI;
    const r = Math.cos(3.0 * phi) + 2.0;
    return new Vec3(r * Math.cos(2.0 * phi), r * Math.sin(2.0 * phi), -Math.sin(3.0 * phi));
};

const CLOSED = {
    icosphere: () => Mesh.icosphere(WHITE, 2),
    torus: () => Mesh.torus(WHITE, { radius: 1.0, tube: 0.3, segments: 24, sides: 12 }),
    tube: () => Mesh.tube(knot, WHITE, { radius: 0.3, segments: 90, sides: 10 }),
};

test("closed meshes are watertight and wound outwards", () => {

    for (const [name, make] of Object.entries(CLOSED)) {
        const mesh = make();
        assertWatertight(mesh, name);
        assert.ok(signedVolume(mesh) > 0.0, `${name} winds outwards`);
    }
});

test("the meshes approximate the shapes they're named after", () => {

    // A unit sphere and a torus of radii 1 and 0.3.
    assertClose(signedVolume(Mesh.icosphere(WHITE, 4)), 4.0 / 3.0 * Math.PI, "sphere volume", 0.01);
    assertClose(signedVolume(Mesh.torus(WHITE, { radius: 1.0, tube: 0.3, segments: 96, sides: 48 })),
        2.0 * Math.PI * Math.PI * 1.0 * 0.09, "torus volume", 0.01);

    for (const p of Mesh.icosphere(WHITE, 2).positions)
        assertClose(p.length(), 1.0, "on the sphere");
});

test("a tube's rings stay round and at its radius from the curve", () => {

    const segments = 90;
    const mesh = Mesh.tube(knot, WHITE, { radius: 0.3, segments, sides: 10 });

    // Each ring of vertices is centred on the curve.
    for (let s = 0; s < segments; ++s) {
        const centre = knot(s / segments);
        for (let k = 0; k < 10; ++k)
            assertClose(mesh.positions[s * 10 + k].subtract(centre).length(), 0.3, `ring ${s}`, 1e-9);
    }
});

test("smooth normals are unit length and point outwards", () => {

    for (const [name, make] of Object.entries(CLOSED)) {

        const mesh = make();
        const { positions, indices, normals } = mesh;

        for (const n of normals)
            assertClose(n.length(), 1.0, `${name} normal length`, 1e-9);

        // Each triangle's vertex normals lean the same way as its face.
        for (let i = 0; i < indices.length; i += 3) {
            const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
            const face = positions[b].subtract(positions[a]).cross(positions[c].subtract(positions[a]));
            for (const v of [a, b, c])
                assert.ok(normals[v].dot(face) > 0.0, `${name}: normal ${v} leans out`);
        }
    }
});

test("flat meshes have no vertex normals", () => {
    assert.equal(Mesh.icosphere(WHITE, 1, { shading: "flat" }).normals, null);
});

test("transforming keeps meshes wound outwards, even when mirrored", () => {

    const ball = Mesh.icosphere(WHITE, 1);

    for (const transform of [Mat4.scale(2, 1, 0.5), Mat4.scale(-1, 1, 1), Mat4.translate(3, 0, 0).multiplyMat4(Mat4.rotateX(1))]) {

        const moved = ball.transformed(transform);
        assert.ok(signedVolume(moved) > 0.0, "still outwards");

        // Normals stay perpendicular to the stretched surface.
        const { positions, indices, normals } = moved;
        for (let i = 0; i < indices.length; i += 3) {
            const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
            const face = positions[b].subtract(positions[a]).cross(positions[c].subtract(positions[a])).normalized();
            assert.ok(normals[a].dot(face) > 0.5, "normal near the face's");
        }
    }
});

test("surfaces drop degenerate triangles, such as at a sphere's poles", () => {

    const mesh = Mesh.surface((u, v) => {
        const theta = u * Math.PI, phi = v * 2.0 * Math.PI;
        return new Vec3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    }, 8, 12, WHITE, { vWrap: "closed" });

    // 8 x 12 cells, two triangles each, less one of each pair at each pole.
    assert.equal(mesh.triangleCount, 8 * 12 * 2 - 2 * 12);
});

test("bad meshes are refused", () => {

    const p = [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)];

    assert.throws(() => new Mesh(p, [0, 1], WHITE), RangeError, "not a multiple of 3");
    assert.throws(() => new Mesh(p, [0, 1, 3], WHITE), RangeError, "no vertex 3");
    assert.throws(() => new Mesh(p, [0, 1, 2], WHITE, { normals: [new Vec3(0, 0, 1)] }), RangeError, "too few normals");
});
