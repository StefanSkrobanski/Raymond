import { Vec3 } from "./Vec3.mjs";

/**
 * An image to wrap over a surface: width × height pixels of 8-bit sRGB
 * colour, 4 bytes each (the fourth is unused), row by row from the top
 * left, as images are stored. It repeats in both directions. Immutable.
 *
 * Make one from a function with Texture.procedural(), or from an image
 * with Texture.load() or Texture.fromImage() (in a browser).
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
     * returns.
     * @param {number} u
     * @param {number} v
     */
    sample(u, v) {

        const x = u * this.#width - 0.5;
        const y = v * this.#height - 0.5;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;

        let r = 0, g = 0, b = 0;
        for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
            const px = mod(x0 + dx, this.#width), py = mod(y0 + dy, this.#height);
            const i = (py * this.#width + px) * 4;
            r += w * fromSrgbByte(this.#data[i]);
            g += w * fromSrgbByte(this.#data[i + 1]);
            b += w * fromSrgbByte(this.#data[i + 2]);
        }

        return new Vec3(r, g, b);
    }

    /**
     * This texture resized to width × height, blending neighbouring pixels
     * (in linear light), for packing textures of different sizes together.
     * @param {number} width
     * @param {number} height
     */
    resized(width, height) {

        if (width == this.#width && height == this.#height)
            return this;

        return Texture.procedural(width, height, (u, v) => this.sample(u, v));
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

/**
 * @param {number} a
 * @param {number} n
 */
function mod(a, n) {
    return ((a % n) + n) % n;
}
