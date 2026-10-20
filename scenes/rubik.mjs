import { Box, Mat4, Material, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";

const COLORS = {
    right: "#c41e3a", left: "#ff5800", up: "#ffffff", down: "#ffd500", front: "#009e60", back: "#0051ba",
};

/**
 * A Rubik's cube, its top layer caught a third of a quarter-turn round:
 * 27 black cubies, each with a coloured sticker on every outward face.
 * Returns the boxes.
 */
export function rubiksCube() {

    const body = Material.plastic(hexColor("#111111"), 0.25);
    /** @type {Record<string, Material>} */
    const stickers = Object.fromEntries(Object.entries(COLORS).map(([face, c]) => [face, Material.plastic(hexColor(c), 0.15)]));
    const boxes = [];

    for (let x = -1; x <= 1; ++x) {
        for (let y = -1; y <= 1; ++y) {
            for (let z = -1; z <= 1; ++z) {

                // The top layer is turning; everything in it shares its turn.
                const layer = y == 1 ? Mat4.rotateY(0.45) : Mat4.identity();
                const at = (/** @type {Mat4} */ local) => new Box(
                    Mat4.translate(0, 1.0, 0).multiplyMat4(layer).multiplyMat4(Mat4.translate(x * 0.34, y * 0.34, z * 0.34)).multiplyMat4(local), body);

                boxes.push(at(Mat4.scale(0.165, 0.165, 0.165)));

                // A sticker on each outward face: thin, a little inset.
                /** @type {[boolean, string, Mat4][]} */
                const faces = [
                    [x == 1, "right", Mat4.translate(0.166, 0, 0).multiplyMat4(Mat4.scale(0.004, 0.14, 0.14))],
                    [x == -1, "left", Mat4.translate(-0.166, 0, 0).multiplyMat4(Mat4.scale(0.004, 0.14, 0.14))],
                    [y == 1, "up", Mat4.translate(0, 0.166, 0).multiplyMat4(Mat4.scale(0.14, 0.004, 0.14))],
                    [y == -1, "down", Mat4.translate(0, -0.166, 0).multiplyMat4(Mat4.scale(0.14, 0.004, 0.14))],
                    [z == 1, "front", Mat4.translate(0, 0, 0.166).multiplyMat4(Mat4.scale(0.14, 0.14, 0.004))],
                    [z == -1, "back", Mat4.translate(0, 0, -0.166).multiplyMat4(Mat4.scale(0.14, 0.14, 0.004))],
                ];
                for (const [outward, face, local] of faces) {
                    if (outward) {
                        const box = at(local);
                        boxes.push(new Box(box.transform, stickers[face]));
                    }
                }
            }
        }
    }

    return boxes;
}

/** A Rubik's cube mid-twist, on a desk under a lamp. */
export function rubik() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.12, 0.13, 0.16), horizon: new Vec3(0.2, 0.2, 0.22), ground: new Vec3(0.05, 0.05, 0.05) }),
    });

    scene.add(
        new Quad(new Vec3(-10, 0.49, 10), new Vec3(20, 0, 0), new Vec3(0, 0, -20), Material.plastic(hexColor("#6b4a32"), 0.35)),
        ...rubiksCube(),
        new Quad(new Vec3(-1.5, 4, 0), new Vec3(3, 0, 0), new Vec3(0, 0, 2.5), Material.light(new Vec3(1, 0.97, 0.92), 3.0)),
        new Quad(new Vec3(3, 0.5, -2), new Vec3(0, 0, 3), new Vec3(0, 2, 0), Material.light(hexColor("#a8c4ff"), 1.0)));

    return {
        scene,
        camera: {
            position: new Vec3(1.6, 2.1, 2.4),
            target: new Vec3(0, 0.95, 0),
            fov: 38 * Math.PI / 180,
            aperture: 0.015,
        },
    };
}
