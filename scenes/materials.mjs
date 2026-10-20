import { Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor } from "./helpers.mjs";

/**
 * Every material, and each rough one from polished to rough: gold, then
 * copper, then red plastic, roughness rising left to right, with glass and
 * a lamp at the front.
 */
export function materialChart() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.05, 0.06, 0.08),
            horizon: new Vec3(0.12, 0.12, 0.13),
            ground: new Vec3(0.02, 0.02, 0.02),
        }),
    });

    scene.add(floor(40, Material.checkered(hexColor("#9a9a9a"), hexColor("#3a3a3a"), 0.5)));

    // A big soft light above the camera, and a cool one off to the left,
    // both out of shot.
    scene.add(
        new Quad(new Vec3(-3, 5, 4), new Vec3(6, 0, 0), new Vec3(0, -1.5, 2.5), Material.light(new Vec3(1, 0.97, 0.92), 3.0)),
        new Quad(new Vec3(-7, 1, 1), new Vec3(0, 0, -4), new Vec3(0, 3, 0), Material.light(new Vec3(0.6, 0.75, 1.0), 1.5)));

    const rows = [
        (/** @type {number} */ r) => Material.metal(hexColor("#ffd27a"), r),
        (/** @type {number} */ r) => Material.metal(hexColor("#f4a582"), r),
        (/** @type {number} */ r) => Material.plastic(hexColor("#c0282d"), r),
    ];

    rows.forEach((make, row) => {
        for (let i = 0; i < 6; ++i) {
            const roughness = i / 5;
            scene.add(new Sphere(new Vec3(-2.5 + i, 0.4, -1.0 - row * 1.0), 0.4, make(roughness)));
        }
    });

    scene.add(
        new Sphere(new Vec3(-1.0, 0.4, 0.4), 0.4, Material.glass(1.5)),
        new Sphere(new Vec3(0.0, 0.4, 0.4), 0.4, Material.glass(1.5, hexColor("#9fe0c0"))),
        new Sphere(new Vec3(1.0, 0.4, 0.4), 0.4, Material.diffuse(hexColor("#e0e0e0"))),
        new Sphere(new Vec3(2.0, 0.25, 0.6), 0.25, Material.light(hexColor("#ffb060"), 6.0)));

    return {
        scene,
        camera: {
            position: new Vec3(0.0, 3.2, 5.2),
            target: new Vec3(0.0, 0.2, -1.0),
            fov: 38.0 * Math.PI / 180.0,
        },
    };
}
