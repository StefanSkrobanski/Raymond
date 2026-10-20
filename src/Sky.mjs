import { Vec3 } from "./Vec3.mjs";

/**
 * @typedef {object} SkyOptions
 * @property {Vec3} [zenith] linear RGB radiance straight up
 * @property {Vec3} [horizon] at the horizon
 * @property {Vec3} [ground] straight down, below the horizon
 * @property {Vec3} [sunDirection] towards the sun; needn't be unit length
 * @property {Vec3} [sunColor] the sun's tint
 * @property {number} [sunStrength] the light falling on a surface facing
 *   the sun, compared with 1 for a white sky all round; 0 for no sun
 * @property {number} [sunSize] the sun's angular radius in radians: larger
 *   suns cast softer shadows
 */

/**
 * The light from everything a ray can escape to: a gradient from the
 * ground through the horizon to the zenith, and an optional sun, a bright
 * disc that the renderer samples directly, so it lights the scene with
 * little noise. Immutable.
 */
export class Sky {

    #zenith;
    #horizon;
    #ground;
    #sunDirection;
    #sunColor;
    #sunStrength;
    #sunSize;

    /** @param {SkyOptions} [options] */
    constructor({
        zenith = new Vec3(0.25, 0.45, 0.9),
        horizon = new Vec3(0.85, 0.9, 1.0),
        ground = new Vec3(0.3, 0.28, 0.25),
        sunDirection = new Vec3(0.5, 0.8, 0.3),
        sunColor = new Vec3(1.0, 0.95, 0.85),
        sunStrength = 0.0,
        sunSize = 0.05,
    } = {}) {

        this.#zenith = zenith;
        this.#horizon = horizon;
        this.#ground = ground;
        this.#sunDirection = sunDirection.normalized();
        this.#sunColor = sunColor;
        this.#sunStrength = Math.max(sunStrength, 0.0);
        this.#sunSize = Math.min(Math.max(sunSize, 0.001), Math.PI / 4.0);
    }

    /** A sky giving no light at all, for a closed room. */
    static black() {

        const black = new Vec3(0.0, 0.0, 0.0);
        return new Sky({ zenith: black, horizon: black, ground: black });
    }

    get zenith() {
        return this.#zenith;
    }

    get horizon() {
        return this.#horizon;
    }

    get ground() {
        return this.#ground;
    }

    /** Unit length. */
    get sunDirection() {
        return this.#sunDirection;
    }

    get sunColor() {
        return this.#sunColor;
    }

    get sunStrength() {
        return this.#sunStrength;
    }

    get sunSize() {
        return this.#sunSize;
    }

    /**
     * The radiance of the sun's disc: its strength spread over the solid
     * angle it covers.
     */
    get sunRadiance() {

        const solid_angle = 2.0 * Math.PI * (1.0 - Math.cos(this.#sunSize));
        return this.#sunColor.scale(this.#sunStrength / solid_angle);
    }

    /**
     * A copy with some options changed.
     * @param {SkyOptions} options
     */
    with(options) {

        return new Sky({
            zenith: this.#zenith,
            horizon: this.#horizon,
            ground: this.#ground,
            sunDirection: this.#sunDirection,
            sunColor: this.#sunColor,
            sunStrength: this.#sunStrength,
            sunSize: this.#sunSize,
            ...options,
        });
    }
}
