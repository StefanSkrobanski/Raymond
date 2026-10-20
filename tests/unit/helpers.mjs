import assert from "node:assert/strict";
import { Mat4 } from "../../src/index.mjs";

export const EPSILON = 1e-9;

export function assertClose(actual, expected, message = "", epsilon = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= epsilon,
        `${message} expected ${expected}, got ${actual}`.trim());
}

export function assertMatrixClose(actual, expected, epsilon = EPSILON) {
    for (let r = 0; r < 4; ++r)
        for (let c = 0; c < 4; ++c)
            assertClose(actual.value(r, c), expected.value(r, c), `[${r}][${c}]`, epsilon);
}

export function assertVecClose(actual, expected, message = "", epsilon = 1e-6) {
    assertClose(actual.x, expected.x, `${message} x`, epsilon);
    assertClose(actual.y, expected.y, `${message} y`, epsilon);
    assertClose(actual.z, expected.z, `${message} z`, epsilon);
}

export function matrixFromRows(rows) {
    return new Mat4(...rows.flat());
}

// A fixed pseudo-random sequence from 0 up to 1, so failures are
// reproducible.
export function random(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}
