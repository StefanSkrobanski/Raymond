import { Mat4 } from "./Mat4.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Material } from "./Material.mjs" */

/**
 * The cube from -1 to 1 on each axis, moved by a transform, which may
 * rotate, stretch and shear it into any parallelepiped. Immutable.
 */
export class Box {

    #transform;
    #inverse;
    #material;

    /**
     * @param {Mat4} transform an affine transform (bottom row 0, 0, 0, 1)
     *   with an inverse
     * @param {Material} material
     */
    constructor(transform, material) {

        this.#transform = transform;
        this.#inverse = transform.inverse();
        this.#material = material;
    }

    /**
     * An axis-aligned box between two corners, optionally turned about its
     * centre's vertical axis.
     * @param {Vec3} min
     * @param {Vec3} max
     * @param {Material} material
     * @param {number} [rotateY] angle in radians
     */
    static fromCorners(min, max, material, rotateY = 0.0) {

        const center = min.add(max).scale(0.5);
        const half = max.subtract(min).scale(0.5);

        const transform = Mat4.translate(center.x, center.y, center.z)
            .multiplyMat4(Mat4.rotateY(rotateY))
            .multiplyMat4(Mat4.scale(half.x, half.y, half.z));

        return new Box(transform, material);
    }

    /**
     * A square-sectioned stick from a to b, thickness across, such as a
     * rod, a string or a beam.
     * @param {Vec3} a
     * @param {Vec3} b
     * @param {number} thickness
     * @param {Material} material
     */
    static between(a, b, thickness, material) {

        const center = a.add(b).scale(0.5);
        const along = b.subtract(a);
        const half_length = along.length() / 2.0;

        if (!(half_length > 0.0))
            throw new RangeError("A stick's ends must differ.");

        // Any two directions across the stick, at right angles.
        const z = along.normalized();
        const helper = Math.abs(z.y) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0);
        const x = helper.cross(z).normalized();
        const y = z.cross(x);
        const t = thickness / 2.0;

        return new Box(new Mat4(
            x.x * t, y.x * t, z.x * half_length, center.x,
            x.y * t, y.y * t, z.y * half_length, center.y,
            x.z * t, y.z * t, z.z * half_length, center.z,
            0.0, 0.0, 0.0, 1.0), material);
    }

    get transform() {
        return this.#transform;
    }

    /** World to box space. */
    get inverse() {
        return this.#inverse;
    }

    get material() {
        return this.#material;
    }

    /** The box's 8 corners in world space. */
    corners() {

        /** @type {Vec3[]} */
        const corners = [];

        for (const x of [-1.0, 1.0])
            for (const y of [-1.0, 1.0])
                for (const z of [-1.0, 1.0])
                    corners.push(this.#transform.multiplyVector3(new Vec3(x, y, z)));

        return corners;
    }
}
