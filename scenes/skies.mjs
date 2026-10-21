import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile } from "./helpers.mjs";
import { alpine, studio, sunset } from "./environments.mjs";

/**
 * A trefoil knot, centred on the origin, about 1.6 across.
 * @param {number} t 0 to 1 round
 */
export function trefoil(t) {
    const a = t * 2 * Math.PI;
    return new Vec3(Math.sin(a) + 2 * Math.sin(2 * a), Math.cos(a) - 2 * Math.cos(2 * a), -Math.sin(3 * a)).scale(0.28);
}

/**
 * Chrome and glass in a photographer's studio, lit only by its softboxes
 * (an HDR environment map), which every curve of the chrome knot reflects.
 */
export function studioShot() {

    const scene = new Scene({ sky: Sky.environment(studio()) });

    scene.add(
        new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.plastic(hexColor("#141416"), 0.08)),
        Mesh.tube(trefoil, Material.metal(new Vec3(0.95, 0.95, 0.95), 0.0), { radius: 0.13, segments: 384, sides: 32 })
            .transformed(Mat4.translate(0, 0.95, 0).multiplyMat4(Mat4.rotateX(-0.35))),
        new Sphere(new Vec3(-1.45, 0.45, 0.35), 0.45, Material.glass(1.5)),
        new Sphere(new Vec3(1.4, 0.4, 0.45), 0.4, Material.metal(hexColor("#ffcf6e"), 0.12)),
        new Sphere(new Vec3(0.75, 0.25, 1.25), 0.25, Material.plastic(hexColor("#c4161c"), 0.05)),
        new Sphere(new Vec3(-0.6, 0.2, 1.35), 0.2, Material.diffuse(new Vec3(0.85, 0.85, 0.85))));

    return {
        scene,
        camera: {
            position: new Vec3(0.4, 1.6, 4.6),
            target: new Vec3(0, 0.6, 0),
            fov: 40 * Math.PI / 180,
        },
        bounces: 12,
    };
}

/**
 * A meadow in the Alps (an HDR environment map: sun, clouds and snowy
 * peaks), with mirror balls, glass and a few painted balls to show how
 * each takes the light of the sky.
 */
export function alpineMeadow() {

    // Turned a half turn: the highest peaks behind the balls, the sun
    // behind the camera.
    const scene = new Scene({ sky: Sky.environment(alpine(), 1.0, Math.PI) });

    scene.add(
        new Quad(new Vec3(-60, 0, 60), new Vec3(120, 0, 0), new Vec3(0, 0, -120), Material.diffuse(hexColor("#3f5a28"))),
        new Sphere(new Vec3(0, 1.0, 0), 1.0, Material.metal(new Vec3(0.95, 0.95, 0.95), 0.0)),
        new Sphere(new Vec3(-2.1, 0.7, 0.6), 0.7, Material.glass(1.5)),
        new Sphere(new Vec3(2.0, 0.6, 0.8), 0.6, Material.metal(hexColor("#e8946a"), 0.3)),
        new Sphere(new Vec3(1.0, 0.35, 2.0), 0.35, Material.plastic(hexColor("#2a6fd6"), 0.1)),
        new Sphere(new Vec3(-0.9, 0.3, 2.2), 0.3, Material.diffuse(hexColor("#f0eee8"))));

    return {
        scene,
        camera: {
            position: new Vec3(0.6, 1.1, 6.2),
            target: new Vec3(0, 1.2, 0),
            fov: 50 * Math.PI / 180,
        },
    };
}

/**
 * Glass and bronze on still water at sunset (an HDR environment map): the
 * low sun through the glass, and its path across the water.
 */
export function sunsetWater() {

    const scene = new Scene({ sky: Sky.environment(sunset()) });

    // Still water, a slightly rough mirror, and a stone plinth in it.
    scene.add(
        new Quad(new Vec3(-80, 0, 80), new Vec3(160, 0, 0), new Vec3(0, 0, -160), Material.metal(hexColor("#5d6e7a"), 0.06)),
        placed(cylinder(1.6, 0.3, Material.diffuse(hexColor("#6b6258"))), 0, 0, 0));

    // A glass vase, a bronze sphere and a glass orb on the plinth.
    const vase = profile([[0, 0], [0.28, 0], [0.38, 0.35], [0.22, 0.9], [0.26, 1.1], [0.23, 1.1], [0.19, 0.9], [0.34, 0.35], [0.25, 0.04], [0, 0.04]]);
    scene.add(
        placed(Mesh.lathe(vase, Material.glass(1.5, hexColor("#ffd9b0"))), -0.5, 0.3, 0.1),
        new Sphere(new Vec3(0.55, 0.75, -0.2), 0.45, Material.metal(hexColor("#c98a4b"), 0.2)),
        new Sphere(new Vec3(0.35, 0.55, 0.75), 0.25, Material.glass(1.5)));

    return {
        scene,
        camera: {
            position: new Vec3(3.2, 1.3, 3.6),
            target: new Vec3(-0.6, 0.7, -0.6),
            fov: 45 * Math.PI / 180,
        },
        bounces: 12,
    };
}
