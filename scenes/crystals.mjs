import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { hsv, profile, seededRandom } from "./helpers.mjs";

// A crystal: a six-sided prism with a pointed tip, 1 tall and 0.2 across.
// Turned on a lathe with six segments and flat shading.
export const CRYSTAL = profile([[0, 0], [0.1, 0], [0.1, 0], [0.1, 0.8], [0.1, 0.8], [0, 1]]);

/**
 * A cave of crystals: clusters of glowing, tinted glass prisms sprouting
 * from the rock, around a softly glowing pool.
 */
export function crystalCave() {

    const scene = new Scene({
        sky: new Sky({ zenith: hexColor("#1a1030"), horizon: hexColor("#2a1a40"), ground: hexColor("#0a0610") }),
    });
    const random = seededRandom(17);

    scene.add(
        new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.diffuse(hexColor("#2a2530"))),
        new Quad(new Vec3(-20, 0, -4), new Vec3(40, 0, 0), new Vec3(0, 8, 0), Material.diffuse(hexColor("#221e28"))));

    /** @type {[number, number, number, number][]} cluster centre x, z, size, hue */
    const clusters = [[-1.6, -1.2, 1.4, 0.75], [1.5, -1.5, 1.6, 0.55], [0.1, -2.4, 1.1, 0.85], [-2.6, 0.6, 0.9, 0.5], [2.4, 0.4, 0.8, 0.7]];

    for (const [cx, cz, size, hue] of clusters) {
        for (let k = 0; k < 9; ++k) {
            const lean_x = (random() - 0.5) * 1.1, lean_z = (random() - 0.5) * 1.1;
            const s = size * (0.4 + 0.6 * random());
            // Some clear, some milky and opaque, like quartz and amethyst.
            const color = hsv(hue + (random() - 0.5) * 0.08, 0.55, 1.0);
            const material = random() < 0.5 ? Material.glass(1.55, color) : Material.plastic(color, 0.05);
            const crystal = Mesh.lathe(CRYSTAL, material, { segments: 6, shading: "flat" });
            scene.add(crystal.transformed(
                Mat4.translate(cx + (random() - 0.5) * 0.5, -0.05, cz + (random() - 0.5) * 0.5)
                    .multiplyMat4(Mat4.rotateX(lean_z))
                    .multiplyMat4(Mat4.rotateZ(lean_x))
                    .multiplyMat4(Mat4.rotateY(random() * Math.PI))
                    .multiplyMat4(Mat4.scale(s, s * 1.4, s))));
        }
    }

    // Glowing orbs among the crystals light the cave from within.
    scene.add(
        new Sphere(new Vec3(-0.6, 0.3, -0.5), 0.28, Material.light(hexColor("#b49bff"), 8.0)),
        new Sphere(new Vec3(0.9, 0.25, -0.2), 0.22, Material.light(hexColor("#7fe8ff"), 8.0)),
        new Sphere(new Vec3(-2.0, 0.2, -0.1), 0.18, Material.light(hexColor("#ff9be0"), 8.0)),
        // And a shaft of light from a crack high above, out of shot.
        new Sphere(new Vec3(1.0, 9, 1.0), 1.0, Material.light(new Vec3(0.9, 0.95, 1.0), 6.0)));

    return {
        scene,
        camera: {
            position: new Vec3(0.4, 1.7, 4.8),
            target: new Vec3(0, 0.7, -1.0),
            fov: 50 * Math.PI / 180,
        },
        bounces: 16,
    };
}
