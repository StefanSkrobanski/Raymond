/**
 * A 4D vector: a homogeneous point (w = 1) or direction (w = 0). Immutable.
 */
export class Vec4 {

    #x = 0.0;
    #y = 0.0;
    #z = 0.0;
    #w = 0.0;

    /**
     * @param {number} [x]
     * @param {number} [y]
     * @param {number} [z]
     * @param {number} [w]
     */
    constructor(x = 0.0, y = 0.0, z = 0.0, w = 0.0) {
        this.#x = x;
        this.#y = y;
        this.#z = z;
        this.#w = w;
    }

    get x() {
        return this.#x;
    }

    get y() {
        return this.#y;
    }

    get z() {
        return this.#z;
    }

    get w() {
        return this.#w;
    }

    /** @param {Vec4} other */
    dot(other) {

        return this.x * other.x +
            this.y * other.y +
            this.z * other.z +
            this.w * other.w;
    }

    /**
     * The point a fraction t of the way from this vector to other.
     * @param {Vec4} other
     * @param {number} t
     */
    lerp(other, t) {

        return new Vec4(
            this.x + (other.x - this.x) * t,
            this.y + (other.y - this.y) * t,
            this.z + (other.z - this.z) * t,
            this.w + (other.w - this.w) * t);
    }
}
