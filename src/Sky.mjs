import { EnvironmentMap } from "./EnvironmentMap.mjs";
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
 * @property {EnvironmentMap | null} [environment] a panorama of the light
 *   all round, in place of the gradient; the renderer samples it directly,
 *   in proportion to its brightness, so even a small bright sun in it
 *   lights the scene with little noise
 * @property {number} [environmentStrength] multiplies the environment
 * @property {number} [environmentRotation] turns the environment about the
 *   vertical, in radians
 */

/**
 * The light from everything a ray can escape to: a gradient from the
 * ground through the horizon to the zenith, or an environment map (an HDR
 * panorama), and an optional sun, a bright disc that the renderer samples
 * directly, so it lights the scene with little noise. Immutable.
 */
export class Sky {

    #zenith;
    #horizon;
    #ground;
    #sunDirection;
    #sunColor;
    #sunStrength;
    #sunSize;
    /** @type {EnvironmentMap | null} */
    #environment;
    #environmentStrength;
    #environmentRotation;

    /** @param {SkyOptions} [options] */
    constructor({
        zenith = new Vec3(0.25, 0.45, 0.9),
        horizon = new Vec3(0.85, 0.9, 1.0),
        ground = new Vec3(0.3, 0.28, 0.25),
        sunDirection = new Vec3(0.5, 0.8, 0.3),
        sunColor = new Vec3(1.0, 0.95, 0.85),
        sunStrength = 0.0,
        sunSize = 0.05,
        environment = null,
        environmentStrength = 1.0,
        environmentRotation = 0.0,
    } = {}) {

        this.#zenith = zenith;
        this.#horizon = horizon;
        this.#ground = ground;
        this.#sunDirection = sunDirection.normalized();
        this.#sunColor = sunColor;
        this.#sunStrength = Math.max(sunStrength, 0.0);
        this.#sunSize = Math.min(Math.max(sunSize, 0.001), Math.PI / 4.0);
        this.#environment = environment;
        this.#environmentStrength = Math.max(environmentStrength, 0.0);
        this.#environmentRotation = environmentRotation;
    }

    /**
     * A sky of an environment map alone.
     * @param {EnvironmentMap} environment
     * @param {number} [strength]
     * @param {number} [rotation] about the vertical, in radians
     */
    static environment(environment, strength = 1.0, rotation = 0.0) {
        return new Sky({ environment, environmentStrength: strength, environmentRotation: rotation });
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

    get environment() {
        return this.#environment;
    }

    get environmentStrength() {
        return this.#environmentStrength;
    }

    get environmentRotation() {
        return this.#environmentRotation;
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
     * The radiance of the sky towards direction d (unit length), as the
     * renderer sees it: the environment map, turned and scaled, or else
     * the gradient. The sun's disc isn't included.
     * @param {Vec3} d
     */
    radiance(d) {

        if (this.#environment) {
            const [u, v] = EnvironmentMap.uv(d);
            const turned = EnvironmentMap.direction(u - this.#environmentRotation / (2.0 * Math.PI), v);
            return this.#environment.sample(turned).scale(this.#environmentStrength);
        }

        const t = Math.sqrt(Math.min(Math.abs(d.y), 1.0));
        return d.y >= 0.0 ? this.#horizon.lerp(this.#zenith, t) : this.#horizon.lerp(this.#ground, t);
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
            environment: this.#environment,
            environmentStrength: this.#environmentStrength,
            environmentRotation: this.#environmentRotation,
            ...options,
        });
    }
}
