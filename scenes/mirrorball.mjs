import { Material, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { marble } from "./textures.mjs";

/**
 * The radius of the mirror the camera is inside. A concave mirror
 * magnifies things near its focus, halfway to its centre, into huge
 * smears; the spheres float near the centre, where their reflections are
 * about their own size.
 */
export const SHELL_RADIUS = 16;

/**
 * The floating spheres: where, how big, and what they're made of. Lamps,
 * glass (clear, tinted, and splitting colours), solids and mirrors, in a
 * loose swirl round the middle, some behind the camera, where only their
 * reflections show. Near a spherical mirror's centre, each thing's
 * reflection is a ghost at its opposite point through the centre, upside
 * down; none of the ghosts comes near the camera, where it would loom.
 */
export function floatingSpheres() {
    return [
        // Lamps.
        { center: new Vec3(-1.6, 1.3, -0.6), radius: 0.28, material: Material.light(hexColor("#ffb066"), 5.0) },
        { center: new Vec3(1.9, -0.9, -1.2), radius: 0.24, material: Material.light(hexColor("#7fb8ff"), 5.0) },
        { center: new Vec3(0.6, 1.9, 1.4), radius: 0.2, material: Material.light(hexColor("#ff7ad0"), 5.0) },
        // Glass.
        { center: new Vec3(-1.0, -1.4, 1.8), radius: 0.45, material: Material.glass(1.5) },
        { center: new Vec3(-1.3, -0.6, 0.9), radius: 0.45, material: Material.glass(1.6, new Vec3(1, 1, 1), 18) },
        // Solids.
        { center: new Vec3(-2.2, 0.3, 1.6), radius: 0.55, material: Material.diffuse(hexColor("#d0402c")) },
        { center: new Vec3(0.2, 1.1, -2.2), radius: 0.5, material: Material.plastic(new Vec3(1, 1, 1), 0.1).withTexture(marble()) },
        // Mirrors.
        { center: new Vec3(2.3, 0.1, -2.6), radius: 0.7, material: Material.metal(hexColor("#ffd27a"), 0.0) },
        // A chrome ball in the middle, showing everything.
        { center: new Vec3(0, 0, 0), radius: 0.75, material: Material.metal(new Vec3(0.95, 0.95, 0.95), 0.0) },
        { center: new Vec3(-0.4, 0.6, 4.4), radius: 0.6, material: Material.metal(hexColor("#e8946a"), 0.25) },
    ];
}

/**
 * Inside a mirror ball: floating spheres of every kind, lamps among them,
 * reflected round and round the silvered inside of a sphere the camera is
 * in, out to infinity.
 */
export function mirrorBall() {

    const scene = new Scene({ sky: Sky.black() });

    // Silvered, losing a little light at each reflection, so the endless
    // reflections fade.
    scene.add(new Sphere(new Vec3(0, 0, 0), SHELL_RADIUS, Material.metal(new Vec3(0.92, 0.93, 0.95), 0.0)));

    for (const { center, radius, material } of floatingSpheres())
        scene.add(new Sphere(center, radius, material));

    return {
        scene,
        camera: {
            position: new Vec3(1.6, 0.7, 3.2),
            target: new Vec3(-0.2, 0, 0),
            fov: 55 * Math.PI / 180,
        },
        bounces: 24,
    };
}
