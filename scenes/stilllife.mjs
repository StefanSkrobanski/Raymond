import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { profile } from "./helpers.mjs";
import { plaster, wood } from "./textures.mjs";

// Each vessel goes up the outside, over the rim, and down the inside to a
// floor, so it's a closed solid that glass can fill. Heights start at 0.
export const CARAFE = profile([
    [0, 0], [0.3, 0], [0.34, 0.04], [0.36, 0.25], [0.3, 0.5], [0.13, 0.72], [0.1, 0.95], [0.13, 1.0],
    [0.115, 1.0], [0.085, 0.95], [0.115, 0.72], [0.28, 0.5], [0.34, 0.25], [0.32, 0.06], [0.28, 0.03], [0, 0.03],
]);

export const VASE = profile([
    [0, 0], [0.18, 0], [0.24, 0.12], [0.3, 0.35], [0.26, 0.6], [0.16, 0.78], [0.2, 0.88],
    [0.17, 0.88], [0.13, 0.78], [0.23, 0.6], [0.27, 0.35], [0.21, 0.13], [0.15, 0.04], [0, 0.04],
]);

export const BOWL = profile([
    [0, 0], [0.18, 0], [0.32, 0.06], [0.5, 0.2], [0.55, 0.26],
    [0.52, 0.26], [0.47, 0.21], [0.3, 0.09], [0.16, 0.04], [0, 0.04],
]);

/**
 * A still life on a table by a window: a glass carafe, a terracotta vase,
 * a copper bowl of fruit, lit from the side like a Dutch painting.
 */
export function stillLife() {

    const scene = new Scene({ sky: Sky.black() });
    const top = 0.9;

    scene.add(
        // The table and the walls behind.
        Box.fromCorners(new Vec3(-2.2, 0, -1.2), new Vec3(2.2, top, 1.2), Material.plastic(hexColor("#5a3a22"), 0.4).withTexture(wood(), 1, hexColor("#9a7050"))),
        new Quad(new Vec3(-10, 0, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20), Material.diffuse(hexColor("#2e2a26"))),
        new Quad(new Vec3(-10, 0, -2), new Vec3(20, 0, 0), new Vec3(0, 6, 0), Material.diffuse(hexColor("#4a4f45")).withTexture(plaster(), 4, hexColor("#6a7064"))),
        // The window: a tall, bright panel off to the left.
        new Quad(new Vec3(-4, 0.8, 1.5), new Vec3(0, 0, -2.5), new Vec3(0, 2.8, 0), Material.light(hexColor("#fff4e0"), 12.0)),
        // A little fill from the right, so the shadows aren't black.
        new Quad(new Vec3(5, 0.5, -1.5), new Vec3(0, 0, 3), new Vec3(0, 3, 0), Material.light(hexColor("#9ab4ff"), 0.8)));

    scene.add(
        Mesh.lathe(CARAFE, Material.glass(1.5, hexColor("#eafff4")), { segments: 96 }).transformed(Mat4.translate(-0.75, top, -0.25)),
        Mesh.lathe(VASE, Material.plastic(hexColor("#b5532d"), 0.5), { segments: 64 }).transformed(Mat4.translate(0.85, top, -0.5)),
        Mesh.lathe(BOWL, Material.metal(hexColor("#f2a77a"), 0.15), { segments: 96 }).transformed(Mat4.translate(0.05, top, 0.25)));

    // Fruit in and around the bowl.
    scene.add(
        new Sphere(new Vec3(-0.05, top + 0.2, 0.25), 0.16, Material.diffuse(hexColor("#ff8a1c"))),
        new Sphere(new Vec3(0.22, top + 0.2, 0.2), 0.15, Material.plastic(hexColor("#b8141c"), 0.25)),
        new Sphere(new Vec3(0.05, top + 0.22, 0.48), 0.14, Material.plastic(hexColor("#9bc23a"), 0.3)),
        new Sphere(new Vec3(0.75, top + 0.07, 0.55), 0.07, Material.plastic(hexColor("#4a1d5a"), 0.2)),
        new Sphere(new Vec3(0.88, top + 0.07, 0.5), 0.07, Material.plastic(hexColor("#4a1d5a"), 0.2)),
        new Sphere(new Vec3(0.8, top + 0.07, 0.68), 0.07, Material.plastic(hexColor("#4a1d5a"), 0.2)));

    return {
        scene,
        camera: {
            position: new Vec3(0.3, 2.1, 3.6),
            target: new Vec3(0.0, 1.25, 0.0),
            fov: 36.0 * Math.PI / 180.0,
            aperture: 0.02,
        },
        bounces: 12,
    };
}

