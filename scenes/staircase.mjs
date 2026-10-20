import { Box, Mat4, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { marble as marbleTexture } from "./textures.mjs";

export const STEPS = 40;
export const RISE = 0.18;

/**
 * The steps: slabs of marble round an open eye, each turned a little
 * further and set a little higher.
 */
export function steps() {

    const marble = Material.plastic(hexColor("#ece7df"), 0.25).withTexture(marbleTexture(), 1, hexColor("#f4f0ea"));
    const boxes = [];

    for (let i = 0; i < STEPS; ++i) {
        const a = i * 0.32;
        boxes.push(new Box(
            Mat4.translate(0, i * RISE + RISE / 2, 0)
                .multiplyMat4(Mat4.rotateY(a))
                .multiplyMat4(Mat4.translate(1.25, 0, 0))
                .multiplyMat4(Mat4.scale(0.5, RISE / 2, 0.26)),
            marble));
    }

    return boxes;
}

/**
 * A spiral staircase seen from the top of its stairwell, winding down to a
 * checkered floor, lit by the skylight overhead.
 */
export function spiralStaircase() {

    const scene = new Scene({ sky: Sky.black() });

    scene.add(
        new Quad(new Vec3(-3, 0, 3), new Vec3(6, 0, 0), new Vec3(0, 0, -6), Material.checkered(hexColor("#2b2b2b"), hexColor("#d9d4c8"), 0.5)),
        ...steps());

    // The banister: brass balls along the outer edge, joined by rails.
    const brass = Material.metal(hexColor("#e2b866"), 0.2);
    let last = null;
    for (let i = 0; i < STEPS; ++i) {
        const a = i * 0.32;
        const post = new Vec3(0.8 * Math.cos(a), i * RISE + RISE + 0.9, -0.8 * Math.sin(a));
        scene.add(Box.between(new Vec3(post.x, i * RISE + RISE, post.z), post, 0.025, brass));
        if (last)
            scene.add(Box.between(last, post, 0.05, brass));
        last = post;
    }

    // The stairwell's walls, and a skylight high above.
    const wall = Material.diffuse(hexColor("#d8cbb8"));
    scene.add(
        new Quad(new Vec3(-2.2, 0, -2.2), new Vec3(4.4, 0, 0), new Vec3(0, 12, 0), wall),
        new Quad(new Vec3(-2.2, 0, 2.2), new Vec3(0, 0, -4.4), new Vec3(0, 12, 0), wall),
        new Quad(new Vec3(2.2, 0, -2.2), new Vec3(0, 0, 4.4), new Vec3(0, 12, 0), wall),
        new Quad(new Vec3(-2.2, 0, 2.2), new Vec3(4.4, 0, 0), new Vec3(0, 12, 0), wall),
        new Quad(new Vec3(-2.2, 12, -2.2), new Vec3(4.4, 0, 0), new Vec3(0, 0, 4.4), Material.light(new Vec3(1, 0.98, 0.95), 6.0)),
        // A brass ball at the bottom of the eye.
        new Sphere(new Vec3(0, 0.3, 0), 0.3, Material.metal(hexColor("#e2b866"), 0.1)));

    return {
        scene,
        camera: {
            // Looking straight down the stairwell from the top.
            position: new Vec3(0.05, 11.5, 0.1),
            target: new Vec3(0, 0, 0),
            up: new Vec3(0, 0, -1),
            fov: 55 * Math.PI / 180,
        },
    };
}
