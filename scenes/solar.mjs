import { Mat4, Material, Mesh, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { profile, stars } from "./helpers.mjs";
import { earth, jupiter, mars, moon, saturn } from "./textures.mjs";

const WHITE = new Vec3(1, 1, 1);

/**
 * The planets, out from the sun: name, distance, radius, angle round the
 * orbit, and material.
 */
export const PLANETS = [
    { name: "Mercury", distance: 2.0, radius: 0.18, angle: 5.0, material: Material.diffuse(hexColor("#b8b0a4")).withTexture(moon(), 1, hexColor("#d8cfc0")) },
    { name: "Venus", distance: 2.9, radius: 0.32, angle: 4.3, material: Material.diffuse(hexColor("#e8cf9a")) },
    { name: "Earth", distance: 4.0, radius: 0.34, angle: 3.75, material: Material.plastic(WHITE, 0.3).withTexture(earth()), tilt: 0.41 },
    { name: "Mars", distance: 5.0, radius: 0.24, angle: 3.2, material: Material.diffuse(WHITE).withTexture(mars()), tilt: 0.44 },
    { name: "Jupiter", distance: 6.6, radius: 0.85, angle: 2.55, material: Material.diffuse(WHITE).withTexture(jupiter()), tilt: 0.05 },
    { name: "Saturn", distance: 8.6, radius: 0.7, angle: 1.95, material: Material.diffuse(WHITE).withTexture(saturn()), tilt: 0.45 },
];

/**
 * The sun and its planets, Saturn with its rings, against the stars. The
 * sun is the only light the planets get, so each has a lit day side and a
 * dark night side.
 */
export function solarSystem() {

    const scene = new Scene({ sky: Sky.black() });

    scene.add(new Sphere(new Vec3(0, 0, 0), 1.0, Material.light(hexColor("#ffd27a"), 12.0)));

    // Each tilted on its axis, as the planets are.
    for (const { distance, radius, angle, material, tilt = 0 } of PLANETS)
        scene.add(new Sphere(new Vec3(distance * Math.cos(angle), 0, -distance * Math.sin(angle)), radius, material,
            { rotation: Mat4.rotateX(tilt).multiplyMat4(Mat4.rotateY(angle * 3)) }));

    // Saturn's rings: a thin flat annulus, turned on the lathe and tilted.
    const saturn = PLANETS[5];
    const ring = Mesh.lathe(profile([[0.95, -0.005], [1.6, -0.005], [1.6, 0.005], [0.95, 0.005], [0.95, -0.005]]),
        Material.diffuse(hexColor("#cbb98a")), { segments: 96 });
    scene.add(ring.transformed(
        Mat4.translate(saturn.distance * Math.cos(saturn.angle), 0, -saturn.distance * Math.sin(saturn.angle))
            .multiplyMat4(Mat4.rotateX(0.45))));

    // The moon, beside the earth.
    const earth = PLANETS[2];
    scene.add(new Sphere(new Vec3(earth.distance * Math.cos(earth.angle) + 0.55, 0.15, -earth.distance * Math.sin(earth.angle)), 0.09,
        Material.diffuse(WHITE).withTexture(moon())));

    scene.add(...stars(300, 80, 11));

    return {
        scene,
        camera: {
            position: new Vec3(0.5, 3.2, 6.5),
            target: new Vec3(-2.6, -0.2, -3.0),
            fov: 55 * Math.PI / 180,
        },
    };
}
