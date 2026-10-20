import { Box, Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed, profile, seededRandom, stars } from "./helpers.mjs";

const LIFT = 2.2;   // how far the rocket has risen off the pad

/**
 * A rocket lifting off at night: a white rocket on a column of fire,
 * billowing smoke lit orange from within, beside its launch tower.
 */
export function rocketLaunch() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#03040c"),
            horizon: hexColor("#141a30"),
            ground: hexColor("#03040c"),
            // Moonlight, so the smoke shows against the night.
            sunStrength: 0.4,
            sunDirection: new Vec3(0.5, 0.6, 0.6),
            sunColor: new Vec3(0.7, 0.8, 1.0),
        }),
    });

    scene.add(
        new Quad(new Vec3(-100, 0, 100), new Vec3(200, 0, 0), new Vec3(0, 0, -200), Material.diffuse(hexColor("#3a3a3a"))),
        Box.fromCorners(new Vec3(-3, 0, -3), new Vec3(3, 0.3, 3), Material.diffuse(hexColor("#6a6a66"))));

    // The rocket: a lathe-turned body with a red nose, and four fins.
    const white = Material.plastic(hexColor("#f2f2f0"), 0.3);
    const body = Mesh.lathe(profile([[0, 0], [0.45, 0], [0.45, 0], [0.45, 5.0], [0.38, 5.6], [0.2, 6.1], [0, 6.35]]), white, { segments: 48 });
    scene.add(body.transformed(Mat4.translate(0, 0.3 + LIFT, 0)));
    scene.add(placed(cylinder(0.452, 0.5, Material.plastic(hexColor("#c4222f"), 0.3), 48), 0, 0.3 + LIFT + 4.4, 0));
    for (let k = 0; k < 4; ++k) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        scene.add(new Box(
            Mat4.translate(0, 0.3 + LIFT + 0.6, 0).multiplyMat4(Mat4.rotateY(a)).multiplyMat4(Mat4.translate(0.7, 0, 0))
                .multiplyMat4(Mat4.scale(0.3, 0.6, 0.03)),
            Material.plastic(hexColor("#c4222f"), 0.3)));
    }

    // The exhaust: a column of fire, its core hottest.
    const random = seededRandom(3);
    for (let k = 0; k < 8; ++k) {
        const y = 0.3 + LIFT - 0.3 - k * 0.32;
        const r = 0.3 + k * 0.06;
        scene.add(new Sphere(new Vec3((random() - 0.5) * 0.1, y, (random() - 0.5) * 0.1), r,
            Material.light(hexColor(k < 3 ? "#fff1c8" : "#ff9a3a"), k < 3 ? 40 : 20)));
    }

    // Smoke, billowing out across the pad.
    const smoke = Material.diffuse(hexColor("#f0ece4"));
    for (let k = 0; k < 60; ++k) {
        const a = random() * 2 * Math.PI, d = 1.5 + random() * 6;
        const r = 0.5 + random() * 1.0;
        scene.add(new Sphere(new Vec3(d * Math.cos(a), 0.3 + r * 0.6 * random(), d * Math.sin(a) * 0.6), r, smoke));
    }

    // The launch tower: a lattice of beams beside the rocket.
    const steel = Material.metal(hexColor("#8a8f96"), 0.4);
    const tx = -1.8, half = 0.5, height = 9;
    for (const dx of [-half, half])
        for (const dz of [-half, half])
            scene.add(Box.between(new Vec3(tx + dx, 0.3, dz), new Vec3(tx + dx, height, dz), 0.08, steel));
    for (let y = 0.3; y < height; y += 0.8) {
        scene.add(
            Box.between(new Vec3(tx - half, y, -half), new Vec3(tx + half, y + 0.8, -half), 0.04, steel),
            Box.between(new Vec3(tx - half, y, half), new Vec3(tx + half, y + 0.8, half), 0.04, steel),
            Box.between(new Vec3(tx + half, y, -half), new Vec3(tx + half, y + 0.8, half), 0.04, steel));
    }
    scene.add(new Sphere(new Vec3(tx, height + 0.2, 0), 0.12, Material.light(hexColor("#ff3030"), 15)));

    scene.add(...stars(300, 150, 30, { above: true }));

    return {
        scene,
        camera: {
            position: new Vec3(6.5, 2.6, 9.5),
            target: new Vec3(-0.4, 4.0, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
