import { Vec2 } from "./Vec2.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Texture } from "./Texture.mjs" */

/**
 * How a surface scatters light:
 * - `diffuse`: matte, scattering evenly in every direction.
 * - `metal`: a mirror tinted by its colour, blurred by its roughness.
 * - `plastic`: a diffuse base under a clear glossy coat.
 * - `glass`: reflects and refracts, tinting what passes through.
 * - `light`: gives off light and reflects none.
 * - `volume`: fog, smoke or haze filling a sphere or box, which scatters
 *   light inside it and has no surface of its own.
 * @typedef {"diffuse" | "metal" | "plastic" | "glass" | "light" | "volume"} MaterialType
 */

/**
 * @typedef {object} MaterialOptions
 * @property {MaterialType} [type] defaults to `diffuse`
 * @property {Vec3} [color] linear RGB from 0 to 1: the reflectance, the
 *   tint of glass, or the fraction of light a volume scatters rather than
 *   absorbs
 * @property {number} [roughness] 0 (polished) to 1, for metal and plastic
 * @property {number} [ior] index of refraction, for glass and plastic's coat
 * @property {Vec3} [emission] linear RGB radiance; may exceed 1. Lights
 *   give off only this; other surfaces glow with it on top of what they
 *   reflect
 * @property {Vec3 | null} [checker] a second colour, drawn as a 3D
 *   checkerboard with color, or null for a plain colour
 * @property {number} [checkerSize] the size of the checkerboard's squares
 * @property {Texture | null} [texture] an image to wrap over the surface,
 *   multiplying color (so leave color white to show it as it is)
 * @property {Vec2} [textureScale] how many times the texture repeats across
 *   the surface's u and v; the normal map and emission texture repeat with
 *   it
 * @property {Texture | null} [normalMap] bumps, as a normal map: see Texture
 * @property {number} [normalScale] how strongly the normal map tilts the
 *   surface: 1 as made, 0 flat, more for deeper bumps
 * @property {Texture | null} [emissionTexture] multiplies emission, for
 *   glowing patterns: lit windows, screens, lava
 * @property {number} [abbe] for glass, its Abbe number: how little its
 *   refraction varies with colour. 0 (the default) for none; about 60 for
 *   window glass, 55 for diamond (whose high ior makes its fire), 30 for
 *   dense flint, and less for a vivid rainbow
 * @property {number} [density] for volumes, the chance per unit length of
 *   light meeting a particle: 1 / the average distance it gets
 * @property {number} [anisotropy] for volumes, from -1 to 1: 0 scatters
 *   evenly, positive mostly onwards (haze, so beams glow seen towards the
 *   light), negative back (Henyey-Greenstein's g)
 */

/** The numeric code for each type, as the shader sees it. */
export const MATERIAL_TYPES = Object.freeze({
    diffuse: 0,
    metal: 1,
    plastic: 2,
    glass: 3,
    light: 4,
    volume: 5,
});

// The wavelengths, in micrometres, at which an Abbe number is measured:
// helium d, and hydrogen F and C.
const LAMBDA_D = 0.5876;
const LAMBDA_F = 0.4861;
const LAMBDA_C = 0.6563;

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
    /** @type {Texture | null} */
    #texture;
    #textureScale;
    /** @type {Texture | null} */
    #normalMap;
    #normalScale;
    /** @type {Texture | null} */
    #emissionTexture;
    #abbe;
    #density;
    #anisotropy;

    /** @param {MaterialOptions} [options] */
    constructor({
        type = "diffuse",
        color = new Vec3(0.8, 0.8, 0.8),
        roughness = 0.0,
        ior = 1.5,
        emission = new Vec3(0.0, 0.0, 0.0),
        checker = null,
        checkerSize = 1.0,
        texture = null,
        textureScale = new Vec2(1.0, 1.0),
        normalMap = null,
        normalScale = 1.0,
        emissionTexture = null,
        abbe = 0.0,
        density = 1.0,
        anisotropy = 0.0,
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
        this.#texture = texture;
        this.#textureScale = textureScale;
        this.#normalMap = normalMap;
        this.#normalScale = normalScale;
        this.#emissionTexture = emissionTexture;
        this.#abbe = Math.max(abbe, 0.0);
        this.#density = Math.max(density, 0.0);
        this.#anisotropy = Math.min(Math.max(anisotropy, -0.99), 0.99);
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

    get texture() {
        return this.#texture;
    }

    get textureScale() {
        return this.#textureScale;
    }

    get normalMap() {
        return this.#normalMap;
    }

    get normalScale() {
        return this.#normalScale;
    }

    get emissionTexture() {
        return this.#emissionTexture;
    }

    get abbe() {
        return this.#abbe;
    }

    get density() {
        return this.#density;
    }

    get anisotropy() {
        return this.#anisotropy;
    }

    /**
     * How much glass's index of refraction changes with wavelength: B in
     * Cauchy's n(λ) = A + B / λ², for λ in micrometres, worked out from
     * the ior (at 587.6 nm) and the Abbe number. 0 for none.
     */
    get dispersion() {
        if (this.#type != "glass" || this.#abbe <= 0.0)
            return 0.0;
        return (this.#ior - 1.0) / (this.#abbe * (LAMBDA_F ** -2 - LAMBDA_C ** -2));
    }

    /**
     * The index of refraction at a wavelength, in nanometres.
     * @param {number} wavelength
     */
    iorAt(wavelength) {
        const l = wavelength / 1000.0;
        return this.#ior + this.dispersion * (l ** -2 - LAMBDA_D ** -2);
    }

    /**
     * A copy of this material with a texture wrapped over it. The texture
     * multiplies the colour, which becomes white unless given.
     * @param {Texture} texture
     * @param {number | Vec2} [scale] how many times it repeats across u and v
     * @param {Vec3} [color] a tint
     */
    withTexture(texture, scale = 1.0, color = new Vec3(1.0, 1.0, 1.0)) {
        return this.#with({
            color,
            checker: null,
            texture,
            textureScale: typeof scale == "number" ? new Vec2(scale, scale) : scale,
        });
    }

    /**
     * A copy of this material with bumps, from a normal map (see Texture),
     * laid on with the texture's scale.
     * @param {Texture} normalMap
     * @param {number} [strength] 1 as made, more for deeper bumps
     */
    withNormalMap(normalMap, strength = 1.0) {
        return this.#with({ normalMap, normalScale: strength });
    }

    /**
     * A copy of this material that glows, on top of whatever it reflects;
     * with a texture, in its pattern (laid on with the texture's scale).
     * Glowing surfaces light the scene only where light bounces off them
     * onto something, so for a lamp, use a light: those are aimed at
     * directly.
     * @param {Vec3} color
     * @param {number} [strength] multiplies the colour
     * @param {Texture | null} [texture] multiplies them both
     */
    withEmission(color, strength = 1.0, texture = null) {
        return this.#with({ emission: color.scale(strength), emissionTexture: texture });
    }

    /** True if the material is a light: it gives off light and is aimed at directly. */
    get emissive() {
        return this.#type == "light" && this.glows;
    }

    /** True if the material gives off any light, as a light or a glowing surface. */
    get glows() {
        return this.#emission.x + this.#emission.y + this.#emission.z > 0.0;
    }

    /** @param {MaterialOptions} changes */
    #with(changes) {
        return new Material({
            type: this.#type,
            color: this.#color,
            roughness: this.#roughness,
            ior: this.#ior,
            emission: this.#emission,
            checker: this.#checker,
            checkerSize: this.#checkerSize,
            texture: this.#texture,
            textureScale: this.#textureScale,
            normalMap: this.#normalMap,
            normalScale: this.#normalScale,
            emissionTexture: this.#emissionTexture,
            abbe: this.#abbe,
            density: this.#density,
            anisotropy: this.#anisotropy,
            ...changes,
        });
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
     * @param {number} [abbe] 0 for no dispersion, or the Abbe number: lower
     *   splits colours more (see MaterialOptions)
     */
    static glass(ior = 1.5, tint = new Vec3(1.0, 1.0, 1.0), abbe = 0.0) {
        return new Material({ type: "glass", color: tint, ior, abbe });
    }

    /**
     * Fog, smoke or haze, for a Sphere or Box to fill.
     * @param {Vec3} color the fraction of light scattered rather than
     *   absorbed, per colour: white for clouds, grey for smoke
     * @param {number} density the chance per unit length of meeting a
     *   particle; light gets 1 / density on average
     * @param {number} [anisotropy] from -1 to 1: 0 scatters evenly, more
     *   sends light onwards (see MaterialOptions)
     */
    static volume(color, density, anisotropy = 0.0) {
        return new Material({ type: "volume", color, density, anisotropy });
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
