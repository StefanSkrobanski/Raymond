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
