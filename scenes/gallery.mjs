import { Box, Mat4, Material, Quad, Scene, Sky, Sphere, Vec2, Vec3, hexColor } from "../src/index.mjs";
import { cylinder, placed } from "./helpers.mjs";
import { brick, brickBumps, earth, jupiter, marble, planks, planksBumps, stone, stoneBumps, wood } from "./textures.mjs";

const WHITE = new Vec3(1, 1, 1);

/**
 * A showroom of textures: a wooden floor and a brick wall (both with
 * bumps, as normal maps), a marble ball, a globe of the Earth on its
 * stand, Jupiter, and crates of wood and stone, in light from a window.
 */
export function textureGallery() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.12, 0.13, 0.16), horizon: new Vec3(0.18, 0.18, 0.2), ground: new Vec3(0.05, 0.05, 0.05) }),
    });

    scene.add(
        // The floor, its boards running across, and the wall behind.
        new Quad(new Vec3(-6, 0, 4), new Vec3(12, 0, 0), new Vec3(0, 0, -6), Material.plastic(WHITE, 0.35).withTexture(planks(), new Vec2(3, 1.5)).withNormalMap(planksBumps())),
        new Quad(new Vec3(-6, 0, -2), new Vec3(12, 0, 0), new Vec3(0, 5, 0), Material.diffuse(WHITE).withTexture(brick(), new Vec2(4, 1.7)).withNormalMap(brickBumps(), 1.5)),
        // A window high on the left, out of shot, and a soft fill from the right.
        new Quad(new Vec3(-7, 1, 2), new Vec3(0, 0, -3), new Vec3(0, 3, 0), Material.light(new Vec3(1, 0.96, 0.9), 5.0)),
        new Quad(new Vec3(7, 0.5, -1), new Vec3(0, 0, 3), new Vec3(0, 3, 0), Material.light(hexColor("#a8c0ff"), 0.8)));

    // The globe, tilted 23.4 degrees on a brass stand.
    const brass = Material.metal(hexColor("#d9a84e"), 0.25);
    scene.add(
        placed(cylinder(0.3, 0.06, brass), 0, 0, -0.4),
        placed(cylinder(0.04, 0.6, brass), 0, 0, -0.4),
        new Sphere(new Vec3(0, 1.15, -0.4), 0.55, Material.plastic(WHITE, 0.3).withTexture(earth()),
            { rotation: Mat4.rotateZ(-0.41).multiplyMat4(Mat4.rotateY(2.2)) }));

    scene.add(
        new Sphere(new Vec3(-1.7, 0.5, 0.3), 0.5, Material.plastic(WHITE, 0.08).withTexture(marble())),
        new Sphere(new Vec3(1.15, 0.3, 0.9), 0.3, Material.diffuse(WHITE).withTexture(jupiter()), { rotation: Mat4.rotateZ(0.05) }),
        // Crates: wood below, stone on top, turned a little.
        Box.fromCorners(new Vec3(1.2, 0, -1.4), new Vec3(2.2, 1.0, -0.4), Material.diffuse(WHITE).withTexture(wood()), 0.3),
        Box.fromCorners(new Vec3(1.35, 1.0, -1.25), new Vec3(2.05, 1.7, -0.55), Material.diffuse(WHITE).withTexture(stone()).withNormalMap(stoneBumps()), -0.2));

    return {
        scene,
        camera: {
            position: new Vec3(0.3, 1.6, 4.6),
            target: new Vec3(0, 0.8, -0.4),
            fov: 42 * Math.PI / 180,
        },
    };
}
