import { Vec3 } from "./Vec3.mjs";
/** @import { Mat4 } from "./Mat4.mjs" */
/** @import { Material } from "./Material.mjs" */

/**
 * How a mesh is shaded: `smooth` interpolates normals averaged at each
 * vertex, so curved surfaces look curved; `flat` shows every triangle.
 * @typedef {"smooth" | "flat"} Shading
 */

/**
 * A triangle mesh: vertex positions, and indices taking them three at a
 * time. A triangle's front faces along (b - a) × (c - a), so a closed mesh
 * should wind its triangles anticlockwise seen from outside; glass relies on
 * that to know whether a ray is entering or leaving. Immutable.
 */
export class Mesh {

    /** @type {Vec3[]} */
    #positions;
    #indices;
    /** @type {Vec3[] | null} */
    #normals;
    #material;

    /**
     * @param {Vec3[]} positions
     * @param {ArrayLike<number>} indices three per triangle
     * @param {Material} material
     * @param {{ shading?: Shading, normals?: Vec3[] }} [options] normals,
     *   one per vertex, override the shading
     */
    constructor(positions, indices, material, { shading = "smooth", normals } = {}) {

        if (indices.length % 3 != 0)
            throw new RangeError("A mesh needs three indices per triangle.");

        for (let i = 0; i < indices.length; ++i) {
            if (!(indices[i] >= 0 && indices[i] < positions.length && Number.isInteger(indices[i])))
                throw new RangeError(`Index ${indices[i]} has no vertex.`);
        }

        if (normals && normals.length != positions.length)
            throw new RangeError("A mesh needs one normal per vertex.");

        this.#positions = positions;
        this.#indices = Uint32Array.from(indices);
        this.#material = material;
        this.#normals = normals ?? (shading == "smooth" ? Mesh.#vertexNormals(positions, this.#indices) : null);
    }

    get positions() {
        return this.#positions;
    }

    get indices() {
        return this.#indices;
    }

    /** One per vertex, or null for flat shading. */
    get normals() {
        return this.#normals;
    }

    get material() {
        return this.#material;
    }

    get triangleCount() {
        return this.#indices.length / 3;
    }

    /**
     * This mesh moved by a transform. A transform that mirrors the mesh
     * (negative determinant) reverses the winding, so fronts stay outside.
     * @param {Mat4} transform
     */
    transformed(transform) {

        const positions = this.#positions.map((p) => transform.multiplyVector3(p));

        let indices = this.#indices;
        if (transform.determinant() < 0.0) {
            indices = indices.slice();
            for (let i = 0; i < indices.length; i += 3)
                [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
        }

        // Normals go through the inverse transpose, so they stay
        // perpendicular to stretched surfaces.
        let normals;
        if (this.#normals) {
            const normal_matrix = transform.inverse().transpose();
            normals = this.#normals.map((n) => normal_matrix.multiplyDirection(n).normalized());
        }

        return new Mesh(positions, indices, this.#material, { shading: "flat", normals });
    }

    /**
     * A surface from point(u, v), a function taking u and v from 0 to 1 and
     * returning a Vec3, cut into a grid of triangles. Each direction is
     * "open" (its edges are free) or "closed" (its last row joins its first,
     * sharing vertices, so smooth shading hides the seam). Fronts face along
     * ∂point/∂u × ∂point/∂v.
     * @param {(u: number, v: number) => Vec3} point
     * @param {number} uSegments
     * @param {number} vSegments
     * @param {Material} material
     * @param {{ uWrap?: "open" | "closed", vWrap?: "open" | "closed", shading?: Shading }} [options]
     */
    static surface(point, uSegments, vSegments, material, { uWrap = "open", vWrap = "open", shading = "smooth" } = {}) {

        const u_rows = uWrap == "open" ? uSegments + 1 : uSegments;
        const v_rows = vWrap == "open" ? vSegments + 1 : vSegments;

        /** @type {Vec3[]} */
        const positions = [];
        for (let i = 0; i < u_rows; ++i)
            for (let j = 0; j < v_rows; ++j)
                positions.push(point(i / uSegments, j / vSegments));

        /** @type {(i: number, j: number) => number} */
        const index = (i, j) => (i % u_rows) * v_rows + (j % v_rows);

        /** @type {number[]} */
        const indices = [];
        for (let i = 0; i < uSegments; ++i) {
            for (let j = 0; j < vSegments; ++j) {

                const a = index(i, j);
                const b = index(i + 1, j);
                const c = index(i + 1, j + 1);
                const d = index(i, j + 1);

                indices.push(a, b, c, a, c, d);
            }
        }

        return new Mesh(positions, Mesh.#withoutDegenerates(positions, indices), material, { shading });
    }

    /**
     * A sphere of radius 1 at the origin, made by splitting an icosahedron's
     * faces, so its triangles are all much the same size.
     * @param {Material} material
     * @param {number} [subdivisions] each one quadruples the triangles
     * @param {{ shading?: Shading }} [options]
     */
    static icosphere(material, subdivisions = 3, { shading = "smooth" } = {}) {

        const t = (1.0 + Math.sqrt(5.0)) / 2.0;

        /** @type {Vec3[]} */
        const positions = [
            [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
            [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
            [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
        ].map(([x, y, z]) => new Vec3(x, y, z).normalized());

        let faces = [
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
        ];

        for (let s = 0; s < subdivisions; ++s) {

            /** @type {Map<string, number>} */
            const midpoints = new Map();

            /** @type {(a: number, b: number) => number} */
            const midpoint = (a, b) => {
                const key = a < b ? `${a},${b}` : `${b},${a}`;
                let index = midpoints.get(key);
                if (index === undefined) {
                    index = positions.length;
                    positions.push(positions[a].add(positions[b]).normalized());
                    midpoints.set(key, index);
                }
                return index;
            };

            /** @type {number[]} */
            const next = [];
            for (let i = 0; i < faces.length; i += 3) {
                const [a, b, c] = [faces[i], faces[i + 1], faces[i + 2]];
                const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
                next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
            }
            faces = next;
        }

        // On a unit sphere, a vertex's position is its exact normal.
        return new Mesh(positions, faces, material, shading == "smooth" ? { normals: positions } : { shading });
    }

    /**
     * A solid of revolution, as turned on a lathe: profile gives points
     * (x: the distance from the y axis, y: the height), and the mesh sweeps
     * them round the y axis. Go up the outside, so the fronts face out; a
     * vessel can come back down its inside to a floor. Ends on the axis
     * close it.
     * @param {import("./Vec2.mjs").Vec2[]} profile at least 2 points
     * @param {Material} material
     * @param {{ segments?: number, shading?: Shading }} [options] segments:
     *   steps around the axis
     */
    static lathe(profile, material, { segments = 64, shading = "smooth" } = {}) {

        if (profile.length < 2)
            throw new RangeError("A lathe's profile needs at least 2 points.");

        const steps = profile.length - 1;

        return Mesh.surface((u, v) => {

            const p = profile[Math.round(v * steps)];
            const a = u * 2.0 * Math.PI;

            return new Vec3(p.x * Math.cos(a), p.y, -p.x * Math.sin(a));

        }, segments, steps, material, { uWrap: "closed", shading });
    }

    /**
     * A torus around the y axis.
     * @param {Material} material
     * @param {{ radius?: number, tube?: number, segments?: number, sides?: number }} [options]
     *   radius: from the centre to the middle of the tube; segments: steps
     *   around the ring; sides: steps around the tube
     */
    static torus(material, { radius = 1.0, tube = 0.35, segments = 64, sides = 32 } = {}) {

        return Mesh.surface((u, v) => {

            const a = u * 2.0 * Math.PI;
            const b = v * 2.0 * Math.PI;
            const r = radius + tube * Math.cos(b);

            return new Vec3(r * Math.cos(a), tube * Math.sin(b), -r * Math.sin(a));

        }, segments, sides, material, { uWrap: "closed", vWrap: "closed" });
    }

    /**
     * A tube of the given radius around a closed curve, curve(t) for t from
     * 0 to 1 returning a Vec3.
     *
     * Each ring is oriented by a frame carried along the curve without
     * twisting (parallel transport). Going once round a knotted curve, that
     * frame can come back turned; the difference is spread evenly along the
     * tube, so the rings join up at the seam.
     * @param {(t: number) => Vec3} curve
     * @param {Material} material
     * @param {{ radius?: number, segments?: number, sides?: number }} [options]
     *   segments: rings along the curve; sides: steps around each ring
     */
    static tube(curve, material, { radius = 0.3, segments = 256, sides = 24 } = {}) {

        /** @type {Vec3[]} */
        const centres = [];
        for (let s = 0; s < segments; ++s)
            centres.push(curve(s / segments));

        /** @type {(s: number) => Vec3} */
        const tangent = (s) => centres[(s + 1) % segments].subtract(centres[(s + segments - 1) % segments]).normalized();

        // A starting normal: anything perpendicular to the first tangent.
        const t0 = tangent(0);
        const helper = Math.abs(t0.y) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0);
        let normal = t0.cross(helper).normalized();

        const normals = [normal];
        for (let s = 1; s <= segments; ++s) {
            // Remove the part along the new tangent, keeping it perpendicular.
            const t = tangent(s % segments);
            normal = normal.subtract(t.scale(normal.dot(t))).normalized();
            normals.push(normal);
        }

        // How far round the transported normal ended up from where it began.
        const binormal0 = t0.cross(normals[0]);
        const twist = Math.atan2(normals[segments].dot(binormal0), normals[segments].dot(normals[0]));

        return Mesh.surface((u, v) => {

            const s = Math.round(u * segments) % segments;
            const t = tangent(s);
            const n = normals[s];
            const b = t.cross(n);

            // Going round the ring from n towards -b, with u along t, puts
            // ∂u × ∂v outwards.
            const angle = 2.0 * Math.PI * v + twist * s / segments;

            return centres[s]
                .add(n.scale(Math.cos(angle) * radius))
                .subtract(b.scale(Math.sin(angle) * radius));

        }, segments, sides, material, { uWrap: "closed", vWrap: "closed" });
    }

    // Area-weighted average of the faces' normals at each vertex.
    /**
     * @param {Vec3[]} positions
     * @param {Uint32Array} indices
     */
    static #vertexNormals(positions, indices) {

        const sums = new Float64Array(positions.length * 3);

        for (let i = 0; i < indices.length; i += 3) {

            const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
            const n = positions[b].subtract(positions[a]).cross(positions[c].subtract(positions[a]));

            for (const v of [a, b, c]) {
                sums[v * 3] += n.x;
                sums[v * 3 + 1] += n.y;
                sums[v * 3 + 2] += n.z;
            }
        }

        return positions.map((_, v) => {
            const n = new Vec3(sums[v * 3], sums[v * 3 + 1], sums[v * 3 + 2]);
            return n.length() > 0.0 ? n.normalized() : new Vec3(0.0, 1.0, 0.0);
        });
    }

    // Drops triangles with no area, such as those at a sphere's poles.
    /**
     * @param {Vec3[]} positions
     * @param {number[]} indices
     */
    static #withoutDegenerates(positions, indices) {

        /** @type {number[]} */
        const kept = [];

        for (let i = 0; i < indices.length; i += 3) {

            const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
            const area = positions[b].subtract(positions[a]).cross(positions[c].subtract(positions[a])).length();

            if (area > 1e-12)
                kept.push(a, b, c);
        }

        return kept;
    }
}
