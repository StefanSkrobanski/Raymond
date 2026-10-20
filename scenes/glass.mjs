import { Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor } from "./helpers.mjs";

/**
 * Glass under a low sun: a trefoil knot, a gem-cut ball and a smooth ball,
 * throwing coloured caustics on a pale floor.
 */
export function glassGarden() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.12, 0.2, 0.45),
            horizon: new Vec3(0.55, 0.6, 0.7),
            sunStrength: 4.0,
            sunDirection: new Vec3(-0.8, 0.55, -0.35),
            sunColor: new Vec3(1.0, 0.9, 0.75),
            sunSize: 0.06,
        }),
    });

    scene.add(floor(60, Material.checkered(hexColor("#e8e4dc"), hexColor("#cfc9be"), 1.0)));

    // A trefoil knot: going twice round the axis while winding three times
    // through the hole.
    const knot = Mesh.tube((t) => {
        const phi = t * 2.0 * Math.PI;
        const r = Math.cos(3.0 * phi) + 2.0;
        return new Vec3(r * Math.cos(2.0 * phi), r * Math.sin(2.0 * phi), -Math.sin(3.0 * phi));
    }, Material.glass(1.5, hexColor("#8fd3ff")), { radius: 0.42, segments: 300, sides: 28 });

    scene.add(knot.transformed(
        Mat4.translate(0.0, 1.45, 0.0)
            .multiplyMat4(Mat4.rotateX(-0.35))
            .multiplyMat4(Mat4.scale(0.42, 0.42, 0.42))));

    // A faceted ball: an icosphere with flat shading.
    const gem = Mesh.icosphere(Material.glass(2.0, hexColor("#ffb3d1")), 1, { shading: "flat" });
    scene.add(gem.transformed(Mat4.translate(2.0, 0.6, 1.2).multiplyMat4(Mat4.scale(0.6, 0.6, 0.6))));

    scene.add(new Sphere(new Vec3(-2.0, 0.55, 1.4), 0.55, Material.glass(1.5, hexColor("#d6ffb0"))));

    return {
        scene,
        camera: {
            position: new Vec3(1.5, 3.6, 7.5),
            target: new Vec3(0.0, 0.9, 0.3),
            fov: 36.0 * Math.PI / 180.0,
        },
        bounces: 16,
    };
}
