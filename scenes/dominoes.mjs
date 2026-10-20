import { Box, Mat4, Material, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { hsv } from "./helpers.mjs";

export const COUNT = 220;
const THICK = 0.05, WIDE = 0.2, TALL = 0.4;

/**
 * Where each domino stands on the spiral, which way it faces, and how far
 * it has toppled: the outermost have fallen, a wave of falling runs
 * inwards, and the rest wait.
 * @returns {{ at: Vec3, heading: number, tilt: number }[]}
 */
export function dominoLayout() {

    const layout = [];
    let a = 3.0;

    for (let i = 0; i < COUNT; ++i) {
        // An Archimedean spiral, with the dominoes evenly spaced along it.
        const r = 0.35 * a;
        layout.push({
            at: new Vec3(r * Math.cos(a), 0, -r * Math.sin(a)),
            heading: a,
            // The last 40 have fallen; the 8 before are falling.
            tilt: i >= COUNT - 40 ? 1.25 : i >= COUNT - 48 ? 1.25 * (i - (COUNT - 48)) / 8 : 0,
        });
        a += 0.14 / r;
    }

    return layout;
}

/** Hundreds of dominoes in a spiral, the outer turns already toppled. */
export function dominoSpiral() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.5, 0.6, 0.8), horizon: new Vec3(0.9, 0.9, 0.92), sunStrength: 3, sunDirection: new Vec3(0.4, 0.8, 0.5), sunSize: 0.05 }),
    });

    scene.add(new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.plastic(hexColor("#2c2a33"), 0.3)));

    dominoLayout().forEach(({ at, heading, tilt }, i) => {

        // Face back along the spiral (towards the centre), the way the wave
        // is going, and pivot on the front bottom edge to topple.
        const transform = Mat4.translate(at.x, 0, at.z)
            .multiplyMat4(Mat4.rotateY(heading + Math.PI))
            .multiplyMat4(Mat4.translate(0, 0, -THICK / 2))
            .multiplyMat4(Mat4.rotateX(-tilt))
            .multiplyMat4(Mat4.translate(0, TALL / 2, THICK / 2))
            .multiplyMat4(Mat4.scale(WIDE / 2, TALL / 2, THICK / 2));

        scene.add(new Box(transform, Material.plastic(hsv(i / COUNT, 0.7, 0.95), 0.2)));
    });

    return {
        scene,
        camera: {
            position: new Vec3(4.5, 4.0, 5.5),
            target: new Vec3(0, 0, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
