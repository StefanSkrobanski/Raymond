import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { profile } from "./helpers.mjs";

/**
 * A biconvex lens of the given radius, thickness at the middle t: up the
 * curved underside to the rim, then back in over the curved top.
 * @param {number} radius
 * @param {number} t
 */
export function lensProfile(radius, t, steps = 16) {
    const points = [];
    for (let k = 0; k <= steps; ++k) {
        const r = (k / steps) * radius;
        points.push([r, -t / 2 * (1 - (r / radius) ** 2) - 0.004]);
    }
    for (let k = steps; k >= 0; --k) {
        const r = (k / steps) * radius;
        points.push([r, t / 2 * (1 - (r / radius) ** 2) + 0.004]);
    }
    return profile(points);
}

/**
 * A magnifying glass held over a chessboard-patterned cloth in the sun,
 * bending the squares beneath it and focusing the sunlight to a bright spot.
 */
export function magnifyingGlass() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.25, 0.45, 0.85),
            horizon: new Vec3(0.85, 0.9, 1.0),
            sunStrength: 4.0,
            sunDirection: new Vec3(0.15, 1.0, 0.2),
            sunSize: 0.06,
        }),
    });

    scene.add(new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40),
        Material.checkered(hexColor("#f4efe6"), hexColor("#c23b2e"), 0.12)));

    const hold = Mat4.translate(0, 0.75, 0).multiplyMat4(Mat4.rotateZ(0.12)).multiplyMat4(Mat4.rotateX(0.1));
    const brass = Material.metal(hexColor("#d9a84e"), 0.2);

    scene.add(
        Mesh.lathe(lensProfile(0.5, 0.12), Material.glass(1.52), { segments: 96 }).transformed(hold),
        Mesh.torus(brass, { radius: 0.52, tube: 0.03, segments: 96, sides: 16 }).transformed(hold),
        Box.between(hold.multiplyVector3(new Vec3(0.55, 0, 0)), hold.multiplyVector3(new Vec3(0.75, 0, 0)), 0.04, brass),
        Box.between(hold.multiplyVector3(new Vec3(0.75, 0, 0)), hold.multiplyVector3(new Vec3(1.5, 0, 0.05)), 0.09, Material.plastic(hexColor("#3a1f12"), 0.3)));

    return {
        scene,
        camera: {
            position: new Vec3(0.4, 2.0, 2.4),
            target: new Vec3(0.1, 0.25, 0),
            fov: 42 * Math.PI / 180,
        },
        bounces: 10,
    };
}
