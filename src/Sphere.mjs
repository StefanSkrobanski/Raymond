import { Mat4 } from "./Mat4.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Material } from "./Material.mjs" */

/**
 * A sphere. A texture wraps it by latitude and longitude, like a globe:
 * u goes once round the equator, anticlockwise seen from above (from +x
 * towards -z), and v from the north pole (+y) at the top of the image to
 * the south pole at the bottom. A rotation turns the globe. Immutable.
 */
export class Sphere {

    #center;
    #radius;
    #material;
    #rotation;

    /**
     * @param {Vec3} center
     * @param {number} radius
     * @param {Material} material
     * @param {{ rotation?: Mat4 }} [options] rotation: turns the texture's
     *   globe, for a tilted or spinning planet; only its rotation is used
     */
    constructor(center, radius, material, { rotation = Mat4.identity() } = {}) {

        if (!(radius > 0.0))
            throw new RangeError("A sphere's radius must be more than 0.");

        this.#center = center;
        this.#radius = radius;
        this.#material = material;
        this.#rotation = rotation;
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

    get rotation() {
        return this.#rotation;
    }

    /**
     * The globe's axes in world space, unit length: where its +x (u = 0 on
     * the equator) and its north pole point.
     */
    axes() {
        return {
            x: this.#rotation.multiplyDirection(new Vec3(1, 0, 0)).normalized(),
            north: this.#rotation.multiplyDirection(new Vec3(0, 1, 0)).normalized(),
        };
    }
}
