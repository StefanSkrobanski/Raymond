import { Material, Mesh, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile, seededRandom } from "./helpers.mjs";
import { valueNoise } from "./terrain.mjs";

// A low-poly fir: three stacked cones, faceted.
const FIR = profile([[0, 0.35], [0.55, 0.35], [0.3, 0.75], [0.45, 0.75], [0.2, 1.15], [0.33, 1.15], [0, 1.6]]);

/**
 * The height of the rolling ground at (x, z).
 * @param {(x: number, z: number) => number} noise
 * @param {number} x
 * @param {number} z
 */
export function groundHeight(noise, x, z) {
    return 0.8 * noise(x * 0.15, z * 0.15) + 0.3 * noise(x * 0.4 + 9, z * 0.4 - 3);
}

/** A low-poly forest of firs on rolling hills, in the slanting light of a winter afternoon. */
export function lowPolyForest() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.3, 0.45, 0.75),
            horizon: new Vec3(0.95, 0.85, 0.75),
            sunStrength: 3.5,
            sunDirection: new Vec3(-0.6, 0.35, 0.4),
            sunColor: new Vec3(1.0, 0.85, 0.7),
            sunSize: 0.04,
        }),
    });

    const noise = valueNoise(23);
    const SIZE = 30;

    // The ground, faceted too.
    scene.add(Mesh.surface((u, v) => {
        const x = (u - 0.5) * SIZE, z = (0.5 - v) * SIZE;
        return new Vec3(x, groundHeight(noise, x, z), z);
    }, 48, 48, Material.diffuse(hexColor("#e8eef2")), { shading: "flat" }));

    const random = seededRandom(31);
    const greens = ["#2f5d3a", "#3b6e3f", "#285040", "#4a7a45"].map((c) => Material.diffuse(hexColor(c)));
    const bark = Material.diffuse(hexColor("#5a3d2b"));

    for (let i = 0; i < 140; ++i) {
        const x = (random() - 0.5) * 22, z = (random() - 0.5) * 22;
        if (Math.hypot(x - 2, z - 3) < 2.2)
            continue; // a clearing in front of the camera
        const y = groundHeight(noise, x, z) - 0.05;
        const s = 0.7 + random() * 0.9;
        scene.add(
            placed(Mesh.lathe(FIR, greens[Math.floor(random() * greens.length)], { segments: 7, shading: "flat" }), x, y, z, s),
            placed(cylinder(0.07, 0.4, bark, 6), x, y, z, s));
    }

    return {
        scene,
        camera: {
            position: new Vec3(4.5, 3.2, 8.5),
            target: new Vec3(-0.5, 0.5, -1.0),
            fov: 45 * Math.PI / 180,
        },
    };
}
