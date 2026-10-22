// OrbitControls' walking, without a browser: the canvas only needs to take
// event listeners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, OrbitControls, Vec3 } from "../../src/index.mjs";

const near = (a, b, message) =>
    assert.ok(a.subtract(b).length() < 1e-9, `${message}: (${a.x}, ${a.y}, ${a.z}), not (${b.x}, ${b.y}, ${b.z})`);

function looking(position, target) {
    const camera = new Camera();
    const canvas = /** @type {any} */ (new EventTarget());
    const controls = new OrbitControls(camera, canvas, OrbitControls.viewFrom(position, target));
    return { camera, controls };
}

test("moving walks the camera and the orbit point forward, sideways and up, level", () => {

    // Looking down at the origin from +z, so forward is -z and right is +x.
    const { camera, controls } = looking(new Vec3(0, 3, 4), new Vec3(0, 0, 0));

    controls.move(1, 0);
    near(camera.position, new Vec3(0, 3, 3), "forward, level despite looking down");
    near(controls.view.orbitPoint, new Vec3(0, 0, -1), "the orbit point too");

    controls.move(0, 2);
    near(camera.position, new Vec3(2, 3, 3), "right");

    controls.move(0, 0, 0.5);
    near(camera.position, new Vec3(2, 3.5, 3), "up");
    assert.ok(Math.abs(controls.view.radius - 5) < 1e-9, "at the same distance");
});

test("with collide, moving stops short of a wall", () => {

    const { camera, controls } = looking(new Vec3(0, 1, 4), new Vec3(0, 1, 0));
    // A wall across z = 2.
    controls.collide = (origin, direction, distance) => {
        const t = direction.z < 0 ? (2 - origin.z) / direction.z : Infinity;
        return t >= 0 && t <= distance ? t : Infinity;
    };

    controls.move(5, 0);
    assert.ok(camera.position.z > 2 && camera.position.z < 2.2, `stopped at z = ${camera.position.z}`);

    // Backing away isn't stopped.
    controls.move(-1, 0);
    assert.ok(camera.position.z > 3, `backed away to z = ${camera.position.z}`);
});
