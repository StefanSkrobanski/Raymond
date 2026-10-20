import { Box, Material, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";
import { seededRandom } from "./helpers.mjs";

/**
 * The stones, as boxes: a ring of uprights with lintels across their tops,
 * a horseshoe of tall trilithons inside, and a few fallen.
 */
export function stones() {

    const random = seededRandom(5);
    const stone = () => Material.diffuse(hexColor(random() < 0.5 ? "#8f8a7e" : "#7d786c"));
    const boxes = [];
    const RING = 30, R = 5.0;

    for (let i = 0; i < RING; ++i) {

        const a = (i / RING) * 2 * Math.PI;
        // A gap in the ring, the way the sun comes in.
        if (i >= 13 && i <= 15)
            continue;

        const x = R * Math.cos(a), z = R * Math.sin(a);
        const lean = (random() - 0.5) * 0.08;
        boxes.push(Box.fromCorners(new Vec3(x - 0.32, 0, z - 0.22), new Vec3(x + 0.32, 2.2, z + 0.22), stone(), -a + Math.PI / 2 + lean));

        // Every other pair carries a lintel.
        if (i % 2 == 0 && i + 1 < RING && !(i + 1 >= 13 && i + 1 <= 15)) {
            const b = ((i + 0.5) / RING) * 2 * Math.PI;
            const lx = R * Math.cos(b), lz = R * Math.sin(b);
            boxes.push(Box.fromCorners(new Vec3(lx - 0.75, 2.2, lz - 0.22), new Vec3(lx + 0.75, 2.6, lz + 0.22), stone(), -b + Math.PI / 2));
        }
    }

    // The horseshoe: five trilithons, taller towards the closed end.
    for (let k = 0; k < 5; ++k) {
        const a = Math.PI * (0.25 + 0.375 * k) + Math.PI / 2;
        const r = 2.6;
        const height = 3.0 + 0.6 * (2 - Math.abs(k - 2));
        const cx = r * Math.cos(a), cz = r * Math.sin(a);
        const turn = -a + Math.PI / 2;
        const across = new Vec3(Math.cos(a + Math.PI / 2), 0, Math.sin(a + Math.PI / 2)).scale(0.55);
        for (const side of [-1, 1])
            boxes.push(Box.fromCorners(new Vec3(cx + across.x * side - 0.4, 0, cz + across.z * side - 0.3),
                new Vec3(cx + across.x * side + 0.4, height, cz + across.z * side + 0.3), stone(), turn));
        if (k != 1)
            boxes.push(Box.fromCorners(new Vec3(cx - 1.0, height, cz - 0.3), new Vec3(cx + 1.0, height + 0.45, cz + 0.3), stone(), turn));
    }

    // Fallen stones, lying in the grass.
    boxes.push(Box.fromCorners(new Vec3(1.0, 0, 6.2), new Vec3(3.2, 0.5, 7.0), stone(), 0.3));
    boxes.push(Box.fromCorners(new Vec3(-3.0, 0, -1.0), new Vec3(-1.4, 0.4, -0.4), stone(), 1.1));

    return boxes;
}

/** Stonehenge at dawn, the low sun reaching through the stones across the grass. */
export function stonehenge() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.2, 0.32, 0.6),
            horizon: new Vec3(1.0, 0.68, 0.45),
            ground: new Vec3(0.15, 0.13, 0.1),
            sunStrength: 4.0,
            sunDirection: new Vec3(-0.85, 0.16, 0.45),
            sunColor: new Vec3(1.0, 0.72, 0.45),
            sunSize: 0.035,
        }),
    });

    scene.add(new Quad(new Vec3(-80, 0, 80), new Vec3(160, 0, 0), new Vec3(0, 0, -160), Material.diffuse(hexColor("#5c7a3a"))));
    scene.add(...stones());

    return {
        scene,
        camera: {
            position: new Vec3(9.5, 3.2, 8.5),
            target: new Vec3(0, 1.4, 0),
            fov: 44 * Math.PI / 180,
        },
    };
}
