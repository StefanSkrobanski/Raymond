import { Vec3 } from "./Vec3.mjs";
import { Vec4 } from "./Vec4.mjs";
import { Mat3 } from "./Mat3.mjs";

/**
 * A 4 x 4 matrix for 3D transforms. Vectors are columns, multiplied as
 * M * v, so translation lives in the last column, and a.multiplyMat4(b)
 * applies b first, then a. Rotations follow the right-hand rule: a positive
 * angle turns anticlockwise, looking back along the axis towards the origin.
 * The constructor takes the values row by row.
 */
export class Mat4 {

    #values = new Array(16);

    /**
     * @param {number} _00 @param {number} _01 @param {number} _02 @param {number} _03
     * @param {number} _10 @param {number} _11 @param {number} _12 @param {number} _13
     * @param {number} _20 @param {number} _21 @param {number} _22 @param {number} _23
     * @param {number} _30 @param {number} _31 @param {number} _32 @param {number} _33
     */
    constructor(
        _00, _01, _02, _03,
        _10, _11, _12, _13,
        _20, _21, _22, _23,
        _30, _31, _32, _33) {

        this.#values[0] = _00;
        this.#values[1] = _01;
        this.#values[2] = _02;
        this.#values[3] = _03;

        this.#values[4] = _10;
        this.#values[5] = _11;
        this.#values[6] = _12;
        this.#values[7] = _13;

        this.#values[8] = _20;
        this.#values[9] = _21;
        this.#values[10] = _22;
        this.#values[11] = _23;

        this.#values[12] = _30;
        this.#values[13] = _31;
        this.#values[14] = _32;
        this.#values[15] = _33;
    }

    /**
     * @param {number} row 0 to 3
     * @param {number} column 0 to 3
     */
    value(row, column) {

        Mat4.#checkIndex(row, column);

        return this.#values[row * 4 + column];
    }

    /**
     * @param {number} row 0 to 3
     * @param {number} column 0 to 3
     * @param {number} value
     */
    setValue(row, column, value) {

        Mat4.#checkIndex(row, column);

        this.#values[row * 4 + column] = value;
    }

    /** @param {number} index 0 to 3 */
    row(index) {

        Mat4.#checkIndex(index, 0);

        return new Vec4(
            this.value(index, 0),
            this.value(index, 1),
            this.value(index, 2),
            this.value(index, 3));
    }

    /** @param {number} index 0 to 3 */
    column(index) {

        Mat4.#checkIndex(0, index);

        return new Vec4(
            this.value(0, index),
            this.value(1, index),
            this.value(2, index),
            this.value(3, index));
    }

    determinant() {

        let determinant = 0.0;

        for (let column = 0; column < 4; ++column) {
            determinant += this.value(0, column) * this.#cofactor(0, column);
        }

        return determinant;
    }

    /**
     * The inverse matrix. Throws a RangeError if there is none (the
     * determinant is 0).
     */
    inverse() {

        const det = this.determinant();
        if (det == 0.0)
            throw new RangeError("The matrix has no inverse.");

        const inverse = Mat4.identity();

        for (let row = 0; row < 4; ++row) {
            for (let column = 0; column < 4; ++column) {
                const value = this.#cofactor(row, column) / det;

                inverse.setValue(column, row, value);
            }
        }

        return inverse;
    }

    // Reads the values directly rather than building a Vec4 per row.
    /** @param {Vec4} vec4 */
    multiplyVector4(vec4) {

        const m = this.#values;
        const vx = vec4.x, vy = vec4.y, vz = vec4.z, vw = vec4.w;

        return new Vec4(
            m[0] * vx + m[1] * vy + m[2] * vz + m[3] * vw,
            m[4] * vx + m[5] * vy + m[6] * vz + m[7] * vw,
            m[8] * vx + m[9] * vy + m[10] * vz + m[11] * vw,
            m[12] * vx + m[13] * vy + m[14] * vz + m[15] * vw);
    }

    // Hot path: called for every mesh vertex when packing a scene.
    /**
     * Transforms a point (w = 1), ignoring the bottom row, so it suits
     * transforms without perspective.
     * @param {Vec3} vec3
     */
    multiplyVector3(vec3) {

        const m = this.#values;
        const vx = vec3.x, vy = vec3.y, vz = vec3.z;

        return new Vec3(
            m[0] * vx + m[1] * vy + m[2] * vz + m[3],
            m[4] * vx + m[5] * vy + m[6] * vz + m[7],
            m[8] * vx + m[9] * vy + m[10] * vz + m[11]);
    }

    /**
     * Transforms a direction (w = 0): the translation doesn't apply.
     * @param {Vec3} vec3
     */
    multiplyDirection(vec3) {

        const m = this.#values;
        const vx = vec3.x, vy = vec3.y, vz = vec3.z;

        return new Vec3(
            m[0] * vx + m[1] * vy + m[2] * vz,
            m[4] * vx + m[5] * vy + m[6] * vz,
            m[8] * vx + m[9] * vy + m[10] * vz);
    }

    /** The matrix with rows and columns swapped. */
    transpose() {

        const m = this.#values;

        return new Mat4(
            m[0], m[4], m[8], m[12],
            m[1], m[5], m[9], m[13],
            m[2], m[6], m[10], m[14],
            m[3], m[7], m[11], m[15]);
    }

    // Reads the values directly, as multiplyVector4 does.
    /**
     * This matrix times mat4: the transform that applies mat4, then this.
     * @param {Mat4} mat4
     */
    multiplyMat4(mat4) {

        const result = Mat4.identity();
        const a = this.#values;
        const b = mat4.#values;
        const out = result.#values;

        for (let r = 0; r < 4; ++r) {
            for (let c = 0; c < 4; ++c) {

                out[r * 4 + c] =
                    a[r * 4] * b[c] +
                    a[r * 4 + 1] * b[4 + c] +
                    a[r * 4 + 2] * b[8 + c] +
                    a[r * 4 + 3] * b[12 + c];
            }
        }

        return result;
    }

    static identity() {

        return new Mat4(
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    static translate(x, y, z) {

        return new Mat4(
            1.0, 0.0, 0.0, x,
            0.0, 1.0, 0.0, y,
            0.0, 0.0, 1.0, z,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    static scale(x, y, z) {

        return new Mat4(
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            0.0, 0.0, z, 0.0,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * Turns y towards z.
     * @param {number} theta angle in radians
     */
    static rotateX(theta) {

        const sin_theta = Math.sin(theta);
        const cos_theta = Math.cos(theta);

        return new Mat4(
            1.0, 0.0, 0.0, 0.0,
            0.0, cos_theta, -sin_theta, 0.0,
            0.0, sin_theta, cos_theta, 0.0,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * Turns z towards x.
     * @param {number} theta angle in radians
     */
    static rotateY(theta) {

        const sin_theta = Math.sin(theta);
        const cos_theta = Math.cos(theta);

        return new Mat4(
            cos_theta, 0.0, sin_theta, 0.0,
            0.0, 1.0, 0.0, 0.0,
            -sin_theta, 0.0, cos_theta, 0.0,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * Turns x towards y.
     * @param {number} theta angle in radians
     */
    static rotateZ(theta) {

        const sin_theta = Math.sin(theta);
        const cos_theta = Math.cos(theta);

        return new Mat4(
            cos_theta, -sin_theta, 0.0, 0.0,
            sin_theta, cos_theta, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * A camera's transform (camera to world) at eye, looking at target,
     * with up roughly upwards. The camera looks down its -z axis, matching
     * perspective(). up must not point along the line of sight.
     * @param {Vec3} eye
     * @param {Vec3} target
     * @param {Vec3} up
     */
    static lookAt(eye, target, up) {

        const look = target.subtract(eye).normalized();
        const right = look.cross(up).normalized();
        const true_up = right.cross(look);

        return new Mat4(
            right.x, true_up.x, -look.x, eye.x,
            right.y, true_up.y, -look.y, eye.y,
            right.z, true_up.z, -look.z, eye.z,
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * An orthographic projection of the box from left to right, bottom to
     * top and -near to -far along z (in front of the camera), to clip space.
     * @param {number} left
     * @param {number} right
     * @param {number} bottom
     * @param {number} top
     * @param {number} near
     * @param {number} far
     */
    static orthographic(left, right, bottom, top, near, far) {

        return new Mat4(
            2.0 / (right - left), 0.0, 0.0, -((right + left) / (right - left)),
            0.0, 2.0 / (top - bottom), 0.0, -((top + bottom) / (top - bottom)),
            0.0, 0.0, -2.0 / (far - near), -((far + near) / (far - near)),
            0.0, 0.0, 0.0, 1.0);
    }

    /**
     * A perspective projection to clip space, OpenGL style: the near and far
     * planes map to z = -1 and +1 after the divide by w.
     * @param {number} fov vertical field of view in radians
     * @param {number} aspectRatio width / height
     * @param {number} near distance to the near plane, more than 0
     * @param {number} far distance to the far plane
     */
    static perspective(fov, aspectRatio, near, far) {

        const tan_fov_2 = Math.tan(fov / 2.0);

        return new Mat4(
            1.0 / (aspectRatio * tan_fov_2), 0.0, 0.0, 0.0,
            0.0, 1.0 / tan_fov_2, 0.0, 0.0,
            0.0, 0.0, -((far + near) / (far - near)), -(2 * far * near) / (far - near),
            0.0, 0.0, -1.0, 0.0);
    }

    // The 3 x 3 matrix left by removing a row and a column.
    /**
     * @param {number} row
     * @param {number} column
     */
    #submatrix(row, column) {

        /** @type {number[]} */
        const values = [];

        for (let i = 0; i < 4; ++i) {
            for (let j = 0; j < 4; ++j) {
                if (i != row && j != column)
                    values.push(this.value(i, j));
            }
        }

        return new Mat3(
            values[0], values[1], values[2],
            values[3], values[4], values[5],
            values[6], values[7], values[8]);
    }

    /**
     * @param {number} row
     * @param {number} column
     */
    #cofactor(row, column) {

        const minor = this.#submatrix(row, column).determinant();

        return (row + column) % 2 == 1 ? -minor : minor;
    }

    /**
     * @param {number} row
     * @param {number} column
     */
    static #checkIndex(row, column) {

        if (!(row >= 0 && row <= 3 && column >= 0 && column <= 3))
            throw new RangeError(`No element (${row}, ${column}) in a 4 x 4 matrix.`);
    }
}
