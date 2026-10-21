import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";

// The pool: 6 long (x), 4 wide (z) and 1.2 deep, with water up to 0.15
// below the deck.
const LENGTH = 6.0, WIDTH = 4.0, DEPTH = 1.2, WATER = -0.15;

/**
 * The height of the water's surface at (x, z): a few wave trains crossing,
 * long swells and short ripples. A ripple focuses sunlight like a lens of
 * focal length about 4 / (amplitude × wavenumber²) under water, so these
 * short ones, about a metre, draw the bright net on the pool's floor.
 * @param {number} x
 * @param {number} z
 */
export function waveHeight(x, z) {
    return WATER +
        0.02 * Math.sin(2.1 * x + 0.7 * z) +
        0.014 * Math.sin(-1.3 * x + 2.9 * z + 1.0) +
        0.008 * Math.sin(9.0 * x - 5.5 * z + 2.0) +
        0.007 * Math.sin(-4.0 * x - 10.5 * z + 0.5) +
        0.006 * Math.sin(11.0 * x + 6.0 * z + 4.0);
}

/**
 * A swimming pool in the sun. The rippling water bends the sunlight into
 * caustics, the bright wobbling net on the tiles, which photon mapping
 * draws, from the sun through the water and back out to the camera.
 */
export function swimmingPool() {

    const scene = new Scene({
        sky: new Sky({
            zenith: new Vec3(0.15, 0.35, 0.8),
            horizon: new Vec3(0.75, 0.85, 1.0),
            sunStrength: 4.0,
            sunDirection: new Vec3(0.3, 0.9, 0.25),
            sunSize: 0.02,
        }),
    });

    // Pale tiles, two close blues, so the caustics show on them.
    const tiles = Material.checkered(hexColor("#cfe9f4"), hexColor("#a8d3e8"), 0.25);
    const deck = Material.checkered(hexColor("#d9cbb0"), hexColor("#cdbd9f"), 0.6);
    const x0 = -LENGTH / 2, x1 = LENGTH / 2, z0 = -WIDTH / 2, z1 = WIDTH / 2;

    scene.add(
        // The basin, its faces looking inwards.
        new Quad(new Vec3(x0, -DEPTH, z1), new Vec3(LENGTH, 0, 0), new Vec3(0, 0, -WIDTH), tiles),
        new Quad(new Vec3(x0, -DEPTH, z0), new Vec3(LENGTH, 0, 0), new Vec3(0, DEPTH, 0), tiles),
        new Quad(new Vec3(x1, -DEPTH, z1), new Vec3(-LENGTH, 0, 0), new Vec3(0, DEPTH, 0), tiles),
        new Quad(new Vec3(x0, -DEPTH, z1), new Vec3(0, 0, -WIDTH), new Vec3(0, DEPTH, 0), tiles),
        new Quad(new Vec3(x1, -DEPTH, z0), new Vec3(0, 0, WIDTH), new Vec3(0, DEPTH, 0), tiles),
        // The deck round it.
        new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -(20 - z1)), deck),
        new Quad(new Vec3(-20, 0, z0), new Vec3(40, 0, 0), new Vec3(0, 0, -(20 + z0)), deck),
        new Quad(new Vec3(-20, 0, z1), new Vec3(20 + x0, 0, 0), new Vec3(0, 0, -WIDTH), deck),
        new Quad(new Vec3(x1, 0, z1), new Vec3(20 - x1, 0, 0), new Vec3(0, 0, -WIDTH), deck));

    // The water: a rippled sheet, its front facing up, so rays from above
    // enter it and rays from below leave.
    scene.add(Mesh.surface(
        (u, v) => {
            const x = x0 + u * LENGTH;
            const z = z1 - v * WIDTH;
            return new Vec3(x, waveHeight(x, z), z);
        },
        240, 160, Material.glass(1.33, hexColor("#e4fbff"))));

    // A beach ball and a rubber ring, floating.
    scene.add(
        new Sphere(new Vec3(1.3, WATER + 0.12, 0.7), 0.28, Material.plastic(hexColor("#ff4a3a"), 0.15)),
        Mesh.torus(Material.plastic(hexColor("#ffd23a"), 0.2), { radius: 0.32, tube: 0.1, segments: 48, sides: 16 })
            .transformed(Mat4.translate(-1.4, WATER + 0.03, -0.6)));

    return {
        scene,
        camera: {
            position: new Vec3(-0.6, 4.6, 6.4),
            target: new Vec3(0.0, -0.6, 0.0),
            fov: 45.0 * Math.PI / 180.0,
        },
        bounces: 10,
    };
}
