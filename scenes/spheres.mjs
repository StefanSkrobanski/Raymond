import { Material, Scene, Sky, Sphere, Vec3 } from "../src/index.mjs";
import { hsv, seededRandom } from "./helpers.mjs";

/**
 * A field of little balls of every material around three big ones: glass,
 * matte and mirror, after the cover of Peter Shirley's "Ray Tracing in One
 * Weekend". Shot with a wide aperture, so the distance blurs.
 */
export function sphereField() {

    const random = seededRandom(42);
    const scene = new Scene({
        sky: new Sky({ sunStrength: 2.5, sunDirection: new Vec3(-0.4, 0.7, 0.6), sunSize: 0.04 }),
    });

    scene.add(new Sphere(new Vec3(0, -1000, 0), 1000,
        Material.checkered(new Vec3(0.35, 0.35, 0.33), new Vec3(0.12, 0.13, 0.12), 1.0)));

    const big = [new Vec3(0, 1, 0), new Vec3(-4, 1, 0), new Vec3(4, 1, 0)];

    for (let a = -11; a < 11; ++a) {
        for (let b = -11; b < 11; ++b) {

            const radius = 0.15 + 0.1 * random();
            const center = new Vec3(a + 0.9 * random(), radius, b + 0.9 * random());
            if (big.some((c) => c.subtract(center).length() < 1.0 + radius))
                continue;

            const choice = random();
            const color = hsv(random(), 0.4 + 0.5 * random(), 0.5 + 0.5 * random());
            let material;

            if (choice < 0.55)
                material = Material.diffuse(color);
            else if (choice < 0.75)
                material = Material.plastic(color, 0.1 + 0.3 * random());
            else if (choice < 0.9)
                material = Material.metal(color.lerp(new Vec3(1, 1, 1), 0.5), 0.3 * random());
            else if (choice < 0.97)
                material = Material.glass(1.5);
            else
                material = Material.light(color, 4.0);

            scene.add(new Sphere(center, radius, material));
        }
    }

    scene.add(
        new Sphere(big[0], 1.0, Material.glass(1.5)),
        new Sphere(big[1], 1.0, Material.diffuse(new Vec3(0.4, 0.2, 0.1))),
        new Sphere(big[2], 1.0, Material.metal(new Vec3(0.7, 0.6, 0.5))));

    return {
        scene,
        camera: {
            position: new Vec3(13, 2, 3),
            target: new Vec3(0, 0.5, 0),
            fov: 22.0 * Math.PI / 180.0,
            aperture: 0.08,
            focusDistance: 10.0,
        },
    };
}
