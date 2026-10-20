import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile, seededRandom, stars } from "./helpers.mjs";

// The tower: a tapering column, in stripes. Each band is its own lathe
// section, so it can have its own colour.
export const BANDS = 6;
const HEIGHT = 6.0, BASE = 0.9, TOP = 0.55;

/** @param {number} y */
const radiusAt = (y) => BASE + (TOP - BASE) * (y / HEIGHT);

/**
 * A lighthouse on its rock at dusk, its lamp blazing, over a calm sea that
 * catches the last of the light.
 */
export function lighthouse() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#141c3d"),
            horizon: hexColor("#d9806a"),
            ground: hexColor("#0c1020"),
            sunStrength: 0.8,
            sunDirection: new Vec3(0.9, 0.05, -0.4),
            sunColor: new Vec3(1.0, 0.6, 0.4),
            sunSize: 0.05,
        }),
    });

    // The sea: a dark, slightly glossy plane far out.
    scene.add(new Quad(new Vec3(-200, 0, 200), new Vec3(400, 0, 0), new Vec3(0, 0, -400), Material.plastic(hexColor("#0b1a2a"), 0.08)));

    // The rock: a heap of boulders.
    const random = seededRandom(9);
    const rock = Material.diffuse(hexColor("#3b3836"));
    for (let i = 0; i < 26; ++i) {
        const a = random() * 2 * Math.PI, r = random() * 2.2;
        const size = 0.5 + random() * 0.8;
        scene.add(Mesh.icosphere(rock, 1, { shading: "flat" }).transformed(
            Mat4.translate(r * Math.cos(a), size * 0.2, r * Math.sin(a))
                .multiplyMat4(Mat4.rotateY(random() * 3))
                .multiplyMat4(Mat4.scale(size, size * 0.6, size * 0.9))));
    }

    // The tower, in red and white bands, on a plinth.
    const plinth = 0.6;
    scene.add(placed(cylinder(1.2, plinth, Material.diffuse(hexColor("#9a958c")), 48), 0, 0, 0));
    for (let b = 0; b < BANDS; ++b) {
        const y0 = (b / BANDS) * HEIGHT, y1 = ((b + 1) / BANDS) * HEIGHT;
        const material = Material.plastic(hexColor(b % 2 == 0 ? "#f2efe8" : "#b8262c"), 0.4);
        scene.add(Mesh.lathe(profile([[0, y0], [radiusAt(y0), y0], [radiusAt(y0), y0], [radiusAt(y1), y1], [radiusAt(y1), y1], [0, y1]]),
            material, { segments: 48 }).transformed(Mat4.translate(0, plinth, 0)));
    }

    // The gallery, lantern room and roof.
    const top = plinth + HEIGHT;
    const iron = Material.metal(hexColor("#2c2c30"), 0.35);
    scene.add(
        placed(cylinder(0.8, 0.08, iron, 48), 0, top, 0),
        Mesh.lathe(profile([[0, 0], [0.45, 0], [0.45, 0.9], [0.43, 0.9], [0.43, 0.02], [0, 0.02]]), Material.glass(1.5, hexColor("#fff6e0")), { segments: 48 })
            .transformed(Mat4.translate(0, top + 0.08, 0)),
        Mesh.lathe(profile([[0, 0], [0.55, 0], [0.55, 0], [0, 0.55]]), Material.plastic(hexColor("#b8262c"), 0.3), { segments: 48 })
            .transformed(Mat4.translate(0, top + 0.98, 0)),
        // The lamp itself.
        new Sphere(new Vec3(0, top + 0.5, 0), 0.22, Material.light(hexColor("#fff0c0"), 60.0)));

    // A little keeper's cottage, with a lit window.
    scene.add(...cottage(new Vec3(1.9, 0.5, 0.9)));

    scene.add(...stars(200, 150, 21, { above: true }));

    return {
        scene,
        camera: {
            position: new Vec3(7.5, 2.4, 9.0),
            target: new Vec3(0, 3.3, 0),
            fov: 42 * Math.PI / 180,
        },
        bounces: 10,
    };
}

/**
 * A cottage at the given corner: walls, a roof, and a glowing window.
 * @param {Vec3} at
 */
function cottage(at) {
    const wall = Material.diffuse(hexColor("#e6dfd2"));
    return [
        Mesh.lathe(profile([[0, 0], [0.75, 0], [0.75, 0], [0.75, 0.8], [0.75, 0.8], [0, 0.8]]), wall, { segments: 4, shading: "flat" })
            .transformed(Mat4.translate(at.x, at.y, at.z).multiplyMat4(Mat4.rotateY(Math.PI / 4))),
        Mesh.lathe(profile([[0, 0], [0.85, 0], [0.85, 0], [0, 0.55]]), Material.diffuse(hexColor("#5a2b22")), { segments: 4, shading: "flat" })
            .transformed(Mat4.translate(at.x, at.y + 0.8, at.z).multiplyMat4(Mat4.rotateY(Math.PI / 4))),
        // The window: a thin glowing pane, set into the front wall.
        Box.fromCorners(at.add(new Vec3(0.12, 0.25, 0.51)), at.add(new Vec3(0.38, 0.5, 0.55)), Material.light(hexColor("#ffc070"), 6.0)),
    ];
}
