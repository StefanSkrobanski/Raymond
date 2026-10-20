import { Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor, seededRandom } from "./helpers.mjs";

/**
 * A shell grown as a tube that widens as it winds round a spiral, the way
 * real shells add to their open end: u goes round the tube, v along the
 * spiral from the tip. Each turn is scaled by growth, and the spiral drops
 * by drop per unit of radius as it goes (0 for a flat spiral).
 * @param {Material} material
 * @param {{ turns: number, growth: number, drop: number, thickness: number, flare?: number }} shape
 */
export function shell(material, { turns, growth, drop, thickness, flare = 1.0 }) {

    const k = Math.log(growth) / (2.0 * Math.PI);

    return Mesh.surface((u, v) => {

        const theta = v * turns * 2.0 * Math.PI;
        // The spiral's radius, from the tip (near 0) to 1 at the mouth.
        const r = Math.exp(k * (theta - turns * 2.0 * Math.PI));
        const tube = thickness * r * (1.0 + (flare - 1.0) * v ** 8);

        const centre = new Vec3(r * Math.cos(theta), -drop * r, r * Math.sin(theta));
        const outward = new Vec3(Math.cos(theta), 0, Math.sin(theta));
        const phi = u * 2.0 * Math.PI;

        return centre
            .add(outward.scale(tube * Math.cos(phi)))
            .add(new Vec3(0, tube * Math.sin(phi), 0));

    }, 32, Math.round(turns * 48), material, { uWrap: "closed" });
}

/** Seashells on the sand at low tide: a nautilus, a cone shell and a whelk. */
export function seashells() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.2, 0.4, 0.8),
            horizon: new Vec3(0.9, 0.85, 0.8),
            sunStrength: 3.0,
            sunDirection: new Vec3(-0.6, 0.6, 0.5),
            sunSize: 0.06,
        }),
    });

    scene.add(floor(60, Material.diffuse(hexColor("#e2cfa5"))));

    // A nautilus: a flat spiral, standing on its edge.
    const nautilus = shell(Material.plastic(hexColor("#f3e6d2"), 0.25), { turns: 3, growth: 3.0, drop: 0, thickness: 0.36, flare: 1.15 });
    scene.add(nautilus.transformed(Mat4.translate(-0.6, 0.85, 0).multiplyMat4(Mat4.rotateX(Math.PI / 2)).multiplyMat4(Mat4.scale(0.6, 0.6, 0.6))));

    // A tall cone shell, lying on its side.
    const cone = shell(Material.plastic(hexColor("#c98a5a"), 0.3), { turns: 7, growth: 1.35, drop: 4.0, thickness: 0.58 });
    scene.add(cone.transformed(Mat4.translate(0.95, 0.3, 0.9).multiplyMat4(Mat4.rotateZ(1.35)).multiplyMat4(Mat4.rotateY(0.6)).multiplyMat4(Mat4.scale(0.3, 0.3, 0.3))));

    // A squat whelk, mouth up.
    const whelk = shell(Material.plastic(hexColor("#efc7c7"), 0.2), { turns: 4.5, growth: 2.0, drop: 1.6, thickness: 0.48, flare: 1.3 });
    scene.add(whelk.transformed(Mat4.translate(0.4, 0.55, 1.6).multiplyMat4(Mat4.rotateX(Math.PI)).multiplyMat4(Mat4.scale(0.35, 0.35, 0.35))));

    // Pebbles.
    const random = seededRandom(3);
    for (let i = 0; i < 30; ++i) {
        const r = 0.03 + 0.06 * random();
        const at = new Vec3((random() - 0.5) * 6, r * 0.6, (random() - 0.3) * 4);
        scene.add(new Sphere(at, r, Material.plastic(hexColor(random() < 0.5 ? "#8c8c8c" : "#5f5850"), 0.4)));
    }

    return {
        scene,
        camera: {
            position: new Vec3(1.2, 2.2, 4.4),
            target: new Vec3(0.3, 0.4, 0.6),
            fov: 40.0 * Math.PI / 180.0,
            aperture: 0.03,
        },
    };
}
