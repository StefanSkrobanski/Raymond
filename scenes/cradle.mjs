import { Box, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor } from "./helpers.mjs";

export const BALL_RADIUS = 0.25;
const BAR_HEIGHT = 1.9, SPREAD = 0.45, STRING = 1.25;

/**
 * Where each ball hangs: five in a row, touching, with the first lifted
 * out to the side on its strings.
 * @returns {Vec3[]}
 */
export function ballCentres() {

    return [0, 1, 2, 3, 4].map((i) => {
        const x = (i - 2) * 2.0 * BALL_RADIUS;
        // Hanging straight down from the bars, or swung out by 40 degrees.
        const angle = i == 0 ? -40 * Math.PI / 180 : 0.0;
        return new Vec3(x + STRING * Math.sin(angle), BAR_HEIGHT - STRING * Math.cos(angle), 0.0);
    });
}

/** Newton's cradle, mid-swing: chrome balls on strings under a steel frame. */
export function newtonsCradle() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.05, 0.05, 0.06), horizon: new Vec3(0.1, 0.1, 0.11), ground: new Vec3(0.02, 0.02, 0.02) }),
    });

    const steel = Material.metal(hexColor("#c8ccd2"), 0.25);
    const chrome = Material.metal(hexColor("#eef0f2"));
    const thread = Material.diffuse(hexColor("#f0ead8"));

    scene.add(floor(30, Material.plastic(hexColor("#2a2522"), 0.35)));

    // The frame: two uprights at each end, and a bar along each side.
    for (const x of [-1.5, 1.5])
        for (const z of [-SPREAD, SPREAD])
            scene.add(Box.between(new Vec3(x, 0, z), new Vec3(x, BAR_HEIGHT, z), 0.06, steel));
    for (const z of [-SPREAD, SPREAD])
        scene.add(Box.between(new Vec3(-1.53, BAR_HEIGHT, z), new Vec3(1.53, BAR_HEIGHT, z), 0.06, steel));
    scene.add(Box.fromCorners(new Vec3(-1.7, 0, -0.7), new Vec3(1.7, 0.08, 0.7), Material.plastic(hexColor("#141414"), 0.1)));

    // Each ball hangs in a V of two strings, one to each bar.
    const centres = ballCentres();
    centres.forEach((centre, i) => {
        scene.add(new Sphere(centre, BALL_RADIUS, chrome));
        const top = centre.add(new Vec3(0, BALL_RADIUS * 0.9, 0));
        const bar_x = (i - 2) * 2.0 * BALL_RADIUS;
        for (const z of [-SPREAD, SPREAD])
            scene.add(Box.between(top, new Vec3(bar_x, BAR_HEIGHT, z), 0.012, thread));
    });

    // A big soft light overhead, and a strip light high behind for the
    // rims, angled down at the balls; both out of shot.
    scene.add(
        new Quad(new Vec3(-2, 4.5, -0.5), new Vec3(4, 0, 0), new Vec3(0, 0, 3), Material.light(new Vec3(1, 0.98, 0.95), 4.0)),
        new Quad(new Vec3(-3, 3.5, -3), new Vec3(6, 0, 0), new Vec3(0, 1, 1), Material.light(hexColor("#9fc3ff"), 3.0)));

    return {
        scene,
        camera: {
            position: new Vec3(0.8, 1.7, 4.6),
            target: new Vec3(-0.1, 0.9, 0.0),
            fov: 38.0 * Math.PI / 180.0,
        },
        bounces: 10,
    };
}
