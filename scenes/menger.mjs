import { Mat4, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { floor } from "./helpers.mjs";

/**
 * Whether cell (x, y, z) of a level-n Menger sponge, counting cells from 0
 * to 3^n - 1 along each side, is solid: at no level may two of its base-3
 * digits be the middle one.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} level
 */
export function mengerSolid(x, y, z, level) {

    for (let i = 0; i < level; ++i) {
        const middles = Number(x % 3 == 1) + Number(y % 3 == 1) + Number(z % 3 == 1);
        if (middles >= 2)
            return false;
        x = Math.floor(x / 3);
        y = Math.floor(y / 3);
        z = Math.floor(z / 3);
    }

    return true;
}

/**
 * A Menger sponge as one mesh: only the faces between solid and empty
 * cells, so the many cubes cost a fraction of their triangles.
 * @param {number} level
 * @param {number} size the length of each side
 * @param {Material} material
 */
export function mengerSponge(level, size, material) {

    const n = 3 ** level;
    const cell = size / n;
    const origin = -size / 2.0;

    /** @type {(x: number, y: number, z: number) => boolean} */
    const solid = (x, y, z) =>
        x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && mengerSolid(x, y, z, level);

    /** @type {Vec3[]} */
    const positions = [];
    /** @type {number[]} */
    const indices = [];

    // Each face: the offset to the neighbour, and two edges of the face
    // whose cross product points that way, from the corner they start at.
    const faces = [
        { d: [1, 0, 0], corner: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
        { d: [-1, 0, 0], corner: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { d: [0, 1, 0], corner: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
        { d: [0, -1, 0], corner: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { d: [0, 0, 1], corner: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { d: [0, 0, -1], corner: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] },
    ];

    for (let x = 0; x < n; ++x) {
        for (let y = 0; y < n; ++y) {
            for (let z = 0; z < n; ++z) {

                if (!solid(x, y, z))
                    continue;

                for (const { d, corner, u, v } of faces) {

                    if (solid(x + d[0], y + d[1], z + d[2]))
                        continue;

                    const c = new Vec3(
                        origin + (x + corner[0]) * cell,
                        origin + (y + corner[1]) * cell,
                        origin + (z + corner[2]) * cell);
                    const eu = new Vec3(u[0], u[1], u[2]).scale(cell);
                    const ev = new Vec3(v[0], v[1], v[2]).scale(cell);

                    const k = positions.length;
                    positions.push(c, c.add(eu), c.add(eu).add(ev), c.add(ev));
                    indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
                }
            }
        }
    }

    return new Mesh(positions, indices, material, { shading: "flat" });
}

/** A level 3 Menger sponge: 8000 cubes, lit by the sun and a warm lamp. */
export function mengerScene() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.18, 0.3, 0.6),
            horizon: new Vec3(0.7, 0.75, 0.85),
            sunStrength: 3.0,
            sunDirection: new Vec3(0.6, 0.9, 0.35),
        }),
    });

    const sponge = mengerSponge(3, 2.4, Material.plastic(hexColor("#e8a33d"), 0.35));

    scene.add(
        sponge.transformed(Mat4.translate(0.0, 1.2, 0.0)),
        floor(60, Material.diffuse(hexColor("#7d8a96"))),
        // A warm lamp above and behind the camera, out of shot.
        new Quad(new Vec3(3.0, 6.5, 4.0), new Vec3(1.5, 0.0, 0.0), new Vec3(0.0, 0.0, 1.5), Material.light(hexColor("#ff9a50"), 5.0)));

    return {
        scene,
        camera: {
            position: new Vec3(3.4, 2.9, 4.2),
            target: new Vec3(0.0, 1.0, 0.0),
            fov: 40.0 * Math.PI / 180.0,
        },
    };
}
