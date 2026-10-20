import { Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { seededRandom } from "./helpers.mjs";

/**
 * The nucleus: protons and neutrons packed in a ball, on a Fibonacci
 * spiral so they spread evenly.
 * @param {number} count
 * @returns {Vec3[]}
 */
export function nucleons(count) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: count }, (_, i) => {
        const t = (i + 0.5) / count;
        const r = 0.42 * Math.cbrt(t);
        const y = 1 - 2 * ((i * 0.618034) % 1);
        const ring = Math.sqrt(1 - y * y);
        return new Vec3(Math.cos(i * golden) * ring, y, Math.sin(i * golden) * ring).scale(r);
    });
}

/**
 * The textbook atom: a nucleus of red protons and grey neutrons, circled
 * by glowing electron orbits, each with its electron.
 */
export function atom() {

    const scene = new Scene({
        sky: new Sky({ zenith: hexColor("#0a0f24"), horizon: hexColor("#141b3a"), ground: hexColor("#05070f") }),
    });

    const proton = Material.plastic(hexColor("#e2423c"), 0.15);
    const neutron = Material.plastic(hexColor("#b8bcc6"), 0.15);
    const random = seededRandom(12);

    nucleons(24).forEach((at, i) => scene.add(new Sphere(at.scale(1.25), 0.19, i % 2 == 0 ? proton : neutron)));

    // Three orbits, tilted different ways; each is a thin glowing ring with
    // an electron on it.
    const tilts = [Mat4.rotateX(1.2), Mat4.rotateZ(1.0).multiplyMat4(Mat4.rotateX(0.4)), Mat4.rotateZ(-1.0).multiplyMat4(Mat4.rotateX(-0.5))];
    const colors = ["#3fd0ff", "#7fff9f", "#ffb33f"];
    tilts.forEach((tilt, k) => {
        const glow = Material.light(hexColor(colors[k]), 3.0);
        scene.add(Mesh.torus(glow, { radius: 1.6 + 0.15 * k, tube: 0.012, segments: 128, sides: 8 }).transformed(tilt));
        const a = random() * 2 * Math.PI;
        scene.add(new Sphere(tilt.multiplyVector3(new Vec3((1.6 + 0.15 * k) * Math.cos(a), 0, -(1.6 + 0.15 * k) * Math.sin(a))), 0.08,
            Material.light(hexColor(colors[k]), 8.0)));
    });

    // A key light and a fill, out of shot.
    scene.add(
        new Sphere(new Vec3(-4, 5, 4), 1.0, Material.light(new Vec3(1, 0.97, 0.92), 12.0)),
        new Sphere(new Vec3(5, -2, 2), 0.8, Material.light(hexColor("#8fb0ff"), 3.0)));

    return {
        scene,
        camera: {
            position: new Vec3(0.5, 1.2, 5.6),
            target: new Vec3(0, 0, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
