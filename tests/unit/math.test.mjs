import { test } from "node:test";
import assert from "node:assert/strict";
import { Mat4, Vec3, Vec4 } from "../../src/index.mjs";
import { assertClose, assertMatrixClose, matrixFromRows } from "./helpers.mjs";

// A fixed pseudo-random sequence, so failures are reproducible.
function random(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296 * 20.0 - 10.0;
    };
}

function randomMatrix(next) {
    return new Mat4(...Array.from({ length: 16 }, next));
}

test("multiplyMat4 matches the textbook row-by-column product", () => {

    const next = random(1);

    for (let n = 0; n < 50; ++n) {

        const a = randomMatrix(next);
        const b = randomMatrix(next);
        const product = a.multiplyMat4(b);

        for (let r = 0; r < 4; ++r) {
            for (let c = 0; c < 4; ++c) {

                let expected = 0.0;
                for (let k = 0; k < 4; ++k)
                    expected += a.value(r, k) * b.value(k, c);

                assertClose(product.value(r, c), expected, `[${r}][${c}]`, 1e-9);
            }
        }
    }
});

test("multiplyVector4 multiplies a column vector", () => {

    const m = matrixFromRows([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]);
    const v = m.multiplyVector4(new Vec4(1, 0, -1, 2));

    assert.deepEqual([v.x, v.y, v.z, v.w], [6, 14, 22, 30]);
});

test("inverse undoes a matrix", () => {

    const next = random(2);

    for (let n = 0; n < 50; ++n) {
        const m = randomMatrix(next);
        assertMatrixClose(m.multiplyMat4(m.inverse()), Mat4.identity(), 1e-6);
    }
});

test("translate moves points but not directions", () => {

    const t = Mat4.translate(1, 2, 3);
    const point = t.multiplyVector4(new Vec4(10, 20, 30, 1));
    const direction = t.multiplyVector4(new Vec4(10, 20, 30, 0));

    assert.deepEqual([point.x, point.y, point.z, point.w], [11, 22, 33, 1]);
    assert.deepEqual([direction.x, direction.y, direction.z, direction.w], [10, 20, 30, 0]);
});

test("rotations are rigid and compose by adding angles", () => {

    for (const Rot of [Mat4.rotateX, Mat4.rotateY, Mat4.rotateZ]) {

        const r = Rot(0.7);

        assertClose(r.determinant(), 1.0, "determinant");
        // Orthonormal: the inverse is the transpose.
        for (let i = 0; i < 4; ++i)
            for (let j = 0; j < 4; ++j)
                assertClose(r.inverse().value(i, j), r.value(j, i), `transpose [${i}][${j}]`);

        assertMatrixClose(Rot(0.3).multiplyMat4(Rot(0.4)), Rot(0.7));
    }
});

test("rotations follow the right-hand rule", () => {

    // A quarter turn about each axis takes the next axis round to the one
    // after: x to y about z, y to z about x, z to x about y.
    const cases = [
        [Mat4.rotateZ, new Vec4(1, 0, 0, 0), [0, 1, 0]],
        [Mat4.rotateX, new Vec4(0, 1, 0, 0), [0, 0, 1]],
        [Mat4.rotateY, new Vec4(0, 0, 1, 0), [1, 0, 0]],
    ];

    for (const [rotate, from, to] of cases) {
        const v = rotate(Math.PI / 2.0).multiplyVector4(from);
        assertClose(v.x, to[0], `${rotate.name} x`);
        assertClose(v.y, to[1], `${rotate.name} y`);
        assertClose(v.z, to[2], `${rotate.name} z`);
    }
});

test("inverse throws for a matrix with no inverse", () => {

    assert.throws(() => Mat4.scale(1, 0, 1).inverse(), RangeError);
});

test("value and setValue reject elements outside the matrix", () => {

    const m = Mat4.identity();

    assert.throws(() => m.value(4, 0), RangeError);
    assert.throws(() => m.value(0, -1), RangeError);
    assert.throws(() => m.setValue(0, 4, 1), RangeError);
    assert.throws(() => m.row(4), RangeError);
    assert.throws(() => m.column(-1), RangeError);
});

test("orthographic maps its box to clip space without perspective", () => {

    const o = Mat4.orthographic(-4, 6, -1, 3, 0.5, 50);

    const corners = [
        [new Vec4(-4, -1, -0.5, 1), [-1, -1, -1]],
        [new Vec4(6, 3, -50, 1), [1, 1, 1]],
        [new Vec4(1, 1, -25.25, 1), [0, 0, 0]],
    ];

    for (const [point, expected] of corners) {
        const clip = o.multiplyVector4(point);
        assert.equal(clip.w, 1);
        assertClose(clip.x, expected[0], "x");
        assertClose(clip.y, expected[1], "y");
        assertClose(clip.z, expected[2], "z");
    }
});

test("perspective maps the near and far planes to depth -1 and 1", () => {

    const near = 0.01, far = 1000.0;
    const p = Mat4.perspective(Math.PI / 2.0, 1.5, near, far);

    for (const [z_view, ndc] of [[-near, -1.0], [-far, 1.0]]) {
        const clip = p.multiplyVector4(new Vec4(0, 0, z_view, 1));
        assertClose(clip.z / clip.w, ndc, `z_view ${z_view}`, 1e-9);
        // w is the distance in front of the camera.
        assertClose(clip.w, -z_view, "w");
    }
});

test("perspective keeps the field of view and aspect ratio", () => {

    const p = Mat4.perspective(Math.PI / 2.0, 2.0, 0.1, 100.0);

    // At distance 10, a 90 degree vertical field of view spans y = -10..10
    // and an aspect ratio of 2 spans x = -20..20.
    const top = p.multiplyVector4(new Vec4(0, 10, -10, 1));
    const side = p.multiplyVector4(new Vec4(20, 0, -10, 1));

    assertClose(top.y / top.w, 1.0, "top edge");
    assertClose(side.x / side.w, 1.0, "right edge");
});

test("lookAt places a camera that looks down its -z axis at the target", () => {

    const eye = new Vec3(3, 4, 12);
    const target = new Vec3(0, 1, 0);
    const m = Mat4.lookAt(eye, target, new Vec3(0, 1, 0));

    const origin = m.multiplyVector4(new Vec4(0, 0, 0, 1));
    assert.deepEqual([origin.x, origin.y, origin.z], [eye.x, eye.y, eye.z]);

    const forward = m.multiplyVector4(new Vec4(0, 0, -1, 0));
    const expected = target.subtract(eye).normalized();
    assertClose(forward.x, expected.x, "forward x");
    assertClose(forward.y, expected.y, "forward y");
    assertClose(forward.z, expected.z, "forward z");

    // Camera up has a positive world y component; camera right is level.
    assert.ok(m.multiplyVector4(new Vec4(0, 1, 0, 0)).y > 0.0);
    assertClose(m.multiplyVector4(new Vec4(1, 0, 0, 0)).y, 0.0, "right is level");

    // Right-handed: right x up = back (+z).
    assertClose(m.determinant(), 1.0, "determinant");
});

test("Vec3 arithmetic", () => {

    const a = new Vec3(1, 2, 3);
    const b = new Vec3(4, 5, 6);

    const sum = a.add(b);
    const difference = b.subtract(a);
    const cross = new Vec3(1, 0, 0).cross(new Vec3(0, 1, 0));

    assert.deepEqual([sum.x, sum.y, sum.z], [5, 7, 9]);
    assert.deepEqual([difference.x, difference.y, difference.z], [3, 3, 3]);
    assert.deepEqual([cross.x, cross.y, cross.z], [0, 0, 1]);
    assert.equal(a.dot(b), 32);
    assertClose(new Vec3(3, 4, 12).length(), 13.0);
    assertClose(b.normalized().length(), 1.0);
});

test("Vec4.lerp interpolates every component", () => {

    const v = new Vec4(0, 10, -10, 1).lerp(new Vec4(10, 20, 10, 3), 0.25);

    assert.deepEqual([v.x, v.y, v.z, v.w], [2.5, 12.5, -5, 1.5]);
});

test("Vec3 scales, multiplies, negates and interpolates", () => {

    const a = new Vec3(1, -2, 3);

    const scaled = a.scale(2);
    const product = a.multiply(new Vec3(2, 3, 4));
    const negated = a.negate();
    const between = a.lerp(new Vec3(3, 2, -1), 0.5);

    assert.deepEqual([scaled.x, scaled.y, scaled.z], [2, -4, 6]);
    assert.deepEqual([product.x, product.y, product.z], [2, -6, 12]);
    assert.deepEqual([negated.x, negated.y, negated.z], [-1, 2, -3]);
    assert.deepEqual([between.x, between.y, between.z], [2, 0, 1]);
});

test("multiplyVector3 moves points, and multiplyDirection ignores the translation", () => {

    const next = random(3);

    for (let n = 0; n < 20; ++n) {

        const m = randomMatrix(next);
        const v = new Vec3(next(), next(), next());

        const point = m.multiplyVector4(new Vec4(v.x, v.y, v.z, 1.0));
        const direction = m.multiplyVector4(new Vec4(v.x, v.y, v.z, 0.0));
        const p = m.multiplyVector3(v);
        const d = m.multiplyDirection(v);

        assert.deepEqual([p.x, p.y, p.z].map((x) => x.toFixed(6)), [point.x, point.y, point.z].map((x) => x.toFixed(6)));
        assert.deepEqual([d.x, d.y, d.z].map((x) => x.toFixed(6)), [direction.x, direction.y, direction.z].map((x) => x.toFixed(6)));
    }
});

test("transpose swaps rows and columns", () => {

    const m = matrixFromRows([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]);
    const t = m.transpose();

    for (let r = 0; r < 4; ++r)
        for (let c = 0; c < 4; ++c)
            assert.equal(t.value(r, c), m.value(c, r));
});
