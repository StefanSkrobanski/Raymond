/** A 2D point or vector, such as a position on screen. Immutable. */
export class Vec2 {

    #x = 0.0;
    #y = 0.0;

    /**
     * @param {number} [x]
     * @param {number} [y]
     */
    constructor(x = 0.0, y = 0.0) {
        this.#x = x;
        this.#y = y;
    }

    get x() {
        return this.#x;
    }

    get y() {
        return this.#y;
    }
}
