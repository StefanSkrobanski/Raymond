import { Box, Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { hsv, profile } from "./helpers.mjs";
import { valueNoise } from "./terrain.mjs";

// A balloon's envelope, 1 tall: a teardrop from the mouth up over the
// crown. It's open at the mouth, so it's a shell, not a solid.
const ENVELOPE = [[0.12, 0], [0.2, 0.08], [0.36, 0.3], [0.48, 0.55], [0.5, 0.7], [0.46, 0.85], [0.33, 0.96], [0.12, 1.0], [0, 1.0]];

/**
 * A hot-air balloon of the given size at its basket's position, with its
 * envelope in horizontal bands of colour and its burner alight.
 * @param {Vec3} at
 * @param {number} size
 * @param {number} hue
 */
export function balloon(at, size, hue) {

    const parts = [];
    const lift = 0.35;   // the envelope's mouth is above the basket

    // Each band its own lathe section, alternating colours.
    for (let k = 0; k + 1 < ENVELOPE.length; ++k) {
        const color = k % 2 == 0 ? hsv(hue, 0.85, 0.95) : hsv(hue, 0.15, 1.0);
        const band = Mesh.lathe(profile([ENVELOPE[k], ENVELOPE[k + 1]]), Material.diffuse(color), { segments: 32 });
        parts.push(band.transformed(Mat4.translate(at.x, at.y + lift * size, at.z).multiplyMat4(Mat4.scale(size, size * 1.15, size))));
    }

    // The basket, its ropes, and the burner's flame.
    const wicker = Material.diffuse(hexColor("#8a5a2b"));
    parts.push(Box.fromCorners(at.add(new Vec3(-0.07, -0.1, -0.07).scale(size)), at.add(new Vec3(0.07, 0.0, 0.07).scale(size)), wicker));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        parts.push(Box.between(at.add(new Vec3(dx * 0.06, 0, dz * 0.06).scale(size)), at.add(new Vec3(dx * 0.11, lift, dz * 0.11).scale(size)), 0.004 * size, wicker));
    parts.push(new Sphere(at.add(new Vec3(0, 0.2 * size, 0)), 0.035 * size, Material.light(hexColor("#ffa040"), 20.0)));

    return parts;
}

/** Hot-air balloons drifting over a valley at sunrise. */
export function hotAirBalloons() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.3, 0.45, 0.8),
            horizon: new Vec3(1.0, 0.78, 0.6),
            ground: new Vec3(0.2, 0.18, 0.15),
            sunStrength: 3.5,
            sunDirection: new Vec3(0.7, 0.25, -0.5),
            sunColor: new Vec3(1.0, 0.82, 0.6),
            sunSize: 0.04,
        }),
    });

    const noise = valueNoise(57);
    scene.add(Mesh.surface((u, v) => {
        const x = (u - 0.5) * 200, z = (0.5 - v) * 200;
        // Hills either side of a valley running away from the camera.
        const valley = Math.min(1, Math.abs(x + 0.3 * z) / 30);
        return new Vec3(x, 12 * valley * valley + 4 * noise(x * 0.03, z * 0.03) - 6, z);
    }, 120, 120, Material.diffuse(hexColor("#5f7f3e"))));

    /** @type {[number, number, number, number, number][]} x, y, z, size, hue */
    const flock = [[0, 3, 0, 3.2, 0.0], [-6, 6, -12, 3.0, 0.58], [7, 4.5, -20, 3.4, 0.12], [-12, 8, -30, 3.0, 0.8],
        [3, 9, -42, 3.2, 0.33], [14, 7, -8, 2.6, 0.05], [-3, 11, -60, 3.4, 0.66]];
    for (const [x, y, z, size, hue] of flock)
        scene.add(...balloon(new Vec3(x, y, z), size, hue));

    return {
        scene,
        camera: {
            position: new Vec3(4, 4.5, 14),
            target: new Vec3(-1, 6, -10),
            fov: 50 * Math.PI / 180,
        },
    };
}
