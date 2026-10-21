import { Vec3 } from "./Vec3.mjs";

/**
 * A panorama of the light all round, for a Sky to light the scene with:
 * width × height pixels of linear RGB radiance (any brightness, as in an
 * HDR photograph), 3 floats each, row by row from the top.
 *
 * It's laid out equirectangularly, as HDR panoramas are: u runs once round
 * the horizon and v from straight up (0) to straight down (1). The middle
 * of the image (u = 0.5) is towards -z, the way a camera looks by default,
 * and u = 0.75 towards +x. Immutable.
 *
 * Make one from a function with EnvironmentMap.procedural(), or load a
 * Radiance .hdr file with EnvironmentMap.load() or fromHDR().
 */
export class EnvironmentMap {

    #width;
    #height;
    #data;
    /** @type {{ width: number, height: number, data: Float32Array } | null} */
    #importance = null;

    /**
     * @param {number} width
     * @param {number} height
     * @param {Float32Array | number[]} data width × height × 3 floats of
     *   linear RGB
     */
    constructor(width, height, data) {

        if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
            throw new RangeError("An environment map needs a whole number of pixels each way.");
        if (data.length != width * height * 3)
            throw new RangeError(`A ${width} × ${height} environment map needs ${width * height * 3} floats.`);

        this.#width = width;
        this.#height = height;
        this.#data = Float32Array.from(data, (c) => Number.isFinite(c) ? Math.max(c, 0.0) : 0.0);
    }

    get width() {
        return this.#width;
    }

    get height() {
        return this.#height;
    }

    /** The linear RGB radiance, 3 floats per pixel. */
    get data() {
        return this.#data;
    }

    /**
     * The unit direction at texture coordinate (u, v).
     * @param {number} u 0 to 1 round the horizon
     * @param {number} v 0 (up) to 1 (down)
     */
    static direction(u, v) {
        const phi = (u - 0.5) * 2.0 * Math.PI;
        const theta = v * Math.PI;
        return new Vec3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi));
    }

    /**
     * The texture coordinate of a direction, as direction() lays them out.
     * @param {Vec3} d unit length
     * @returns {[number, number]}
     */
    static uv(d) {
        const u = 0.5 + Math.atan2(d.x, -d.z) / (2.0 * Math.PI);
        return [u - Math.floor(u), Math.acos(Math.min(Math.max(d.y, -1.0), 1.0)) / Math.PI];
    }

    /**
     * An environment drawn by a function of direction: radiance(d), for
     * unit direction d, returns linear RGB. Each pixel takes the radiance
     * at its centre.
     * @param {number} width
     * @param {number} height
     * @param {(direction: Vec3) => Vec3} radiance
     */
    static procedural(width, height, radiance) {

        const data = new Float32Array(width * height * 3);
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const c = radiance(EnvironmentMap.direction((x + 0.5) / width, (y + 0.5) / height));
                data.set([c.x, c.y, c.z], (y * width + x) * 3);
            }
        }

        return new EnvironmentMap(width, height, data);
    }

    /**
     * Reads a Radiance .hdr (RGBE) file, flat or run-length encoded, as
     * HDR panoramas are usually shared.
     * @param {ArrayBuffer | Uint8Array} file
     */
    static fromHDR(file) {

        const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
        let at = 0;

        const line = () => {
            let text = "";
            while (at < bytes.length && bytes[at] != 0x0a)
                text += String.fromCharCode(bytes[at++]);
            at++;
            return text;
        };

        if (!/^#\?(RADIANCE|RGBE)/.test(line()))
            throw new Error("Not a Radiance .hdr file.");

        // Header lines until a blank one, then the size.
        for (let header = line(); header != ""; header = line()) {
            if (header.startsWith("FORMAT=") && header != "FORMAT=32-bit_rle_rgbe")
                throw new Error(`Unsupported .hdr format: ${header.slice(7)}.`);
            if (at >= bytes.length)
                throw new Error("The .hdr file ends in its header.");
        }

        const size = line().match(/^-Y (\d+) \+X (\d+)$/);
        if (!size)
            throw new Error("Only .hdr files stored top to bottom, left to right, are supported.");
        const height = Number(size[1]), width = Number(size[2]);

        const data = new Float32Array(width * height * 3);
        const scanline = new Uint8Array(width * 4);

        for (let y = 0; y < height; ++y) {

            const rle = width >= 8 && width < 32768 && bytes[at] == 2 && bytes[at + 1] == 2 && (bytes[at + 2] & 0x80) == 0;

            if (rle) {
                if ((bytes[at + 2] << 8 | bytes[at + 3]) != width)
                    throw new Error("A scanline of the .hdr file has the wrong length.");
                at += 4;
                // Each of the four channels in turn, as runs and literals.
                for (let c = 0; c < 4; ++c) {
                    for (let x = 0; x < width;) {
                        let count = bytes[at++];
                        if (count > 128) {
                            count -= 128;
                            const value = bytes[at++];
                            for (let k = 0; k < count; ++k)
                                scanline[(x++) * 4 + c] = value;
                        }
                        else {
                            for (let k = 0; k < count; ++k)
                                scanline[(x++) * 4 + c] = bytes[at++];
                        }
                        if (x > width || at > bytes.length)
                            throw new Error("A scanline of the .hdr file runs over.");
                    }
                }
            }
            else {
                if (at + width * 4 > bytes.length)
                    throw new Error("The .hdr file ends early.");
                scanline.set(bytes.subarray(at, at + width * 4));
                at += width * 4;
            }

            for (let x = 0; x < width; ++x) {
                const e = scanline[x * 4 + 3];
                const scale = e == 0 ? 0.0 : Math.pow(2.0, e - 136);
                data.set([scanline[x * 4] * scale, scanline[x * 4 + 1] * scale, scanline[x * 4 + 2] * scale], (y * width + x) * 3);
            }
        }

        return new EnvironmentMap(width, height, data);
    }

    /**
     * Fetches and reads a Radiance .hdr file, in a browser (or anywhere
     * with fetch).
     * @param {string | URL} url
     */
    static async load(url) {

        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Couldn't load the environment ${url}: ${response.status} ${response.statusText}`);

        return EnvironmentMap.fromHDR(await response.arrayBuffer());
    }

    /**
     * The table the renderer picks directions from, in proportion to how
     * much light comes from each: the panorama in cells (at most 512 × 256),
     * each weighted by its luminance times sin(θ), the solid angle its
     * pixels cover. Laid out as a texture, width × (height + 1) floats: row
     * y < height holds row y's cumulative distribution across, ending at 1;
     * row height holds the rows' cumulative distribution down, in its first
     * height entries. Rows or panoramas with no light at all are uniform.
     * @returns {{ width: number, height: number, data: Float32Array }}
     */
    importance() {

        if (this.#importance)
            return this.#importance;

        const cw = Math.min(this.#width, 512), ch = Math.min(this.#height, 256, cw);
        const data = new Float32Array(cw * (ch + 1));
        const rows = new Float64Array(ch);

        for (let y = 0; y < ch; ++y) {

            const y0 = Math.floor(y * this.#height / ch), y1 = Math.max(y0 + 1, Math.floor((y + 1) * this.#height / ch));
            const sin = Math.sin((y + 0.5) / ch * Math.PI);
            let sum = 0.0;

            for (let x = 0; x < cw; ++x) {
                const x0 = Math.floor(x * this.#width / cw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * this.#width / cw));
                let light = 0.0;
                for (let py = y0; py < y1; ++py)
                    for (let px = x0; px < x1; ++px) {
                        const i = (py * this.#width + px) * 3;
                        light += 0.2126 * this.#data[i] + 0.7152 * this.#data[i + 1] + 0.0722 * this.#data[i + 2];
                    }
                sum += light / ((y1 - y0) * (x1 - x0)) * sin;
                data[y * cw + x] = sum;
            }

            for (let x = 0; x < cw; ++x)
                data[y * cw + x] = sum > 0 ? data[y * cw + x] / sum : (x + 1) / cw;
            rows[y] = sum;
        }

        const total = rows.reduce((a, b) => a + b, 0.0);
        let running = 0.0;
        for (let y = 0; y < ch; ++y) {
            running += rows[y];
            data[ch * cw + y] = total > 0 ? running / total : (y + 1) / ch;
        }
        // Rounding mustn't leave the last entries short of 1.
        data[ch * cw + ch - 1] = 1.0;
        for (let y = 0; y < ch; ++y)
            data[y * cw + cw - 1] = 1.0;

        this.#importance = { width: cw, height: ch, data };
        return this.#importance;
    }

    /**
     * A direction picked from importance() with the four random numbers
     * xi (each 0 up to 1), and its probability density per steradian, as
     * the renderer picks them, before the sky's rotation.
     * @param {number[]} xi
     * @returns {{ direction: Vec3, pdf: number }}
     */
    sampleDirection(xi) {

        const { width: cw, height: ch, data } = this.importance();
        const y = search(data, ch * cw, ch, xi[0]);
        const x = search(data, y * cw, cw, xi[1]);
        const u = (x + xi[2]) / cw, v = (y + xi[3]) / ch;
        const direction = EnvironmentMap.direction(u, v);

        return { direction, pdf: this.pdf(direction) };
    }

    /**
     * The probability density per steradian of sampleDirection() picking
     * direction d (unit length), before the sky's rotation.
     * @param {Vec3} d
     */
    pdf(d) {

        const { width: cw, height: ch, data } = this.importance();
        const [u, v] = EnvironmentMap.uv(d);
        const x = Math.min(Math.floor(u * cw), cw - 1), y = Math.min(Math.floor(v * ch), ch - 1);
        const row = data[ch * cw + y] - (y > 0 ? data[ch * cw + y - 1] : 0.0);
        const cell = data[y * cw + x] - (x > 0 ? data[y * cw + x - 1] : 0.0);
        const sin = Math.sin(v * Math.PI);

        return sin > 0 ? row * cell * cw * ch / (2.0 * Math.PI * Math.PI * sin) : 0.0;
    }

    /**
     * The radiance towards direction d, blended between the four nearest
     * pixels (wrapping round the horizon), as the GPU's sampler does.
     * @param {Vec3} d unit length
     */
    sample(d) {

        const [u, v] = EnvironmentMap.uv(d);
        const x = u * this.#width - 0.5;
        const y = Math.min(Math.max(v * this.#height - 0.5, 0.0), this.#height - 1);
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;

        let r = 0, g = 0, b = 0;
        for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
            const px = ((x0 + dx) % this.#width + this.#width) % this.#width;
            const py = Math.min(y0 + dy, this.#height - 1);
            const i = (py * this.#width + px) * 3;
            r += w * this.#data[i];
            g += w * this.#data[i + 1];
            b += w * this.#data[i + 2];
        }

        return new Vec3(r, g, b);
    }
}

// The first of n entries of a cumulative distribution, from offset, that
// exceeds xi: a binary search, as the shader does it.
/**
 * @param {Float32Array} data
 * @param {number} offset
 * @param {number} n
 * @param {number} xi
 */
function search(data, offset, n, xi) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (data[offset + mid] > xi)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}
