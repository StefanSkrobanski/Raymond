import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";
import { profile } from "./helpers.mjs";

// A thin-walled ring, 1 in radius and 0.5 tall: up the outside, over the
// rim, down the inside, back under.
export const RING = profile([[1.0, 0], [1.04, 0], [1.04, 0.5], [1.0, 0.5], [1.0, 0]]);

/**
 * The coffee cup caustic: light from a low lamp reflects off the inside of
 * a chrome ring and gathers into a bright heart-shaped curve, a cardioid,
 * on the table.
 */
export function coffeeCupCaustic() {

    const scene = new Scene({
        sky: new Sky({ zenith: new Vec3(0.025, 0.025, 0.03), horizon: new Vec3(0.03, 0.03, 0.035), ground: new Vec3(0, 0, 0) }),
    });

    scene.add(
        new Quad(new Vec3(-20, 0, 20), new Vec3(40, 0, 0), new Vec3(0, 0, -40), Material.diffuse(hexColor("#efe9df"))),
        Mesh.lathe(RING, Material.metal(hexColor("#f4f4f6"), 0.0), { segments: 256 }),
        // A low lamp, so the reflected light skims the table. It's fairly
        // big: the caustic can only be found by paths bouncing off the
        // mirror into it, and a tiny lamp would take ages to find.
        new Sphere(new Vec3(-4.0, 1.4, 0), 1.0, Material.light(hexColor("#fff2d8"), 8.0)));

    return {
        scene,
        camera: {
            position: new Vec3(1.2, 3.6, 1.0),
            target: new Vec3(0.0, 0.0, 0.0),
            fov: 42 * Math.PI / 180,
        },
        bounces: 6,
    };
}
