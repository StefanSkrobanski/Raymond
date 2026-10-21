import { Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { floor } from "./helpers.mjs";

/**
 * A round brilliant-style cut, 1 wide at its girdle: a flat table on top,
 * a crown sloping down to the girdle, and a pavilion coming to a point
 * underneath. Neighbouring rings are turned half a facet, so the crown and
 * pavilion break into triangles, as cut gems do.
 * @param {Material} material
 * @param {number} [facets] around the girdle
 */
export function gemMesh(material, facets = 16) {

    // Rings from the top: radius, height, and turn in facets.
    const rings = [
        { r: 0.0, y: 0.17, turn: 0 },      // the table's centre
        { r: 0.28, y: 0.17, turn: 0 },     // the table's edge
        { r: 0.43, y: 0.1, turn: 0.5 },    // the crown's stars
        { r: 0.5, y: 0.0, turn: 0 },       // the girdle
        { r: 0.25, y: -0.22, turn: 0.5 },  // the pavilion
        { r: 0.0, y: -0.43, turn: 0 },     // the culet
    ];

    /** @type {Vec3[]} */
    const positions = [];
    /** @type {number[][]} */
    const index = [];

    for (const ring of rings) {
        const row = [];
        const count = ring.r == 0 ? 1 : facets;
        for (let k = 0; k < count; ++k) {
            const a = 2.0 * Math.PI * (k + ring.turn) / facets;
            row.push(positions.length);
            positions.push(new Vec3(ring.r * Math.cos(a), ring.y, -ring.r * Math.sin(a)));
        }
        index.push(row);
    }

    /** @type {number[]} */
    const indices = [];

    // Going round anticlockwise seen from above, and down the rings, each
    // pair of rings gives a band of triangles whose fronts face out.
    for (let r = 0; r + 1 < rings.length; ++r) {
        const top = index[r], bottom = index[r + 1];
        for (let k = 0; k < facets; ++k) {
            const a = top[k % top.length], b = top[(k + 1) % top.length];
            const c = bottom[k % bottom.length], d = bottom[(k + 1) % bottom.length];
            const turned = rings[r + 1].turn > rings[r].turn;
            if (top.length == 1)
                indices.push(a, c, d);
            else if (bottom.length == 1)
                indices.push(a, c, b);
            else if (turned)
                indices.push(a, c, b, b, c, d);
            else
                indices.push(a, d, b, a, c, d);
        }
    }

    return new Mesh(positions, indices, material, { shading: "flat" });
}

/**
 * Cut gems on grey satin in a photographer's studio: a soft grey
 * backdrop for the stones to show against, and small bright lamps, which
 * the facets split into sparkles, and the diamond into colours.
 */
export function gems() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.35, 0.35, 0.38), horizon: new Vec3(0.55, 0.55, 0.58), ground: new Vec3(0.2, 0.2, 0.2) }),
    });

    scene.add(floor(30, Material.plastic(hexColor("#6d6873"), 0.55)));

    const stones = [
        // Diamond's fire is its dispersion; this one's a little fierier
        // than a real one (Abbe number 55).
        { material: Material.glass(2.42, new Vec3(1, 1, 1), 30), at: new Vec3(0, 0.43, 0), size: 1.2, tilt: 0.0 },  // diamond
        { material: Material.glass(1.77, hexColor("#ff5577")), at: new Vec3(-1.25, 0.3, 0.5), size: 0.8, tilt: 0.5 },  // ruby
        { material: Material.glass(1.77, hexColor("#4f78ff")), at: new Vec3(1.2, 0.3, 0.6), size: 0.8, tilt: -0.4 },  // sapphire
        { material: Material.glass(1.57, hexColor("#33dd88")), at: new Vec3(0.3, 0.22, 1.35), size: 0.55, tilt: 0.9 }, // emerald
        { material: Material.glass(1.54, hexColor("#ffcc44")), at: new Vec3(-0.5, 0.2, 1.5), size: 0.5, tilt: -1.0 }, // citrine
    ];

    for (const { material, at, size, tilt } of stones) {
        scene.add(gemMesh(material).transformed(
            Mat4.translate(at.x, at.y, at.z)
                .multiplyMat4(Mat4.rotateZ(tilt * 0.6))
                .multiplyMat4(Mat4.rotateY(tilt))
                .multiplyMat4(Mat4.scale(size, size, size))));
    }

    // Small, bright lamps, for crisp sparkles.
    const lamps = [new Vec3(-2, 4, 2), new Vec3(2.5, 3.5, 1), new Vec3(0.5, 5, -2.5), new Vec3(-3, 2.5, -1)];
    for (const at of lamps)
        scene.add(new Sphere(at, 0.15, Material.light(new Vec3(1, 0.97, 0.92), 120.0)));

    return {
        scene,
        camera: {
            position: new Vec3(0.4, 2.4, 4.2),
            target: new Vec3(0.0, 0.3, 0.6),
            fov: 36.0 * Math.PI / 180.0,
        },
        bounces: 16,
    };
}
