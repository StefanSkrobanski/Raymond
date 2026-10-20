import { Box, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, hsv, placed, seededRandom } from "./helpers.mjs";

// A brick unit: 0.8 across a stud, 0.96 tall, studs 0.24 across.
const UNIT = 0.8, HEIGHT = 0.96, STUD_R = 0.24, STUD_H = 0.17;

/**
 * One toy brick, w by d studs, its corner at (x, layer, z) in stud units.
 * Returns the brick's body and its studs.
 * @param {number} x
 * @param {number} layer
 * @param {number} z
 * @param {number} w
 * @param {number} d
 * @param {Material} material
 */
export function brick(x, layer, z, w, d, material) {
    const y = layer * HEIGHT;
    const gap = 0.01;
    const parts = [
        Box.fromCorners(new Vec3(x * UNIT + gap, y, z * UNIT + gap), new Vec3((x + w) * UNIT - gap, y + HEIGHT, (z + d) * UNIT - gap), material),
    ];
    const stud = cylinder(STUD_R, STUD_H, material, 24);
    for (let i = 0; i < w; ++i)
        for (let j = 0; j < d; ++j)
            parts.push(placed(stud, (x + i + 0.5) * UNIT, y + HEIGHT, (z + j + 0.5) * UNIT));
    return parts;
}

/**
 * A little tower of toy bricks, glossy plastic in bright colours, with a
 * few loose bricks scattered about.
 */
export function toyBricks() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.6, 0.7, 0.9), horizon: new Vec3(0.95, 0.95, 0.97), sunStrength: 2.5, sunDirection: new Vec3(0.5, 0.8, 0.4), sunSize: 0.08 }),
    });

    scene.add(new Quad(new Vec3(-40, 0, 40), new Vec3(80, 0, 0), new Vec3(0, 0, -80), Material.diffuse(hexColor("#f0ece4"))));

    const random = seededRandom(77);
    const colors = ["#d01012", "#0055bf", "#f2cd37", "#237841", "#fe8a18", "#ffffff"].map((c) => Material.plastic(hexColor(c), 0.12));
    const pick = () => colors[Math.floor(random() * colors.length)];

    // A tower, staggered like brickwork.
    for (let layer = 0; layer < 7; ++layer) {
        const shift = layer % 2;
        for (let k = 0; k < 2; ++k)
            scene.add(...brick(-3 + shift + k * 2, layer, -1, 2, 2, pick()));
    }
    // A wall beside it, and a red brick on top.
    for (let layer = 0; layer < 3; ++layer)
        scene.add(...brick(1 + (layer % 2), layer, -2, 4, 1, pick()));
    scene.add(...brick(-2, 7, -1, 2, 2, colors[0]));

    // Loose bricks on the floor, turned every which way.
    for (let i = 0; i < 9; ++i) {
        const x = (random() - 0.5) * 10, z = 1.5 + random() * 3;
        scene.add(...brick(Math.round(x), 0, Math.round(z), 1 + Math.floor(random() * 3), 1 + Math.floor(random() * 2), pick()));
    }

    return {
        scene,
        camera: {
            position: new Vec3(8.0, 7.0, 13.0),
            target: new Vec3(-0.5, 3.2, 0),
            fov: 42 * Math.PI / 180,
            aperture: 0.02,
        },
    };
}
