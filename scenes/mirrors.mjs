import { Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor, hsv } from "./helpers.mjs";

/**
 * Two mirrors facing each other across a row of coloured balls, so the
 * room repeats into the distance: each reflection is one more bounce.
 */
export function hallOfMirrors() {

    const scene = new Scene({ sky: Sky.black() });
    const mirror = Material.metal(new Vec3(0.92, 0.93, 0.95));

    scene.add(
        floor(30, Material.checkered(hexColor("#d8d2c4"), hexColor("#2b2b30"), 0.5)),
        // The mirrors, 4 apart, 3 tall and 10 long, facing each other.
        new Quad(new Vec3(-2, 0, 5), new Vec3(0, 0, -10), new Vec3(0, 3, 0), mirror),
        new Quad(new Vec3(2, 0, -5), new Vec3(0, 0, 10), new Vec3(0, 3, 0), mirror),
        // A dark back wall, and the lamps above.
        new Quad(new Vec3(-2, 0, -5), new Vec3(4, 0, 0), new Vec3(0, 3, 0), Material.diffuse(hexColor("#3a2f45"))),
        // A strip light down the middle of the ceiling, which the mirrors
        // repeat into a row of strips.
        new Quad(new Vec3(-0.15, 3, -5), new Vec3(0.3, 0, 0), new Vec3(0, 0, 10), Material.light(hexColor("#fff3e0"), 6.0)),
        new Sphere(new Vec3(0, 2.4, 0), 0.12, Material.light(hexColor("#d6e6ff"), 30.0)));

    for (let i = 0; i < 7; ++i) {
        const z = -3 + i;
        const radius = 0.22 + 0.06 * (i % 3);
        const material = i % 2 == 0 ?
            Material.plastic(hsv(i / 7, 0.75, 0.9), 0.15) :
            Material.metal(hsv(i / 7, 0.4, 1.0), 0.25);
        scene.add(new Sphere(new Vec3(0.7 * Math.sin(i * 1.3), radius, z), radius, material));
    }

    scene.add(new Sphere(new Vec3(-0.6, 0.5, 2.2), 0.5, Material.glass(1.5)));

    return {
        scene,
        camera: {
            position: new Vec3(1.5, 1.3, 3.8),
            target: new Vec3(-2.0, 1.0, -0.8),
            fov: 50.0 * Math.PI / 180.0,
        },
        bounces: 24,
    };
}
