import { Box, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { placed, profile } from "./helpers.mjs";
import { wood } from "./textures.mjs";

// Each piece's profile, about 1 square across at the base.
const BASE = [[0, 0], [0.38, 0], [0.38, 0.08], [0.32, 0.12]];
export const PIECES = {
    pawn: profile([...BASE, [0.2, 0.2], [0.12, 0.45], [0.16, 0.5], [0.12, 0.54], [0.18, 0.62], [0.2, 0.7], [0.16, 0.8], [0.08, 0.84], [0, 0.85]]),
    rook: profile([...BASE, [0.24, 0.2], [0.22, 0.75], [0.3, 0.8], [0.3, 1.0], [0.22, 1.0], [0.22, 0.92], [0, 0.92]]),
    bishop: profile([...BASE, [0.2, 0.22], [0.13, 0.7], [0.22, 0.76], [0.13, 0.82], [0.2, 0.95], [0.18, 1.08], [0.08, 1.2], [0.05, 1.24], [0.07, 1.28], [0, 1.32]]),
    queen: profile([...BASE, [0.24, 0.24], [0.14, 0.9], [0.26, 0.95], [0.16, 1.02], [0.26, 1.25], [0.2, 1.32], [0.1, 1.33], [0.08, 1.4], [0, 1.42]]),
    king: profile([...BASE, [0.24, 0.24], [0.15, 0.95], [0.27, 1.0], [0.17, 1.06], [0.24, 1.35], [0.12, 1.4], [0.06, 1.42], [0.06, 1.62], [0, 1.62]]),
};

/**
 * A game in progress on a glossy board: glass pieces against black ones,
 * under a single soft lamp.
 */
export function chess() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.03, 0.03, 0.04), horizon: new Vec3(0.06, 0.06, 0.07), ground: new Vec3(0.01, 0.01, 0.01) }),
    });

    // The board: 8 squares of 1 from -4 to 4, its top at 0, in a wooden frame.
    scene.add(
        Box.fromCorners(new Vec3(-4, -0.3, -4), new Vec3(4, 0, 4), Material.checkered(hexColor("#ead9b8"), hexColor("#3b2416"), 1.0)),
        Box.fromCorners(new Vec3(-4.5, -0.32, -4.5), new Vec3(4.5, -0.02, 4.5), Material.plastic(hexColor("#5a321c"), 0.25).withTexture(wood(), 0.3, hexColor("#9a6a48"))),
        new Quad(new Vec3(-30, -0.32, 30), new Vec3(60, 0, 0), new Vec3(0, 0, -60), Material.diffuse(hexColor("#2a2420"))));

    const white = Material.glass(1.5, hexColor("#f2f8ff"));
    const black = Material.plastic(hexColor("#141414"), 0.12);

    // [piece, file (0-7), rank (0-7), white?]
    const position = [
        ["king", 6, 0, true], ["rook", 5, 0, true], ["pawn", 5, 1, true], ["pawn", 6, 1, true], ["pawn", 7, 2, true],
        ["queen", 3, 3, true], ["bishop", 2, 3, true], ["pawn", 4, 3, true], ["pawn", 0, 1, true],
        ["king", 6, 7, false], ["rook", 3, 7, false], ["pawn", 5, 6, false], ["pawn", 6, 5, false], ["pawn", 7, 6, false],
        ["queen", 4, 5, false], ["bishop", 1, 4, false], ["pawn", 3, 4, false], ["pawn", 0, 6, false],
    ];

    for (const [piece, file, rank, is_white] of position) {
        const mesh = Mesh.lathe(PIECES[/** @type {keyof typeof PIECES} */ (piece)], is_white ? white : black, { segments: 48 });
        scene.add(placed(mesh, Number(file) - 3.5, 0, 3.5 - Number(rank)));
    }

    // A soft lamp overhead, out of shot.
    scene.add(new Quad(new Vec3(-2.5, 9, -2.5), new Vec3(5, 0, 0), new Vec3(0, 0, 5), Material.light(new Vec3(1, 0.96, 0.9), 5.0)));

    return {
        scene,
        camera: {
            position: new Vec3(-2.0, 5.5, 8.5),
            target: new Vec3(0.3, 0.3, 0.2),
            fov: 42 * Math.PI / 180,
        },
        bounces: 12,
    };
}
