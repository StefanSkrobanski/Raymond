import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec2, Vec3, hexColor } from "../src/index.mjs";
import { placed, profile } from "./helpers.mjs";
import { planks } from "./textures.mjs";

// A tenpin, 0.38 tall, as a lathe profile.
export const PIN = profile([
    [0, 0], [0.026, 0], [0.04, 0.03], [0.06, 0.1], [0.06, 0.14], [0.05, 0.2], [0.026, 0.26],
    [0.022, 0.29], [0.03, 0.33], [0.028, 0.36], [0.014, 0.38], [0, 0.383],
]);

/**
 * Where the ten pins stand, in a triangle pointing at the bowler, 0.3
 * apart, the head pin at z = 0.
 * @returns {Vec3[]}
 */
export function pinSpots() {
    const spots = [];
    for (let row = 0; row < 4; ++row)
        for (let k = 0; k <= row; ++k)
            spots.push(new Vec3((k - row / 2) * 0.3, 0, -row * 0.26));
    return spots;
}

/** A strike about to happen: a glossy ball rolling at the pins down a polished lane. */
export function bowling() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.02, 0.02, 0.03), horizon: new Vec3(0.04, 0.04, 0.05), ground: new Vec3(0, 0, 0) }),
    });

    // Boards running down the lane, about 39 across it: the planks run
    // along the texture's u, which on the box's top is its own x, so the
    // box is turned to lay its x down the lane.
    const lane = Material.plastic(new Vec3(1, 1, 1), 0.12).withTexture(planks(), new Vec2(0.15, 4.6), hexColor("#ffe2c0"));

    scene.add(
        // The lane, its gutters, and the dark pit beyond.
        new Box(Mat4.translate(0, -0.05, 5).multiplyMat4(Mat4.rotateY(Math.PI / 2)).multiplyMat4(Mat4.scale(7, 0.05, 0.53)), lane),
        Box.fromCorners(new Vec3(-0.75, -0.18, -2), new Vec3(-0.53, -0.08, 12), Material.metal(hexColor("#9aa0a8"), 0.3)),
        Box.fromCorners(new Vec3(0.53, -0.18, -2), new Vec3(0.75, -0.08, 12), Material.metal(hexColor("#9aa0a8"), 0.3)),
        new Quad(new Vec3(-20, -0.2, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.diffuse(hexColor("#141218"))),
        new Quad(new Vec3(-3, -0.2, -2.5), new Vec3(6, 0, 0), new Vec3(0, 3, 0), Material.diffuse(hexColor("#1c1626"))));

    const pin = Mesh.lathe(PIN, Material.plastic(hexColor("#f4f1ea"), 0.12), { segments: 48 });
    for (const spot of pinSpots())
        scene.add(placed(pin, spot.x, 0, spot.z - 0.2, 1.0));

    // A red stripe round each pin's neck: a thin ring.
    const stripe = Mesh.torus(Material.plastic(hexColor("#c41e2a"), 0.15), { radius: 0.024, tube: 0.006, segments: 24, sides: 8 });
    for (const spot of pinSpots())
        scene.add(stripe.transformed(Mat4.translate(spot.x, 0.31, spot.z - 0.2)));

    scene.add(new Sphere(new Vec3(0.08, 0.11, 2.2), 0.11, Material.plastic(hexColor("#3b1d8f"), 0.05)));

    // Lights over the pin deck and the lane, out of shot.
    scene.add(
        new Quad(new Vec3(-0.8, 1.6, -1.2), new Vec3(1.6, 0, 0), new Vec3(0, 0, 0.8), Material.light(new Vec3(1, 0.97, 0.9), 6.0)),
        new Quad(new Vec3(-0.6, 1.8, 4), new Vec3(1.2, 0, 0), new Vec3(0, 0, 2), Material.light(hexColor("#b7c8ff"), 2.5)));

    return {
        scene,
        camera: {
            position: new Vec3(0.25, 0.35, 4.2),
            target: new Vec3(0, 0.15, -0.3),
            fov: 30 * Math.PI / 180,
            aperture: 0.006,
            focusDistance: 4.0,
        },
    };
}
