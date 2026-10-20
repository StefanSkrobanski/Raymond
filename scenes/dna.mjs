import { Box, Mat4, Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";

const RADIUS = 0.8;       // of the helix
const RISE = 0.34;        // between base pairs
const TWIST = Math.PI / 5; // 36 degrees per base pair: ten to a turn
const PAIRS = 18;
const TILT = Mat4.rotateZ(-0.45).multiplyMat4(Mat4.rotateX(0.25));

/**
 * The base pairs: where each one's two backbone atoms are, and which bases
 * they carry.
 * @returns {{ a: Vec3, b: Vec3, bases: [string, string] }[]}
 */
export function basePairs() {

    const codes = "ATGCCGTAATGCGCATTAGCCG";
    const partner = /** @type {Record<string, string>} */ ({ A: "T", T: "A", G: "C", C: "G" });

    return Array.from({ length: PAIRS }, (_, i) => {
        const angle = i * TWIST;
        const y = (i - (PAIRS - 1) / 2) * RISE;
        // The strands are 150 degrees apart round the helix, as in real
        // DNA, which makes the major and minor grooves.
        const strand = (/** @type {number} */ a) => TILT.multiplyVector3(new Vec3(RADIUS * Math.cos(a), y, RADIUS * Math.sin(a)));
        const base = codes[i];
        return { a: strand(angle), b: strand(angle + 150 * Math.PI / 180), bases: [base, partner[base]] };
    });
}

/** A strand of DNA, as a ball-and-stick model, glossy under studio lights. */
export function dna() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.02, 0.03, 0.08), horizon: new Vec3(0.06, 0.08, 0.16), ground: new Vec3(0.01, 0.01, 0.02) }),
    });

    const colors = /** @type {Record<string, Material>} */ ({
        A: Material.plastic(hexColor("#e8413c"), 0.2),
        T: Material.plastic(hexColor("#3c7be8"), 0.2),
        G: Material.plastic(hexColor("#f2c12e"), 0.2),
        C: Material.plastic(hexColor("#3cc47a"), 0.2),
    });
    const backbone = Material.plastic(hexColor("#e8e4f0"), 0.1);
    const bond = Material.metal(hexColor("#b8bcc8"), 0.3);

    const pairs = basePairs();

    pairs.forEach(({ a, b, bases }, i) => {

        scene.add(new Sphere(a, 0.14, backbone), new Sphere(b, 0.14, backbone));

        // Each base reaches halfway across, to meet its partner.
        const middle = a.add(b).scale(0.5);
        scene.add(Box.between(a, middle, 0.09, colors[bases[0]]), Box.between(middle, b, 0.09, colors[bases[1]]));

        // The backbone joins each pair to the next.
        if (i + 1 < pairs.length) {
            scene.add(Box.between(a, pairs[i + 1].a, 0.05, bond), Box.between(b, pairs[i + 1].b, 0.05, bond));
        }
    });

    // Two soft studio lights, out of shot, and a dark floor far below.
    scene.add(
        new Quad(new Vec3(-6, 6, 4), new Vec3(4, 0, 0), new Vec3(0, -2, 2), Material.light(new Vec3(1, 0.96, 0.9), 3.0)),
        new Quad(new Vec3(12, 1, -4), new Vec3(0, 0, 3), new Vec3(1, 3, 0), Material.light(hexColor("#7fa8ff"), 3.5)),
        new Quad(new Vec3(-30, -5, 30), new Vec3(60, 0, 0), new Vec3(0, 0, -60), Material.plastic(hexColor("#0a0b12"), 0.3)));

    return {
        scene,
        camera: {
            position: new Vec3(0.0, 0.6, 9.5),
            target: new Vec3(0.0, 0.0, 0.0),
            fov: 42.0 * Math.PI / 180.0,
            aperture: 0.04,
        },
    };
}
