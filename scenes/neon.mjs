import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";

/**
 * A neon tube along a closed curve, centred at (x, y) on the wall.
 * @param {(t: number) => Vec3} curve
 * @param {Vec3} color
 * @param {number} scale
 * @param {Vec3} at
 */
function neon(curve, color, scale, at) {
    return Mesh.tube(curve, Material.light(color, 6.0), { radius: 0.035 / scale, segments: 360, sides: 10 })
        .transformed(Mat4.translate(at.x, at.y, at.z).multiplyMat4(Mat4.scale(scale, scale, scale)));
}

/**
 * Neon signs on a dark brick wall, reflected in a rain-wet floor. The only
 * light is the tubes'.
 */
export function neonNight() {

    const scene = new Scene({ sky: Sky.black() });

    scene.add(
        new Quad(new Vec3(-10, 0, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20), Material.plastic(hexColor("#0d0d10"), 0.06)),
        new Quad(new Vec3(-10, 0, -2), new Vec3(20, 0, 0), new Vec3(0, 6, 0),
            Material.checkered(hexColor("#3a2622"), hexColor("#30201d"), 0.25)));

    const heart = (/** @type {number} */ t) => {
        const a = t * 2.0 * Math.PI;
        return new Vec3(
            16 * Math.sin(a) ** 3,
            13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a),
            0).scale(1 / 16);
    };
    const circle = (/** @type {number} */ t) => new Vec3(Math.cos(t * 2 * Math.PI), Math.sin(t * 2 * Math.PI), 0);
    const lissajous = (/** @type {number} */ t) => new Vec3(Math.sin(3 * t * 2 * Math.PI), Math.sin(2 * t * 2 * Math.PI), 0);

    scene.add(
        neon(heart, hexColor("#ff2d7a"), 0.9, new Vec3(-1.6, 1.9, -1.85)),
        neon(circle, hexColor("#29e6ff"), 0.75, new Vec3(1.4, 2.1, -1.85)),
        neon(lissajous, hexColor("#b6ff3d"), 0.5, new Vec3(1.4, 2.1, -1.8)),
        neon(circle, hexColor("#ffb22e"), 0.3, new Vec3(-0.1, 0.9, -1.85)));

    // Something on the floor to catch the colours.
    scene.add(
        new Sphere(new Vec3(-0.5, 0.35, -0.4), 0.35, Material.metal(hexColor("#e8e8ec"), 0.05)),
        new Sphere(new Vec3(0.55, 0.25, 0.1), 0.25, Material.diffuse(hexColor("#d8d8d8"))));

    return {
        scene,
        camera: {
            position: new Vec3(0.3, 1.1, 4.2),
            target: new Vec3(0.0, 1.2, -1.5),
            fov: 50.0 * Math.PI / 180.0,
        },
        bounces: 8,
    };
}
