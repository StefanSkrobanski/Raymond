import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, Vec3 } from "../../src/index.mjs";
import { assertClose, assertVecClose } from "./helpers.mjs";

test("the camera's axes are unit length, at right angles, and forward faces the target", () => {

    const camera = new Camera({ position: new Vec3(3, 4, 5), target: new Vec3(-1, 0, 2) });
    const { right, up, forward } = camera.basis();

    for (const axis of [right, up, forward])
        assertClose(axis.length(), 1.0, "unit", 1e-9);

    assertClose(right.dot(up), 0.0, "right . up", 1e-9);
    assertClose(up.dot(forward), 0.0, "up . forward", 1e-9);
    assertVecClose(forward, camera.target.subtract(camera.position).normalized());
    assertVecClose(right.cross(up), forward.negate(), "right-handed, looking down -z");
    assert.ok(up.y > 0.0, "up is roughly up");
});

test("the centre ray goes straight ahead, and the edges are at the field of view", () => {

    const camera = new Camera({
        position: new Vec3(0, 0, 0),
        target: new Vec3(0, 0, -1),
        fov: Math.PI / 2,
    });

    assertVecClose(camera.ray(0, 0, 2.0).direction, new Vec3(0, 0, -1));

    // 45 degrees up at the top edge; at aspect 2, atan(2) across at the side.
    assertVecClose(camera.ray(0, 1, 2.0).direction, new Vec3(0, 1, -1).normalized());
    assertVecClose(camera.ray(1, 0, 2.0).direction, new Vec3(2, 0, -1).normalized());
});

test("pixel rays go through pixel centres, counting from the top left", () => {

    const camera = new Camera({ position: new Vec3(0, 0, 0), target: new Vec3(0, 0, -1), fov: Math.PI / 2 });

    const top_left = camera.pixelRay(0, 0, 4, 2).direction;
    const expected = camera.ray(-0.75, 0.5, 2.0).direction;

    assertVecClose(top_left, expected);
});

test("focus distance 0 means the target's distance", () => {

    const camera = new Camera({ position: new Vec3(0, 0, 10), target: new Vec3(0, 0, 4) });
    assertClose(camera.effectiveFocusDistance, 6.0);

    camera.focusDistance = 2.5;
    assertClose(camera.effectiveFocusDistance, 2.5);

    camera.aperture = -1;
    assert.equal(camera.aperture, 0, "no negative apertures");
});
