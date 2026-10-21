import { Mat4, Material, Mesh, Quad, Scene, Sky, Sphere, Texture, Vec3, hexColor } from "../src/index.mjs";
import { floor, profile, seededRandom } from "./helpers.mjs";

/**
 * A prism: a triangular glass column, turned on the lathe with three sides.
 * @param {Material} material
 * @param {number} radius from the axis to each edge
 * @param {number} height
 */
export function prismMesh(material, radius, height) {
    return Mesh.lathe(profile([[0, 0], [radius, 0], [radius, 0], [radius, height], [radius, height], [0, height]]),
        material, { segments: 3, shading: "flat" });
}

/** Black bars of different widths on white, upright, like a bar code. */
function bars() {
    const random = seededRandom(7);
    const edges = [0];
    while (edges[edges.length - 1] < 1)
        edges.push(edges[edges.length - 1] + 0.03 + 0.07 * random());
    return Texture.procedural(512, 8, (u) => {
        const k = edges.findIndex((e) => e > u);
        return k % 2 == 1 ? new Vec3(0.85, 0.85, 0.85) : new Vec3(0.02, 0.02, 0.02);
    });
}

/**
 * Glass that splits light into its colours: a flint glass prism and ball
 * in a booth of black bars on white, every edge of which they spread into
 * a rainbow, seen through them.
 */
export function prism() {

    const grey = new Vec3(0.25, 0.25, 0.27);
    const scene = new Scene({ sky: new Sky({ zenith: grey, horizon: grey, ground: grey }) });
    const board = Material.diffuse(new Vec3(1, 1, 1)).withTexture(bars());

    // Dense flint, made fierier than real glass.
    const flint = Material.glass(1.65, new Vec3(1, 1, 1), 22);

    scene.add(
        floor(30, Material.plastic(hexColor("#26262b"), 0.3)),
        // The bars, on boards behind and to each side: the prism turns what's
        // seen through it about 40 degrees.
        new Quad(new Vec3(-4, 0, -2.5), new Vec3(8, 0, 0), new Vec3(0, 3.5, 0), board),
        new Quad(new Vec3(-4, 0, 3), new Vec3(0, 0, -5.5), new Vec3(0, 3.5, 0), board),
        new Quad(new Vec3(4, 0, -2.5), new Vec3(0, 0, 5.5), new Vec3(0, 3.5, 0), board),
        // A big soft light overhead, in front, out of shot.
        new Quad(new Vec3(-3, 4.5, 1.0), new Vec3(6, 0, 0), new Vec3(0, 0, 2.5), Material.light(new Vec3(1, 0.98, 0.95), 3.0)));

    scene.add(
        prismMesh(flint, 0.7, 2.0).transformed(Mat4.translate(-0.5, 0, 0).multiplyMat4(Mat4.rotateY(0.3))),
        new Sphere(new Vec3(1.35, 0.55, 0.6), 0.55, Material.glass(1.6, new Vec3(1, 1, 1), 12)));

    return {
        scene,
        camera: {
            position: new Vec3(0.3, 1.3, 4.6),
            target: new Vec3(0, 0.9, -0.5),
            fov: 45 * Math.PI / 180,
        },
        bounces: 12,
    };
}
