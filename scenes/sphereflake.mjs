import { Material, Quad, Scene, Sky, Sphere, Vec3, hexColor } from "../src/index.mjs";

/**
 * Eric Haines's sphereflake, the classic ray tracing benchmark: a sphere
 * with nine smaller spheres on it, each with nine on it, and so on. Each
 * child is a third the size of its parent, set on its surface pointing
 * away from the grandparent.
 * @param {Vec3} centre
 * @param {number} radius
 * @param {Vec3} up the direction from the parent
 * @param {number} depth
 * @param {Material} material
 * @returns {Sphere[]}
 */
export function sphereflake(centre, radius, up, depth, material) {

    const spheres = [new Sphere(centre, radius, material)];
    if (depth == 0)
        return spheres;

    // Two directions across up, for placing the children round it.
    const helper = Math.abs(up.y) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0);
    const side = up.cross(helper).normalized();
    const other = up.cross(side);
    const child = radius / 3;

    // Six round the equator, three higher up, as in the original.
    const directions = [];
    for (let k = 0; k < 6; ++k) {
        const a = k * Math.PI / 3;
        directions.push(side.scale(Math.cos(a)).add(other.scale(Math.sin(a))).add(up.scale(-0.15)).normalized());
    }
    for (let k = 0; k < 3; ++k) {
        const a = k * 2 * Math.PI / 3 + Math.PI / 6;
        directions.push(side.scale(Math.cos(a) * 0.65).add(other.scale(Math.sin(a) * 0.65)).add(up.scale(0.76)).normalized());
    }

    for (const d of directions)
        spheres.push(...sphereflake(centre.add(d.scale(radius + child)), child, d, depth - 1, material));

    return spheres;
}

/** A chrome sphereflake, 7381 mirror balls, reflecting itself without end. */
export function sphereflakeScene() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#2b4b8a"),
            horizon: hexColor("#e8d8c0"),
            ground: hexColor("#3a3028"),
            sunStrength: 3.0,
            sunDirection: new Vec3(-0.5, 0.7, 0.4),
            sunSize: 0.05,
        }),
    });

    scene.add(
        new Quad(new Vec3(-40, 0, 40), new Vec3(80, 0, 0), new Vec3(0, 0, -80), Material.checkered(hexColor("#d8d0c4"), hexColor("#3a3a44"), 0.75)),
        ...sphereflake(new Vec3(0, 1.0, 0), 1.0, new Vec3(0, 1, 0), 4, Material.metal(hexColor("#f2f2f5"), 0.02)));

    return {
        scene,
        camera: {
            position: new Vec3(2.6, 2.5, 3.6),
            target: new Vec3(0, 1.15, 0),
            fov: 42 * Math.PI / 180,
        },
        bounces: 12,
    };
}
