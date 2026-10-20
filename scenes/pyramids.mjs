import { Mat4, Material, Mesh, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { profile } from "./helpers.mjs";
import { valueNoise } from "./terrain.mjs";

/**
 * A square pyramid on the ground: a four-segment lathe, turned so its
 * sides face the compass points.
 * @param {number} base the length of each side
 * @param {number} height
 * @param {Material} material
 */
export function pyramid(base, height, material) {
    const r = base / Math.SQRT2;
    return Mesh.lathe(profile([[0, 0], [r, 0], [r, 0], [0, height]]), material, { segments: 4, shading: "flat" })
        .transformed(Mat4.rotateY(Math.PI / 4));
}

/** The pyramids of Giza in the afternoon sun, among rippled dunes. */
export function pyramids() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.25, 0.42, 0.8),
            horizon: new Vec3(0.95, 0.85, 0.7),
            ground: new Vec3(0.3, 0.25, 0.18),
            sunStrength: 4.0,
            sunDirection: new Vec3(-0.6, 0.5, 0.35),
            sunColor: new Vec3(1.0, 0.9, 0.75),
            sunSize: 0.04,
        }),
    });

    const noise = valueNoise(99);
    const sand = Material.diffuse(hexColor("#d9b67a"));

    // Dunes, with fine ripples.
    scene.add(Mesh.surface((u, v) => {
        const x = (u - 0.5) * 120, z = (0.5 - v) * 120;
        const y = 1.2 * noise(x * 0.04, z * 0.04) + 0.04 * Math.sin(x * 2.2 + 0.5 * z) - 1.0;
        return new Vec3(x, Math.max(y, -1.6) * (Math.hypot(x, z) < 18 ? 0.25 : 1.0), z);
    }, 160, 160, sand));

    const stone = Material.diffuse(hexColor("#cfae76"));
    scene.add(
        pyramid(9, 6.0, stone).transformed(Mat4.translate(0, -0.3, 0)),
        pyramid(8, 5.5, stone).transformed(Mat4.translate(-11, -0.3, -9)),
        pyramid(4.5, 3.0, Material.diffuse(hexColor("#c9a46c"))).transformed(Mat4.translate(-19, -0.3, -16)));

    return {
        scene,
        camera: {
            position: new Vec3(13, 2.6, -17),
            target: new Vec3(-8, 2.4, -6),
            fov: 45 * Math.PI / 180,
        },
    };
}
