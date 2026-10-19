import { Vec3 } from "./Vec3.mjs";

/**
 * How a surface scatters light:
 * - `diffuse`: matte, scattering evenly in every direction.
 * - `metal`: a mirror tinted by its colour, blurred by its roughness.
 * - `plastic`: a diffuse base under a clear glossy coat.
 * - `glass`: reflects and refracts, tinting what passes through.
 * - `light`: gives off light and reflects none.
 * @typedef {"diffuse" | "metal" | "plastic" | "glass" | "light"} MaterialType
 */

/**
 * @typedef {object} MaterialOptions
 * @property {MaterialType} [type] defaults to `diffuse`
 * @property {Vec3} [color] linear RGB from 0 to 1: the reflectance, or the
 *   tint of glass
 * @property {number} [roughness] 0 (polished) to 1, for metal and plastic
 * @property {number} [ior] index of refraction, for glass and plastic's coat
 * @property {Vec3} [emission] linear RGB radiance, for lights; may exceed 1
 * @property {Vec3 | null} [checker] a second colour, drawn as a 3D
 *   checkerboard with color, or null for a plain colour
 * @property {number} [checkerSize] the size of the checkerboard's squares
 */

/** The numeric code for each type, as the shader sees it. */
export const MATERIAL_TYPES = Object.freeze({
    diffuse: 0,
    metal: 1,
    plastic: 2,
    glass: 3,
    light: 4,
});

/** What a surface is made of. Immutable. */
export class Material {

    /** @type {MaterialType} */
    #type;
    #color;
    #roughness;
    #ior;
    #emission;
    /** @type {Vec3 | null} */
    #checker;
    #checkerSize;

    /** @param {MaterialOptions} [options] */
    constructor({
        type = "diffuse",
        color = new Vec3(0.8, 0.8, 0.8),
        roughness = 0.0,
        ior = 1.5,
        emission = new Vec3(0.0, 0.0, 0.0),
        checker = null,
        checkerSize = 1.0,
    } = {}) {

        if (!(type in MATERIAL_TYPES))
            throw new RangeError(`Unknown material type "${type}".`);

        this.#type = type;
        this.#color = color;
        this.#roughness = Math.min(Math.max(roughness, 0.0), 1.0);
        this.#ior = Math.max(ior, 1.0);
        this.#emission = emission;
        this.#checker = checker;
        this.#checkerSize = checkerSize;
    }

    get type() {
        return this.#type;
    }

    get color() {
        return this.#color;
    }

    get roughness() {
        return this.#roughness;
    }

    get ior() {
        return this.#ior;
    }

    get emission() {
        return this.#emission;
    }

    get checker() {
        return this.#checker;
    }

    get checkerSize() {
        return this.#checkerSize;
    }

    /** True if the material gives off light. */
    get emissive() {
        return this.#type == "light" &&
            this.#emission.x + this.#emission.y + this.#emission.z > 0.0;
    }

    /** @param {Vec3} color */
    static diffuse(color) {
        return new Material({ type: "diffuse", color });
    }

    /**
     * @param {Vec3} color
     * @param {number} [roughness]
     */
    static metal(color, roughness = 0.0) {
        return new Material({ type: "metal", color, roughness });
    }

    /**
     * @param {Vec3} color
     * @param {number} [roughness]
     */
    static plastic(color, roughness = 0.2) {
        return new Material({ type: "plastic", color, roughness });
    }

    /**
     * @param {number} [ior] 1.5 for window glass, 1.33 for water, 2.42 for
     *   diamond
     * @param {Vec3} [tint]
     */
    static glass(ior = 1.5, tint = new Vec3(1.0, 1.0, 1.0)) {
        return new Material({ type: "glass", color: tint, ior });
    }

    /**
     * @param {Vec3} color
     * @param {number} [strength] multiplies the colour
     */
    static light(color, strength = 1.0) {
        return new Material({ type: "light", emission: color.scale(strength) });
    }

    /**
     * A diffuse 3D checkerboard of two colours.
     * @param {Vec3} color
     * @param {Vec3} other
     * @param {number} [size] the size of each square
     */
    static checkered(color, other, size = 1.0) {
        return new Material({ type: "diffuse", color, checker: other, checkerSize: size });
    }
}

/**
 * Converts an sRGB colour, as written in CSS ("#ff8800" or "#f80"), to the
 * linear RGB that the renderer works in.
 * @param {string} hex
 */
export function hexColor(hex) {

    let digits = hex.replace(/^#/, "");
    if (digits.length == 3)
        digits = [...digits].map((d) => d + d).join("");

    if (!/^[0-9a-f]{6}$/i.test(digits))
        throw new RangeError(`"${hex}" is not a hex colour.`);

    /** @param {number} i */
    const channel = (i) => {
        const c = parseInt(digits.slice(i * 2, i * 2 + 2), 16) / 255.0;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return new Vec3(channel(0), channel(1), channel(2));
}
