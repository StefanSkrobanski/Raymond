/**
 * A 3D point, vector or linear RGB colour. The arithmetic returns new
 * vectors, but x, y and z can be set.
 */
export class Vec3 {

    #x = 0.0;
    #y = 0.0;
    #z = 0.0;

    /**
     * @param {number} [x]
     * @param {number} [y]
     * @param {number} [z]
     */
    constructor(x = 0.0, y = 0.0, z = 0.0) {
        this.#x = x;
        this.#y = y;
        this.#z = z;
    }

    get x() {
        return this.#x;
    }

    set x(x) {
        this.#x = x;
    }

    get y() {
        return this.#y;
    }

    set y(y) {
        this.#y = y;
    }

    get z() {
        return this.#z;
    }

    set z(z) {
        this.#z = z;
    }

    /** @param {Vec3} other */
    add(other) {

        return new Vec3(
            this.x + other.x,
            this.y + other.y,
            this.z + other.z);
    }

    /** @param {Vec3} other */
    subtract(other) {

        return new Vec3(
            this.x - other.x,
            this.y - other.y,
            this.z - other.z);
    }

    /** @param {number} factor */
    scale(factor) {

        return new Vec3(this.x * factor, this.y * factor, this.z * factor);
    }

    /**
     * Multiplies component by component, as when tinting one colour by
     * another.
     * @param {Vec3} other
     */
    multiply(other) {

        return new Vec3(this.x * other.x, this.y * other.y, this.z * other.z);
    }

    negate() {

        return new Vec3(-this.x, -this.y, -this.z);
    }

    /**
     * The point a fraction t of the way from this vector to other.
     * @param {Vec3} other
     * @param {number} t
     */
    lerp(other, t) {

        return new Vec3(
            this.x + (other.x - this.x) * t,
            this.y + (other.y - this.y) * t,
            this.z + (other.z - this.z) * t);
    }

    /** @param {Vec3} other */
    cross(other) {

        const x = this.#y * other.z - this.#z * other.y;
        const y = this.#z * other.x - this.#x * other.z;
        const z = this.#x * other.y - this.#y * other.x;

        return new Vec3(x, y, z);
    }

    /** @param {Vec3} other */
    dot(other) {

        return this.x * other.x + this.y * other.y + this.z * other.z;
    }

    length() {

        return Math.sqrt(this.#x * this.#x + this.#y * this.#y + this.#z * this.#z);
    }

    /** This vector scaled to length 1. */
    normalized() {

        const length = this.length();
        const x = this.#x / length;
        const y = this.#y / length;
        const z = this.#z / length;

        return new Vec3(x, y, z);
    }

    toString() {

        return `x: ${this.#x} y: ${this.#y} z: ${this.#z}`;
    }
}
