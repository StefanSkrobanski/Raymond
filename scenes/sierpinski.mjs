import { Mat4, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";

/**
 * A Sierpinski tetrahedron: a tetrahedron replaced by four half-size
 * copies at its corners, again and again. Returns one flat-shaded mesh of
 * all the little tetrahedra, each wound outwards.
 * @param {number} level
 * @param {Material} material
 */
export function sierpinski(level, material) {

    /** @type {Vec3[]} */
    const positions = [];
    /** @type {number[]} */
    const indices = [];

    /** @param {Vec3[]} corners */
    const tetrahedron = (corners) => {
        const [a, b, c, d] = corners;
        const k = positions.length;
        positions.push(a, b, c, d);
        // Each face wound so its normal points away from the opposite corner.
        for (const [i, j, l, opposite] of [[0, 1, 2, 3], [0, 3, 1, 2], [0, 2, 3, 1], [1, 3, 2, 0]]) {
            const n = corners[j].subtract(corners[i]).cross(corners[l].subtract(corners[i]));
            const outward = n.dot(corners[opposite].subtract(corners[i])) < 0;
            indices.push(k + i, ...(outward ? [k + j, k + l] : [k + l, k + j]));
        }
    };

    /**
     * @param {Vec3[]} corners
     * @param {number} depth
     */
    const split = (corners, depth) => {
        if (depth == 0) {
            tetrahedron(corners);
            return;
        }
        for (const keep of corners)
            split(corners.map((c) => c.add(keep).scale(0.5)), depth - 1);
    };

    const s = Math.sqrt(2) / 2;
    split([new Vec3(1, 0, -s), new Vec3(-1, 0, -s), new Vec3(0, 1, s), new Vec3(0, -1, s)], level);

    return new Mesh(positions, indices, material, { shading: "flat" });
}

/** A level-6 Sierpinski tetrahedron in gold: 4096 tetrahedra, lit low from the side. */
export function sierpinskiScene() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#1c2340"),
            horizon: hexColor("#6a5a70"),
            ground: hexColor("#141018"),
            sunStrength: 3.5,
            sunDirection: new Vec3(0.7, 0.45, 0.5),
            sunColor: new Vec3(1.0, 0.9, 0.8),
            sunSize: 0.03,
        }),
    });

    // Tilted so the corner (0, 1, s) points straight up, which leaves the
    // opposite face flat, a third of that corner's height below the centre;
    // then raised to stand on the floor.
    const shape = sierpinski(6, Material.metal(hexColor("#ffc85a"), 0.2));
    const size = 1.6;
    const corner = Math.sqrt(1.5);
    const standing = Mat4.translate(0, size * corner / 3, 0)
        .multiplyMat4(Mat4.scale(size, size, size))
        .multiplyMat4(Mat4.rotateX(-Math.atan(Math.SQRT2 / 2)));

    scene.add(
        new Quad(new Vec3(-30, 0, 30), new Vec3(60, 0, 0), new Vec3(0, 0, -60), Material.plastic(hexColor("#2a2630"), 0.25)),
        shape.transformed(standing));

    return {
        scene,
        camera: {
            position: new Vec3(3.4, 2.0, 4.6),
            target: new Vec3(0, 0.85, 0),
            fov: 42 * Math.PI / 180,
        },
    };
}
