import { Mat2 } from "./Mat2.mjs";

// A 3 x 3 matrix, used by Mat4's determinant and inverse. Not part of the
// public API.
export class Mat3 {

    #values = new Array(9);

    /**
     * Values are given row by row.
     * @param {number} _00 @param {number} _01 @param {number} _02
     * @param {number} _10 @param {number} _11 @param {number} _12
     * @param {number} _20 @param {number} _21 @param {number} _22
     */
    constructor(
        _00, _01, _02,
        _10, _11, _12,
        _20, _21, _22) {

        this.#values[0] = _00;
        this.#values[1] = _01;
        this.#values[2] = _02;

        this.#values[3] = _10;
        this.#values[4] = _11;
        this.#values[5] = _12;

        this.#values[6] = _20;
        this.#values[7] = _21;
        this.#values[8] = _22;
    }

    /**
     * @param {number} row
     * @param {number} column
     */
    value(row, column) {

        return this.#values[row * 3 + column];
    }

    // The 2 x 2 matrix left by removing a row and a column.
    /**
     * @param {number} row
     * @param {number} column
     */
    #submatrix(row, column) {

        /** @type {number[]} */
        const values = [];

        for (let i = 0; i < 3; ++i) {
            for (let j = 0; j < 3; ++j) {
                if (i != row && j != column)
                    values.push(this.value(i, j));
            }
        }

        return new Mat2(values[0], values[1], values[2], values[3]);
    }

    determinant() {

        let determinant = 0.0;

        for (let column = 0; column < 3; ++column) {

            const minor = this.#submatrix(0, column).determinant();
            const cofactor = column % 2 == 1 ? -minor : minor;

            determinant += this.value(0, column) * cofactor;
        }

        return determinant;
    }
}
