import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile } from "./helpers.mjs";
import { wood } from "./textures.mjs";

/** Each candle: where it stands, how tall it is, and its radius. */
export const CANDLES = [
    { x: -0.5, z: 0.1, height: 0.7, radius: 0.09 },
    { x: -0.15, z: -0.25, height: 1.0, radius: 0.1 },
    { x: 0.25, z: 0.05, height: 0.5, radius: 0.08 },
    { x: 0.55, z: -0.3, height: 0.85, radius: 0.09 },
    { x: 0.05, z: 0.45, height: 0.35, radius: 0.07 },
];

/**
 * Candles burning on a dark table: the only light comes from their small
 * flames, warm and close, glinting in a glass and a brass dish.
 */
export function candlelight() {

    const scene = new Scene({ sky: Sky.black() });
    const wax = Material.plastic(hexColor("#f2e6cf"), 0.5);

    scene.add(
        new Quad(new Vec3(-10, 0, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20), Material.plastic(hexColor("#2b1a12"), 0.3).withTexture(wood(), 6, hexColor("#5a3a26"))),
        new Quad(new Vec3(-10, 0, -1.5), new Vec3(20, 0, 0), new Vec3(0, 6, 0), Material.diffuse(hexColor("#3a2c26"))));

    for (const { x, z, height, radius } of CANDLES) {
        scene.add(
            placed(cylinder(radius, height, wax, 32), x, 0, z),
            // The wick, and its flame: a small, bright, teardrop-ish glow.
            placed(cylinder(0.006, 0.04, Material.diffuse(hexColor("#111111")), 8), x, height, z),
            new Sphere(new Vec3(x, height + 0.075, z), 0.028, Material.light(hexColor("#ffb04a"), 40.0)));
    }

    // A brass dish under one candle, and a wine glass catching the light.
    scene.add(
        Mesh.lathe(profile([[0, 0], [0.22, 0], [0.26, 0.03], [0.24, 0.035], [0.2, 0.01], [0, 0.01]]), Material.metal(hexColor("#e0b05a"), 0.15), { segments: 64 })
            .transformed(Mat4.translate(0.25, 0, 0.05)),
        Mesh.lathe(profile([
            [0, 0], [0.12, 0], [0.12, 0.012], [0.015, 0.02], [0.012, 0.25], [0.06, 0.3], [0.1, 0.4], [0.105, 0.55],
            [0.098, 0.55], [0.094, 0.41], [0.055, 0.31], [0, 0.29],
        ]), Material.glass(1.5), { segments: 64 }).transformed(Mat4.translate(-0.75, 0, -0.45)));

    return {
        scene,
        camera: {
            position: new Vec3(0.2, 0.75, 2.4),
            target: new Vec3(0, 0.45, 0),
            fov: 40 * Math.PI / 180,
            aperture: 0.01,
        },
    };
}

