import { Box, Material, Quad, Scene, Sky, Vec2, Vec3, hexColor } from "../src/index.mjs";
import { seededRandom } from "./helpers.mjs";
import { windows } from "./textures.mjs";

/**
 * The city's buildings, as boxes standing on the ground: a 12 × 12 grid
 * of blocks, tallest towards the middle, with a few parks left empty.
 */
export function buildings() {

    const random = seededRandom(1234);
    const materials = [
        Material.diffuse(hexColor("#c9c4ba")),
        Material.diffuse(hexColor("#a86a52")),
        Material.diffuse(hexColor("#e8e2d4")),
        Material.plastic(hexColor("#1f3347"), 0.05),
        Material.plastic(hexColor("#2b4a3c"), 0.08),
        Material.metal(hexColor("#e6c27a"), 0.12),
    ];

    const boxes = [];
    const N = 12;

    for (let i = 0; i < N; ++i) {
        for (let j = 0; j < N; ++j) {

            if (random() < 0.06)
                continue; // a park

            const cx = (i - (N - 1) / 2) * 1.0;
            const cz = (j - (N - 1) / 2) * 1.0;
            const near = Math.exp(-(cx * cx + cz * cz) / 14);
            const height = 0.25 + (0.4 + 3.2 * near) * (0.3 + 0.7 * random());
            const half = 0.28 + 0.1 * random();
            const material = height > 2 ? materials[3 + Math.floor(random() * 3)] : materials[Math.floor(random() * 3)];

            // Taller buildings are offices, with windows up their sides
            // (four floors to the texture, about 0.12 a floor) under a
            // plain roof.
            const turn = random() < 0.15 ? 0.3 : 0;
            if (height > 1.0) {
                // Boxes map textures by world size: four bays every 0.6
                // across, four floors every 0.48 up.
                const offices = Material.plastic(material.color, 0.3).withTexture(windows(), new Vec2(1 / 0.6, 1 / 0.48), material.color.lerp(new Vec3(1, 1, 1), 0.5));
                boxes.push(Box.fromCorners(new Vec3(cx - half, 0, cz - half), new Vec3(cx + half, height, cz + half), offices, turn));
                boxes.push(Box.fromCorners(new Vec3(cx - half - 0.01, height, cz - half - 0.01), new Vec3(cx + half + 0.01, height + 0.03, cz + half + 0.01), material, turn));
            }
            else {
                boxes.push(Box.fromCorners(new Vec3(cx - half, 0, cz - half), new Vec3(cx + half, height, cz + half), material, turn));
            }

            // Tall towers get a setback and a spire.
            if (height > 2.4) {
                const top = height + 0.5 + random() * 0.6;
                boxes.push(Box.fromCorners(new Vec3(cx - half * 0.6, height, cz - half * 0.6), new Vec3(cx + half * 0.6, top, cz + half * 0.6), material));
                boxes.push(Box.fromCorners(new Vec3(cx - 0.02, top, cz - 0.02), new Vec3(cx + 0.02, top + 0.5, cz + 0.02), Material.metal(hexColor("#cfd3d8"), 0.2)));
            }
        }
    }

    return boxes;
}

/** A small city at golden hour, seen from the air. */
export function tinyCity() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.18, 0.3, 0.6),
            horizon: new Vec3(1.0, 0.72, 0.45),
            ground: new Vec3(0.2, 0.15, 0.1),
            sunStrength: 4.0,
            sunDirection: new Vec3(-0.75, 0.3, -0.4),
            sunColor: new Vec3(1.0, 0.78, 0.5),
            sunSize: 0.04,
        }),
    });

    scene.add(
        new Quad(new Vec3(-50, 0, 50), new Vec3(100, 0, 0), new Vec3(0, 0, -100), Material.diffuse(hexColor("#3b3d40"))),
        // A park and a lake on the edge of town.
        new Quad(new Vec3(-9, 0.005, 9), new Vec3(4, 0, 0), new Vec3(0, 0, -5), Material.diffuse(hexColor("#4d7a3a"))),
        new Quad(new Vec3(-8.3, 0.01, 8.2), new Vec3(2.6, 0, 0), new Vec3(0, 0, -3), Material.metal(hexColor("#a8c8d8"), 0.02)));

    scene.add(...buildings());

    return {
        scene,
        camera: {
            position: new Vec3(9.5, 8.0, 10.5),
            target: new Vec3(0.0, 0.6, 0.0),
            fov: 40.0 * Math.PI / 180.0,
        },
    };
}
