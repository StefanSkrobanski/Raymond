import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { profile, seededRandom } from "./helpers.mjs";

// A tumbler, 0.5 tall: up the outside, over the rim, down the inside to a
// thick base. The water sits just inside its walls.
export const TUMBLER = profile([[0, 0], [0.2, 0], [0.24, 0.5], [0.225, 0.5], [0.188, 0.06], [0, 0.06]]);
export const WATER = profile([[0, 0.062], [0.185, 0.062], [0.212, 0.38], [0, 0.38]]);

/**
 * A glass of water with ice and a straw, on a table by a window: the straw
 * seems to break at the surface, and the glass throws a bright caustic.
 */
export function glassOfWater() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.3, 0.4, 0.6), horizon: new Vec3(0.7, 0.72, 0.75), ground: new Vec3(0.2, 0.18, 0.16) }),
    });

    scene.add(
        new Quad(new Vec3(-10, 0, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20), Material.diffuse(hexColor("#e8e2d8"))),
        new Quad(new Vec3(-10, 0, -1.2), new Vec3(20, 0, 0), new Vec3(0, 5, 0), Material.diffuse(hexColor("#b8c4c8"))),
        // The window, off to the left and behind, out of shot.
        new Quad(new Vec3(-3, 0.3, 1), new Vec3(0, 0, -2), new Vec3(0, 2, 0), Material.light(new Vec3(1, 0.97, 0.92), 6.0)));

    scene.add(
        Mesh.lathe(TUMBLER, Material.glass(1.5), { segments: 96 }),
        Mesh.lathe(WATER, Material.glass(1.33, hexColor("#eef8ff")), { segments: 96 }));

    // Ice cubes floating at the top.
    const random = seededRandom(4);
    for (let k = 0; k < 3; ++k) {
        const a = k * 2.1 + 0.3;
        scene.add(new Box(
            Mat4.translate(0.08 * Math.cos(a), 0.36, 0.08 * Math.sin(a))
                .multiplyMat4(Mat4.rotateY(random() * 2)).multiplyMat4(Mat4.rotateX(random() - 0.5))
                .multiplyMat4(Mat4.scale(0.045, 0.045, 0.045)),
            Material.glass(1.31, hexColor("#f4fbff"))));
    }

    // The straw, leaning in the glass.
    scene.add(Box.between(new Vec3(-0.08, 0.08, 0.02), new Vec3(0.12, 0.72, -0.05), 0.022, Material.plastic(hexColor("#e2342e"), 0.3)));

    // A lemon beside it.
    scene.add(new Sphere(new Vec3(0.45, 0.09, 0.15), 0.09, Material.plastic(hexColor("#f2d22e"), 0.4)));

    return {
        scene,
        camera: {
            position: new Vec3(0.55, 0.55, 1.45),
            target: new Vec3(0.02, 0.27, 0),
            fov: 38 * Math.PI / 180,
            aperture: 0.006,
        },
        bounces: 16,
    };
}
