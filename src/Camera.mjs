import { Mat4 } from "./Mat4.mjs";
import { Vec3 } from "./Vec3.mjs";

/**
 * @typedef {object} CameraOptions
 * @property {Vec3} [position]
 * @property {Vec3} [target] the point looked at
 * @property {Vec3} [up] roughly upwards; must not point along the line of
 *   sight
 * @property {number} [fov] vertical field of view in radians
 * @property {number} [aperture] the lens radius: 0 for a pinhole camera
 *   with everything sharp; larger blurs what's out of focus more
 * @property {number} [focusDistance] how far ahead things are sharpest; 0
 *   to focus on the target
 */

/**
 * A thin-lens camera. It looks from position towards target, down its own
 * -z axis, with right-handed axes, as in Styx.
 */
export class Camera {

    #position;
    #target;
    #up;
    #fov;
    #aperture;
    #focusDistance;

    /** @param {CameraOptions} [options] */
    constructor({
        position = new Vec3(0.0, 0.0, 5.0),
        target = new Vec3(0.0, 0.0, 0.0),
        up = new Vec3(0.0, 1.0, 0.0),
        fov = 40.0 * Math.PI / 180.0,
        aperture = 0.0,
        focusDistance = 0.0,
    } = {}) {

        this.#position = position;
        this.#target = target;
        this.#up = up;
        this.#fov = fov;
        this.#aperture = aperture;
        this.#focusDistance = focusDistance;
    }

    get position() {
        return this.#position;
    }

    set position(value) {
        this.#position = value;
    }

    get target() {
        return this.#target;
    }

    set target(value) {
        this.#target = value;
    }

    get up() {
        return this.#up;
    }

    set up(value) {
        this.#up = value;
    }

    /** Vertical field of view in radians. */
    get fov() {
        return this.#fov;
    }

    set fov(value) {
        this.#fov = value;
    }

    /** The lens radius. */
    get aperture() {
        return this.#aperture;
    }

    set aperture(value) {
        this.#aperture = Math.max(value, 0.0);
    }

    /** 0 focuses on the target. */
    get focusDistance() {
        return this.#focusDistance;
    }

    set focusDistance(value) {
        this.#focusDistance = Math.max(value, 0.0);
    }

    /** The distance that's in focus, after resolving 0 to the target's. */
    get effectiveFocusDistance() {
        return this.#focusDistance > 0.0 ?
            this.#focusDistance :
            this.#target.subtract(this.#position).length();
    }

    /** Camera to world, from Mat4.lookAt. */
    get matrix() {
        return Mat4.lookAt(this.#position, this.#target, this.#up);
    }

    /**
     * The camera's unit axes in world space: right, up and forward (towards
     * the target, the camera's -z).
     */
    basis() {

        const m = this.matrix;
        const right = new Vec3(m.value(0, 0), m.value(1, 0), m.value(2, 0));
        const up = new Vec3(m.value(0, 1), m.value(1, 1), m.value(2, 1));
        const forward = new Vec3(-m.value(0, 2), -m.value(1, 2), -m.value(2, 2));

        return { right, up, forward };
    }

    /**
     * The ray through a point on the image, ignoring the lens, as the
     * shader computes it. x and y go from -1 to 1, left to right and bottom
     * to top.
     * @param {number} x
     * @param {number} y
     * @param {number} aspectRatio width / height
     * @returns {{ origin: Vec3, direction: Vec3 }} direction is unit length
     */
    ray(x, y, aspectRatio) {

        const { right, up, forward } = this.basis();
        const tan_half = Math.tan(this.#fov / 2.0);

        const direction = forward
            .add(right.scale(x * tan_half * aspectRatio))
            .add(up.scale(y * tan_half))
            .normalized();

        return { origin: this.#position, direction };
    }

    /**
     * The ray through the centre of pixel (px, py) of a width × height
     * image, counting from the top left.
     * @param {number} px
     * @param {number} py
     * @param {number} width
     * @param {number} height
     */
    pixelRay(px, py, width, height) {

        const x = 2.0 * (px + 0.5) / width - 1.0;
        const y = 1.0 - 2.0 * (py + 0.5) / height;

        return this.ray(x, y, width / height);
    }
}
