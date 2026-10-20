import { Box, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { hsv } from "./helpers.mjs";

export const BOBS = 15;
const TOP = 2.2;

/**
 * A pendulum wave, caught mid-swing: fifteen pendulums whose lengths are
 * tuned so the nth swings 25.5 + n / 2 times a minute. Released together,
 * they drift in and out of step, making travelling waves and snakes.
 * @param {number} [time] seconds since release
 * @returns {{ pivot: Vec3, bob: Vec3 }[]}
 */
export function pendulums(time = 15.0) {

    const g = 9.81;
    return Array.from({ length: BOBS }, (_, n) => {
        const frequency = (51 + n) / 120;                               // swings a second
        const length = g / (2 * Math.PI * frequency) ** 2;
        const angle = 0.35 * Math.cos(2 * Math.PI * frequency * time);  // released at 0.35 rad
        const z = (n - (BOBS - 1) / 2) * 0.24;
        const pivot = new Vec3(0, TOP, z);
        return { pivot, bob: pivot.add(new Vec3(length * Math.sin(angle), -length * Math.cos(angle), 0)) };
    });
}

/** A pendulum wave mid-dance, glossy balls tracing a snake through the air. */
export function pendulumWave() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.05, 0.05, 0.07), horizon: new Vec3(0.1, 0.1, 0.12), ground: new Vec3(0.02, 0.02, 0.02) }),
    });

    const steel = Material.metal(hexColor("#c8ccd2"), 0.25);
    const thread = Material.diffuse(hexColor("#f0ead8"));
    const half = (BOBS / 2) * 0.24 + 0.2;

    scene.add(
        new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.plastic(hexColor("#1d1b22"), 0.2)),
        // The frame: a beam on two posts.
        Box.between(new Vec3(0, TOP, -half), new Vec3(0, TOP, half), 0.08, steel),
        Box.between(new Vec3(0, 0, -half), new Vec3(0, TOP + 0.04, -half), 0.08, steel),
        Box.between(new Vec3(0, 0, half), new Vec3(0, TOP + 0.04, half), 0.08, steel));

    pendulums().forEach(({ pivot, bob }, n) => {
        scene.add(
            Box.between(pivot, bob, 0.008, thread),
            new Sphere(bob, 0.1, Material.plastic(hsv(n / BOBS, 0.75, 0.95), 0.08)));
    });

    // An overhead softbox, out of shot.
    scene.add(new Quad(new Vec3(-1.5, 6, -2), new Vec3(3, 0, 0), new Vec3(0, 0, 4), Material.light(new Vec3(1, 0.97, 0.92), 5.0)));

    return {
        scene,
        camera: {
            position: new Vec3(3.6, 1.5, 3.0),
            target: new Vec3(0, 1.1, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
