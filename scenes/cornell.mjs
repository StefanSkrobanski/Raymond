import { Box, Material, Quad, Scene, Sky, Sphere, Vec3 } from "../src/index.mjs";

const WHITE = Material.diffuse(new Vec3(0.725, 0.71, 0.68));
const RED = Material.diffuse(new Vec3(0.63, 0.065, 0.05));
const GREEN = Material.diffuse(new Vec3(0.14, 0.45, 0.091));
const LAMP = Material.light(new Vec3(17.0, 12.0, 4.0));

const CAMERA = {
    position: new Vec3(0.0, 1.0, 3.85),
    target: new Vec3(0.0, 1.0, 0.0),
    fov: 37.0 * Math.PI / 180.0,
};

// The room: x and z from -1 to 1, y from 0 to 2, open at the front (+z),
// with a lamp in the ceiling shining down.
function room() {

    const scene = new Scene({ sky: Sky.black() });

    scene.add(
        new Quad(new Vec3(-1, 0, 1), new Vec3(2, 0, 0), new Vec3(0, 0, -2), WHITE),   // floor
        new Quad(new Vec3(-1, 2, -1), new Vec3(2, 0, 0), new Vec3(0, 0, 2), WHITE),   // ceiling
        new Quad(new Vec3(-1, 0, -1), new Vec3(2, 0, 0), new Vec3(0, 2, 0), WHITE),   // back
        new Quad(new Vec3(-1, 0, 1), new Vec3(0, 0, -2), new Vec3(0, 2, 0), RED),     // left
        new Quad(new Vec3(1, 0, -1), new Vec3(0, 0, 2), new Vec3(0, 2, 0), GREEN),    // right
        new Quad(new Vec3(-0.25, 1.985, -0.2), new Vec3(0.5, 0, 0), new Vec3(0, 0, 0.4), LAMP));

    return scene;
}

/** The Cornell box: a red and green walled room with two white blocks. */
export function cornellBox() {

    const scene = room().add(
        Box.fromCorners(new Vec3(-0.65, 0.0, -0.6), new Vec3(-0.05, 1.2, 0.0), WHITE, 0.3),
        Box.fromCorners(new Vec3(0.05, 0.0, -0.05), new Vec3(0.65, 0.6, 0.55), WHITE, -0.3));

    return { scene, camera: CAMERA };
}

/** The same room with a glass ball and a mirror ball, for caustics. */
export function cornellSpheres() {

    const scene = room().add(
        new Sphere(new Vec3(-0.45, 0.4, -0.35), 0.4, Material.metal(new Vec3(0.95, 0.95, 0.95))),
        new Sphere(new Vec3(0.45, 0.4, 0.3), 0.4, Material.glass(1.5)));

    return { scene, camera: CAMERA, bounces: 12 };
}
