import { Box, Mat4, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { planks, planksBumps, plaster, plasterBumps } from "./textures.mjs";

// The room: x and z from -3 to 3, y from 0 to 3, with a window in the
// x = -3 wall from z -1.2 to 1.2 and y 0.7 to 2.5.
const WIN = { z0: -1.2, z1: 1.2, y0: 0.7, y1: 2.5 };

/**
 * The slats of the blind, as boxes: thin, wide, tilted to let the low sun
 * through in bars.
 */
export function slats() {

    const material = Material.plastic(hexColor("#f2efe8"), 0.4);
    const boxes = [];

    for (let y = WIN.y0 + 0.06; y < WIN.y1; y += 0.11) {
        boxes.push(new Box(
            Mat4.translate(-2.92, y, 0)
                .multiplyMat4(Mat4.rotateZ(-0.55))
                .multiplyMat4(Mat4.scale(0.055, 0.004, (WIN.z1 - WIN.z0) / 2)),
            material));
    }

    return boxes;
}

/**
 * A quiet room, lit only by low sun through a Venetian blind: bars of
 * sunlight on the floor and wall, beams of it through the dusty air, and
 * everything else lit by the light they bounce.
 */
export function sunbeams() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.3, 0.5, 0.9),
            horizon: new Vec3(1.0, 0.9, 0.75),
            sunStrength: 10.0,
            sunDirection: new Vec3(-0.8, 0.42, 0.3),
            sunColor: new Vec3(1.0, 0.85, 0.65),
            sunSize: 0.02,
        }),
    });

    const wall = Material.diffuse(new Vec3(1, 1, 1)).withTexture(plaster(), 3).withNormalMap(plasterBumps(), 2);
    const floor = Material.plastic(new Vec3(1, 1, 1), 0.4).withTexture(planks(), 2).withNormalMap(planksBumps());

    scene.add(
        new Quad(new Vec3(-3, 0, 3), new Vec3(6, 0, 0), new Vec3(0, 0, -6), floor),
        new Quad(new Vec3(-3, 3, -3), new Vec3(6, 0, 0), new Vec3(0, 0, 6), wall),            // ceiling
        new Quad(new Vec3(-3, 0, -3), new Vec3(6, 0, 0), new Vec3(0, 3, 0), wall),            // back
        new Quad(new Vec3(3, 0, -3), new Vec3(0, 0, 6), new Vec3(0, 3, 0), wall),             // right
        new Quad(new Vec3(-3, 0, 3), new Vec3(6, 0, 0), new Vec3(0, 3, 0), wall),             // front, behind the camera
        // The window wall, in four pieces round the opening.
        new Quad(new Vec3(-3, 0, -3), new Vec3(0, 0, 6), new Vec3(0, WIN.y0, 0), wall),
        new Quad(new Vec3(-3, WIN.y1, -3), new Vec3(0, 0, 6), new Vec3(0, 3 - WIN.y1, 0), wall),
        new Quad(new Vec3(-3, WIN.y0, -3), new Vec3(0, 0, WIN.z0 + 3), new Vec3(0, WIN.y1 - WIN.y0, 0), wall),
        new Quad(new Vec3(-3, WIN.y0, WIN.z1), new Vec3(0, 0, 3 - WIN.z1), new Vec3(0, WIN.y1 - WIN.y0, 0), wall),
        // The ground outside, so the sky below the sill isn't seen.
        new Quad(new Vec3(-40, -0.01, 40), new Vec3(37, 0, 0), new Vec3(0, 0, -80), Material.diffuse(hexColor("#6c7f4a"))));

    scene.add(...slats());

    // Dust in the air, so the beams show: a faint haze filling the room,
    // scattering mostly onwards, so they glow brightest looking towards
    // the window.
    scene.add(Box.fromCorners(new Vec3(-2.99, 0.01, -2.99), new Vec3(2.99, 2.99, 2.99), Material.volume(new Vec3(0.95, 0.95, 0.95), 0.15, 0.7)));

    // Some furniture to catch the light.
    scene.add(
        Box.fromCorners(new Vec3(-1.6, 0, -0.5), new Vec3(-0.6, 0.45, 0.9), Material.plastic(hexColor("#3b5e7a"), 0.5), 0.2),
        new Sphere(new Vec3(-1.1, 0.75, 0.2), 0.3, Material.plastic(hexColor("#d8452b"), 0.15)),
        Box.fromCorners(new Vec3(0.6, 0, -2.6), new Vec3(2.2, 1.6, -2.1), Material.diffuse(hexColor("#6b4a33"))),
        new Sphere(new Vec3(1.2, 1.85, -2.35), 0.25, Material.glass(1.5)));

    return {
        scene,
        camera: {
            position: new Vec3(2.4, 1.7, 2.6),
            target: new Vec3(-1.6, 0.8, -0.4),
            fov: 55.0 * Math.PI / 180.0,
        },
        bounces: 8,
    };
}
