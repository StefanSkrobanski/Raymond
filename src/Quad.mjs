/** @import { Material } from "./Material.mjs" */
/** @import { Vec3 } from "./Vec3.mjs" */

/**
 * A flat parallelogram with corners at corner, corner + u, corner + v and
 * corner + u + v. Its front faces along u × v, and if it's a light, it
 * shines from the front only. Immutable.
 */
export class Quad {

    #corner;
    #u;
    #v;
    #material;

    /**
     * @param {Vec3} corner
     * @param {Vec3} u
     * @param {Vec3} v
     * @param {Material} material
     */
    constructor(corner, u, v, material) {

        if (!(u.cross(v).length() > 0.0))
            throw new RangeError("A quad's edges must not be parallel.");

        this.#corner = corner;
        this.#u = u;
        this.#v = v;
        this.#material = material;
    }

    get corner() {
        return this.#corner;
    }

    get u() {
        return this.#u;
    }

    get v() {
        return this.#v;
    }

    get material() {
        return this.#material;
    }

    /** The unit normal, facing along u × v. */
    get normal() {
        return this.#u.cross(this.#v).normalized();
    }

    get area() {
        return this.#u.cross(this.#v).length();
    }
}
