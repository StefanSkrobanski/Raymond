import { Vec3 } from "./Vec3.mjs";

/**
 * An image to wrap over a surface: width × height pixels of 8-bit sRGB
 * colour, 4 bytes each (the fourth is unused), row by row from the top
 * left, as images are stored. It repeats in both directions. Immutable.
 *
 * Make one from a function with Texture.procedural(), or from an image
 * with Texture.load() or Texture.fromImage() (in a browser).
 *
 * A texture used as a normal map (Material.withNormalMap) is read as plain
 * numbers rather than sRGB colour: each pixel's red, green and blue, from
 * 0 to 255, map to -1..1 along the texture's right, its up and out of the
 * surface (the OpenGL convention, as Blender makes them).
 * Texture.normalMap() makes one from a height function.
 */
export class Texture {

    #width;
    #height;
    #data;

    /**
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array | Uint8ClampedArray} data width × height × 4 bytes
     *   of sRGB colour
     */
    constructor(width, height, data) {

        if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
            throw new RangeError("A texture needs a whole number of pixels each way.");
        if (data.length != width * height * 4)
            throw new RangeError(`A ${width} × ${height} texture needs ${width * height * 4} bytes.`);

        this.#width = width;
        this.#height = height;
        this.#data = Uint8Array.from(data);
    }

    get width() {
        return this.#width;
    }

    get height() {
        return this.#height;
    }

    /** The sRGB bytes, 4 per pixel. */
    get data() {
        return this.#data;
    }

    /**
     * A texture drawn by a function: color(u, v), for u and v from 0 to 1
     * across and down (u = 0, v = 0 is the top left), returns linear RGB.
     * Each pixel takes the colour at its centre.
     * @param {number} width
     * @param {number} height
     * @param {(u: number, v: number) => Vec3} color
     */
    static procedural(width, height, color) {

        const data = new Uint8Array(width * height * 4);

        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const c = color((x + 0.5) / width, (y + 0.5) / height);
                const i = (y * width + x) * 4;
                data[i] = toSrgbByte(c.x);
                data[i + 1] = toSrgbByte(c.y);
                data[i + 2] = toSrgbByte(c.z);
                data[i + 3] = 255;
            }
        }

        return new Texture(width, height, data);
    }

    /**
     * A normal map for bumps of the given height: height(u, v), for u and
     * v from 0 to 1 across and down, returns the height there as a
     * fraction of the texture's width (so 0.01 is a bump a hundredth as
     * high as the texture is wide). Pixels are square: a texture twice as
     * wide as it's high should be laid on a surface twice as wide as high
     * to keep its slopes.
     * @param {number} width
     * @param {number} height
     * @param {(u: number, v: number) => number} heightAt
     */
    static normalMap(width, height, heightAt) {

        const h = new Float64Array(width * height);
        for (let y = 0; y < height; ++y)
            for (let x = 0; x < width; ++x)
                h[y * width + x] = heightAt((x + 0.5) / width, (y + 0.5) / height);

        /** @type {(x: number, y: number) => number} */
        const at = (x, y) => h[mod(y, height) * width + mod(x, width)];

        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                // Slopes per texture width, across and down; a pixel is
                // 1 / width of the texture's width either way.
                const right = (at(x + 1, y) - at(x - 1, y)) * width / 2.0;
                const down = (at(x, y + 1) - at(x, y - 1)) * width / 2.0;
                // Rising to the right tilts the normal left; rising
                // downwards tilts it up.
                const len = Math.hypot(right, down, 1.0);
                const i = (y * width + x) * 4;
                data[i] = Math.round((-right / len * 0.5 + 0.5) * 255);
                data[i + 1] = Math.round((down / len * 0.5 + 0.5) * 255);
                data[i + 2] = Math.round((1.0 / len * 0.5 + 0.5) * 255);
                data[i + 3] = 255;
            }
        }

        return new Texture(width, height, data);
    }

    /**
     * A texture from a decoded image, in a browser.
     * @param {ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas} image
     */
    static fromImage(image) {

        const width = image.width, height = image.height;
        const canvas = new OffscreenCanvas(width, height);
        const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext("2d"));
        context.drawImage(image, 0, 0);

        return new Texture(width, height, context.getImageData(0, 0, width, height).data);
    }

    /**
     * Fetches and decodes an image, in a browser.
     * @param {string | URL} url
     */
    static async load(url) {

        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Couldn't load the texture ${url}: ${response.status} ${response.statusText}`);

        const bitmap = await createImageBitmap(await response.blob());
        try {
            return Texture.fromImage(bitmap);
        }
        finally {
            bitmap.close();
        }
    }

    /**
     * The linear colour at (u, v), blended between the four nearest
     * pixels and wrapping round at the edges: what the GPU's sampler
     * returns. With srgb false, the bytes are read as plain numbers from
     * 0 to 1 instead, as for a normal map.
     * @param {number} u
     * @param {number} v
     * @param {boolean} [srgb]
     */
    sample(u, v, srgb = true) {

        const decode = srgb ? fromSrgbByte : fromByte;
        const x = u * this.#width - 0.5;
        const y = v * this.#height - 0.5;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;

        let r = 0, g = 0, b = 0;
        for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
            const px = mod(x0 + dx, this.#width), py = mod(y0 + dy, this.#height);
            const i = (py * this.#width + px) * 4;
            r += w * decode(this.#data[i]);
            g += w * decode(this.#data[i + 1]);
            b += w * decode(this.#data[i + 2]);
        }

        return new Vec3(r, g, b);
    }

    /**
     * This texture resized to width × height, blending neighbouring pixels
     * (in linear light), for packing textures of different sizes together.
     * With srgb false, it blends the bytes as plain numbers, as for a
     * normal map.
     * @param {number} width
     * @param {number} height
     * @param {boolean} [srgb]
     */
    resized(width, height, srgb = true) {

        if (width == this.#width && height == this.#height)
            return this;

        if (srgb)
            return Texture.procedural(width, height, (u, v) => this.sample(u, v));

        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const c = this.sample((x + 0.5) / width, (y + 0.5) / height, false);
                data.set([c.x, c.y, c.z, 1].map((n) => Math.round(n * 255)), (y * width + x) * 4);
            }
        }
        return new Texture(width, height, data);
    }
}

/** @param {number} c */
function toSrgbByte(c) {
    const x = Math.min(Math.max(c, 0), 1);
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
}

const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/** @param {number} byte */
function fromSrgbByte(byte) {
    return SRGB_TO_LINEAR[byte];
}

/** @param {number} byte */
function fromByte(byte) {
    return byte / 255;
}

/**
 * @param {number} a
 * @param {number} n
 */
function mod(a, n) {
    return ((a % n) + n) % n;
}
