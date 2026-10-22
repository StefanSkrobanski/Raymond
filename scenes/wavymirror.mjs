import { Box, Material, Mesh, Quad, Scene, Sky, Sphere, Vec2, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed } from "./helpers.mjs";
import { planks, planksBumps, plaster, plasterBumps, wood } from "./textures.mjs";

// The mirror: 4 wide and 2.6 tall, standing at the back of the room, its
// surface rippling across in waves 1.3 wide and gently up and down.
const MIRROR_Z = -1.6;
const WIDTH = 4.0;
const BOTTOM = 0.25;
const HEIGHT = 2.6;

/**
 * How far the mirror's surface stands out from its frame at (x, y).
 * @param {number} x
 * @param {number} y
 */
export function mirrorDepth(x, y) {
    return 0.06 * Math.sin(2.0 * Math.PI * x / 1.3) + 0.04 * Math.sin(2.0 * Math.PI * (y - BOTTOM) / 2.0);
}

/**
 * A funhouse mirror: a sheet of polished metal rippled into waves, so the
 * balls, the striped column and the rest stretch and squeeze in it, and
 * the lamp's light, bounced off the waves, lies on the floor in bright
 * wavy bands (caustics, which light tracing finds).
 */
export function wavyMirror() {

    const scene = new Scene({ sky: Sky.black() });
    const WHITE = new Vec3(1, 1, 1);

    const mirror = Mesh.surface(
        (u, v) => {
            const x = (u - 0.5) * WIDTH;
            const y = BOTTOM + v * HEIGHT;
            return new Vec3(x, y, MIRROR_Z + mirrorDepth(x, y));
        },
        160, 48, Material.metal(new Vec3(0.94, 0.95, 0.97)));

    // The frame round it, and the wall behind.
    const frame = Material.plastic(WHITE, 0.3).withTexture(wood(), 1.5);
    const back = MIRROR_Z - 0.2, front = MIRROR_Z + 0.2;
    scene.add(
        mirror,
        Box.fromCorners(new Vec3(-WIDTH / 2 - 0.15, BOTTOM - 0.15, back), new Vec3(WIDTH / 2 + 0.15, BOTTOM, front), frame),
        Box.fromCorners(new Vec3(-WIDTH / 2 - 0.15, BOTTOM + HEIGHT, back), new Vec3(WIDTH / 2 + 0.15, BOTTOM + HEIGHT + 0.15, front), frame),
        Box.fromCorners(new Vec3(-WIDTH / 2 - 0.15, BOTTOM, back), new Vec3(-WIDTH / 2, BOTTOM + HEIGHT, front), frame),
        Box.fromCorners(new Vec3(WIDTH / 2, BOTTOM, back), new Vec3(WIDTH / 2 + 0.15, BOTTOM + HEIGHT, front), frame),
        // Legs to stand it on the floor.
        Box.fromCorners(new Vec3(-1.6, 0, back), new Vec3(-1.45, BOTTOM - 0.15, front), frame),
        Box.fromCorners(new Vec3(1.45, 0, back), new Vec3(1.6, BOTTOM - 0.15, front), frame));

    const wall = Material.diffuse(hexColor("#b7c4cf")).withTexture(plaster(), 3).withNormalMap(plasterBumps(), 2);
    const boards = Material.plastic(WHITE, 0.45).withTexture(planks(), new Vec2(2, 2)).withNormalMap(planksBumps());
    // Behind the camera, a checked wall for the mirror to bend.
    const checks = Material.checkered(hexColor("#f3efe6"), hexColor("#c0392b"), 0.5);
    scene.add(
        new Quad(new Vec3(-6, 0, 6), new Vec3(12, 0, 0), new Vec3(0, 0, -8.5), boards),
        new Quad(new Vec3(-6, 0, -2.5), new Vec3(12, 0, 0), new Vec3(0, 4.5, 0), wall),
        new Quad(new Vec3(6, 0, 6), new Vec3(-12, 0, 0), new Vec3(0, 4.5, 0), checks),
        new Quad(new Vec3(-6, 0, 6), new Vec3(0, 0, -8.5), new Vec3(0, 4.5, 0), wall),
        new Quad(new Vec3(6, 0, -2.5), new Vec3(0, 0, 8.5), new Vec3(0, 4.5, 0), wall),
        new Quad(new Vec3(-6, 4.5, -2.5), new Vec3(12, 0, 0), new Vec3(0, 0, 8.5), Material.diffuse(hexColor("#e8e4dc"))));

    // In front: a red ball, a blue glass ball, a striped column and a
    // little stack of blocks, all of which the waves bend.
    scene.add(
        new Sphere(new Vec3(-0.9, 0.4, 0.3), 0.4, Material.plastic(hexColor("#d8332b"), 0.15)),
        new Sphere(new Vec3(0.75, 0.3, 0.9), 0.3, Material.glass(1.5, hexColor("#9cc8ff"))),
        Box.fromCorners(new Vec3(0.9, 0, -0.3), new Vec3(1.4, 0.5, 0.2), Material.plastic(hexColor("#f2c230"), 0.3), 0.4),
        Box.fromCorners(new Vec3(0.95, 0.5, -0.25), new Vec3(1.3, 0.85, 0.1), Material.plastic(hexColor("#3a9a54"), 0.3), 0.9));
    for (let k = 0; k < 6; ++k) {
        const color = k % 2 == 0 ? hexColor("#f4f1ea") : hexColor("#2f5fb3");
        scene.add(placed(cylinder(0.16, 0.25, Material.plastic(color, 0.25), 32), 0.0, k * 0.25, -0.4));
    }
    scene.add(new Sphere(new Vec3(0.0, 1.66, -0.4), 0.16, Material.metal(hexColor("#e8c27a"), 0.05)));

    // A small bright lamp up in front, whose light the waves throw down
    // onto the floor in bands, and a dim panel overhead for fill.
    scene.add(
        new Sphere(new Vec3(-0.6, 3.6, 2.2), 0.12, Material.light(hexColor("#fff1dc"), 160.0)),
        // Facing down (u × v points to -y).
        new Quad(new Vec3(-3, 4.4, 4), new Vec3(0, 0, -5), new Vec3(6, 0, 0), Material.light(WHITE, 1.5)));

    return {
        scene,
        camera: {
            position: new Vec3(2.4, 1.7, 4.6),
            target: new Vec3(-0.2, 0.9, -1.0),
            fov: 50.0 * Math.PI / 180.0,
        },
        bounces: 12,
    };
}
