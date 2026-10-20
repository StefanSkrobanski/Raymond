import { Box, Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile, seededRandom, stars } from "./helpers.mjs";
import { valueNoise } from "./terrain.mjs";

/** The snowman's three balls, bottom to top: centre and radius. */
export const BODY = [
    { at: new Vec3(0, 0.55, 0), r: 0.6 },
    { at: new Vec3(0, 1.48, 0), r: 0.42 },
    { at: new Vec3(0, 2.12, 0), r: 0.28 },
];

/**
 * A snowman on a moonlit night, with a coal smile and a carrot nose, lit
 * warm by a street lamp and cold by the moon.
 */
export function snowman() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#05081a"),
            horizon: hexColor("#1a2240"),
            ground: hexColor("#05081a"),
            sunStrength: 0.6,
            sunDirection: new Vec3(-0.5, 0.6, -0.6),
            sunColor: new Vec3(0.7, 0.8, 1.0),
            sunSize: 0.04,
        }),
    });

    const noise = valueNoise(41);
    const snow = Material.diffuse(hexColor("#f4f7fb"));

    // Drifts of snow.
    scene.add(Mesh.surface((u, v) => {
        const x = (u - 0.5) * 40, z = (0.5 - v) * 40;
        return new Vec3(x, 0.25 * noise(x * 0.3, z * 0.3) - 0.05, z);
    }, 64, 64, snow));

    for (const { at, r } of BODY)
        scene.add(new Sphere(at, r, snow));

    const coal = Material.plastic(hexColor("#111111"), 0.4);
    const head = BODY[2];

    // Eyes, and a smile of coal round the front of the head.
    for (const side of [-1, 1])
        scene.add(new Sphere(head.at.add(new Vec3(side * 0.1, 0.07, 0.25)), 0.035, coal));
    for (let k = -2; k <= 2; ++k) {
        const a = k * 0.28;
        scene.add(new Sphere(head.at.add(new Vec3(Math.sin(a) * 0.2, -0.1 - Math.cos(a) * 0.03 + 0.03, Math.cos(a) * 0.23)), 0.022, coal));
    }

    // Buttons down the middle.
    for (let k = 0; k < 3; ++k) {
        const a = 0.6 - k * 0.35;
        scene.add(new Sphere(BODY[1].at.add(new Vec3(0, Math.sin(a) * 0.42, Math.cos(a) * 0.42)), 0.04, coal));
    }

    // A carrot nose: a long thin cone, pointing out of the face.
    const carrot = Mesh.lathe(profile([[0, 0], [0.045, 0], [0, 0.32]]), Material.plastic(hexColor("#ff7a1a"), 0.4), { segments: 24 });
    scene.add(carrot.transformed(Mat4.translate(head.at.x, head.at.y, head.at.z + 0.22).multiplyMat4(Mat4.rotateX(Math.PI / 2))));

    // A scarf: a fat red ring round the neck, with a tail.
    scene.add(
        Mesh.torus(Material.diffuse(hexColor("#c4222f")), { radius: 0.3, tube: 0.07, segments: 48, sides: 16 })
            .transformed(Mat4.translate(0, 1.87, 0)),
        Box.fromCorners(new Vec3(0.12, 1.45, 0.28), new Vec3(0.26, 1.85, 0.36), Material.diffuse(hexColor("#c4222f")), 0.3));

    // A top hat.
    scene.add(
        placed(cylinder(0.3, 0.02, coal, 48), 0, 2.34, 0),
        placed(cylinder(0.19, 0.36, coal, 48), 0, 2.34, 0));

    // Stick arms.
    const wood = Material.diffuse(hexColor("#4a3220"));
    scene.add(
        Box.between(new Vec3(0.35, 1.6, 0), new Vec3(1.1, 2.05, 0.1), 0.04, wood),
        Box.between(new Vec3(-0.35, 1.6, 0), new Vec3(-1.05, 1.9, -0.15), 0.04, wood));

    // A street lamp: a post with a warm glowing globe.
    const iron = Material.metal(hexColor("#2a2a30"), 0.4);
    scene.add(
        placed(cylinder(0.06, 3.2, iron, 16), -2.2, -0.1, -1.4),
        new Sphere(new Vec3(-2.2, 3.35, -1.4), 0.2, Material.light(hexColor("#ffcf8a"), 14.0)));

    // Snowflakes hanging in the air, and stars.
    const random = seededRandom(8);
    for (let i = 0; i < 120; ++i)
        scene.add(new Sphere(new Vec3((random() - 0.5) * 8, random() * 4, (random() - 0.5) * 6 - 1), 0.012, snow));
    scene.add(...stars(250, 90, 4, { above: true }));

    return {
        scene,
        camera: {
            position: new Vec3(1.4, 1.6, 4.6),
            target: new Vec3(-0.3, 1.4, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
