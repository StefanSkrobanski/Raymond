// A 2 x 2 matrix, used by Mat3's determinant. Not part of the public API.
export class Mat2 {

    #values = new Array(4);

    /**
     * Values are given row by row.
     * @param {number} _00 @param {number} _01
     * @param {number} _10 @param {number} _11
     */
    constructor(
        _00, _01,
        _10, _11) {

        this.#values[0] = _00;
        this.#values[1] = _01;
        this.#values[2] = _10;
        this.#values[3] = _11;
    }

    /**
     * @param {number} row
     * @param {number} column
     */
    value(row, column) {

        return this.#values[row * 2 + column];
    }

    determinant() {

        return this.value(0, 0) * this.value(1, 1) - this.value(0, 1) * this.value(1, 0);
    }
}
