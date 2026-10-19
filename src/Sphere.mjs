/** @import { Material } from "./Material.mjs" */
/** @import { Vec3 } from "./Vec3.mjs" */

/** A sphere. Immutable. */
export class Sphere {

    #center;
    #radius;
    #material;

    /**
     * @param {Vec3} center
     * @param {number} radius
     * @param {Material} material
     */
    constructor(center, radius, material) {

        if (!(radius > 0.0))
            throw new RangeError("A sphere's radius must be more than 0.");

        this.#center = center;
        this.#radius = radius;
        this.#material = material;
    }

    get center() {
        return this.#center;
    }

    get radius() {
        return this.#radius;
    }

    get material() {
        return this.#material;
    }
}
