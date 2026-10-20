import { Box, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { hsv } from "./helpers.mjs";

export const BALL_RADIUS = 0.057;

/**
 * The fifteen racked balls, touching in a triangle with its point towards
 * the cue ball.
 * @returns {Vec3[]}
 */
export function rack() {
    const balls = [];
    const d = 2 * BALL_RADIUS;
    for (let row = 0; row < 5; ++row)
        for (let k = 0; k <= row; ++k)
            balls.push(new Vec3(-0.6 - row * d * Math.sqrt(3) / 2, BALL_RADIUS, (k - row / 2) * d));
    return balls;
}

/** A pool table under its lamp, the balls racked and the cue lined up to break. */
export function billiards() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.02, 0.02, 0.025), horizon: new Vec3(0.03, 0.03, 0.035), ground: new Vec3(0, 0, 0) }),
    });

    const felt = Material.diffuse(hexColor("#1f6b3a"));
    const wood = Material.plastic(hexColor("#4a2511"), 0.2);

    scene.add(
        // The bed, cushions and rails: the playing area is 2.54 by 1.27.
        Box.fromCorners(new Vec3(-1.27, -0.05, -0.635), new Vec3(1.27, 0, 0.635), felt),
        Box.fromCorners(new Vec3(-1.33, -0.05, -0.695), new Vec3(1.33, 0.04, -0.635), felt),
        Box.fromCorners(new Vec3(-1.33, -0.05, 0.635), new Vec3(1.33, 0.04, 0.695), felt),
        Box.fromCorners(new Vec3(-1.33, -0.05, -0.635), new Vec3(-1.27, 0.04, 0.635), felt),
        Box.fromCorners(new Vec3(1.27, -0.05, -0.635), new Vec3(1.33, 0.04, 0.635), felt),
        Box.fromCorners(new Vec3(-1.45, -0.2, -0.815), new Vec3(1.45, 0.05, -0.695), wood),
        Box.fromCorners(new Vec3(-1.45, -0.2, 0.695), new Vec3(1.45, 0.05, 0.815), wood),
        Box.fromCorners(new Vec3(-1.45, -0.2, -0.695), new Vec3(-1.33, 0.05, 0.695), wood),
        Box.fromCorners(new Vec3(1.33, -0.2, -0.695), new Vec3(1.45, 0.05, 0.695), wood),
        new Quad(new Vec3(-20, -0.9, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.diffuse(hexColor("#2b1d18"))));

    // The pockets: black discs at the corners and the middle of the long sides.
    for (const x of [-1.27, 0, 1.27])
        for (const z of [-0.635, 0.635])
            scene.add(new Sphere(new Vec3(x, -0.045, z), 0.07, Material.diffuse(hexColor("#050505"))));

    rack().forEach((at, i) => {
        // The eight ball in the middle of the third row, the rest coloured.
        const material = i == 4 ?
            Material.plastic(hexColor("#111111"), 0.04) :
            Material.plastic(hsv((i * 0.37) % 1, 0.85, 0.85), 0.04);
        scene.add(new Sphere(at, BALL_RADIUS, material));
    });

    const cue_ball = new Vec3(0.75, BALL_RADIUS, 0.05);
    scene.add(
        new Sphere(cue_ball, BALL_RADIUS, Material.plastic(hexColor("#f5f2e8"), 0.04)),
        Box.between(cue_ball.add(new Vec3(0.08, 0.02, 0.005)), cue_ball.add(new Vec3(1.5, 0.3, 0.06)), 0.022, Material.plastic(hexColor("#c89b5e"), 0.3)));

    // The lamp: a long, bright shade over the table, out of shot.
    scene.add(new Quad(new Vec3(-1.0, 1.6, -0.25), new Vec3(2.0, 0, 0), new Vec3(0, 0, 0.5), Material.light(new Vec3(1, 0.95, 0.85), 8.0)));

    return {
        scene,
        camera: {
            position: new Vec3(2.4, 0.75, 1.0),
            target: new Vec3(-0.4, 0.0, -0.05),
            fov: 38 * Math.PI / 180,
            aperture: 0.01,
        },
    };
}
