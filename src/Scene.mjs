import { BVH } from "./BVH.mjs";
import { Box } from "./Box.mjs";
import { MATERIAL_TYPES } from "./Material.mjs";
import { Mesh } from "./Mesh.mjs";
import { Quad } from "./Quad.mjs";
import { Sky } from "./Sky.mjs";
import { Sphere } from "./Sphere.mjs";
import { Vec2 } from "./Vec2.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Material } from "./Material.mjs" */
/** @import { Texture } from "./Texture.mjs" */

/** @typedef {Sphere | Quad | Box | Mesh} SceneObject */

/**
 * A scene packed into the buffers the shader reads. Primitives (a sphere,
 * quad, box or single triangle each) are 64 bytes, in the BVH's leaf order:
 *
 *     u32 kind, u32 material, u32 light, u32 attributes,
 *     vec4 p0, vec4 p1, vec4 p2
 *
 * kind is a PRIMITIVE_KINDS code. light is the primitive's index in lights,
 * if it's a light the renderer samples directly (an emissive sphere or
 * quad), and attributes the index in attributes of its block (a triangle
 * with vertex normals or texture coordinates), or NONE otherwise. p0..p2
 * hold a sphere's centre and radius (in p0.w), its globe's x axis and its
 * north pole (for textures); a quad's corner, u and v; a box's world-to-box
 * matrix, row by row; or a triangle's vertices.
 *
 * A triangle's attribute block is 4 vec4s: each vertex's normal with its
 * texture u in w, then the three vertices' texture v, and in w, flags: 1
 * if the normals are there (smooth), plus 2 if the texture coordinates are.
 *
 * Volumes (spheres and boxes of a volume material) come after the others,
 * outside the BVH, since rays pass through them: the shader finds where a
 * ray crosses each one, listed in volumes.
 *
 * Materials are 96 bytes: vec3 color, u32 type, vec3 emission, f32
 * roughness, vec3 checker, f32 checkerSize (0 for none), f32 ior, u32
 * texture (an index in textures, or NONE), the texture's scale in u and
 * v; u32 normalMap (an index in normalMaps, or NONE), f32 normalScale, u32
 * emissionTexture (an index in textures, or NONE), f32 dispersion (see
 * Material.dispersion); f32 density, f32 anisotropy, and 8 bytes unused.
 * @typedef {object} PackedScene
 * @property {ArrayBuffer} primitives the BVH's primitives, then the volumes
 * @property {number} primitiveCount the number in the BVH
 * @property {ArrayBuffer} nodes the BVH, as BVH documents it
 * @property {number} nodeCount
 * @property {ArrayBuffer} materials
 * @property {number} materialCount
 * @property {Float32Array} attributes triangles' attribute blocks, 16 floats each
 * @property {Texture[]} textures colour and emission textures, in the order
 *   materials refer to them
 * @property {Texture[]} normalMaps likewise
 * @property {Uint32Array} lights the indices of primitives to sample as lights
 * @property {number[]} volumes the indices of the volumes' primitives
 * @property {SceneObject[]} objects the object each of the BVH's
 *   primitives came from
 * @property {Material[]} materialList in the same order as materials
 */

/**
 * Where a ray first hits the scene.
 * @typedef {object} Hit
 * @property {number} distance along the ray, in units of its direction's length
 * @property {Vec3} point
 * @property {Vec3} normal unit length, facing back along the ray: the
 *   shading normal, smoothed and bumped as the shader sees it
 * @property {boolean} frontFace whether the ray hit the outside
 * @property {Vec2} uv where it hit on the material's texture, before the
 *   texture's scale
 * @property {SceneObject} object
 * @property {Material} material
 */

export const PRIMITIVE_KINDS = Object.freeze({
    sphere: 0,
    quad: 1,
    box: 2,
    triangle: 3,
});

/** Marks a missing index in packed data. */
export const NONE = 0xffffffff;

const PRIMITIVE_FLOATS = 16;
// Flags in a triangle's attribute block.
const SMOOTH = 1;
const TEXTURED = 2;
const MATERIAL_FLOATS = 24;

/**
 * The objects to render and the sky around them. Packing for the GPU
 * happens on demand and is cached until objects are added or removed;
 * version counts those changes, so a renderer knows when to upload again.
 */
export class Scene {

    /** @type {SceneObject[]} */
    #objects = [];
    #sky;
    #version = 0;
    /** @type {PackedScene | null} */
    #packed = null;

    /** @param {{ sky?: Sky }} [options] */
    constructor({ sky = new Sky() } = {}) {
        this.#sky = sky;
    }

    get sky() {
        return this.#sky;
    }

    set sky(value) {
        this.#sky = value;
    }

    /** A copy of the list of objects. */
    get objects() {
        return [...this.#objects];
    }

    /** Goes up by one each time the objects change. */
    get version() {
        return this.#version;
    }

    /**
     * @param {...SceneObject} objects
     * @returns {this}
     */
    add(...objects) {

        for (const object of objects) {
            if (!(object instanceof Sphere || object instanceof Quad || object instanceof Box || object instanceof Mesh))
                throw new TypeError("Scenes hold Spheres, Quads, Boxes and Meshes.");
        }

        this.#objects.push(...objects);
        this.#changed();
        return this;
    }

    /**
     * @param {SceneObject} object
     * @returns {boolean} whether it was in the scene
     */
    remove(object) {

        const index = this.#objects.indexOf(object);
        if (index < 0)
            return false;

        this.#objects.splice(index, 1);
        this.#changed();
        return true;
    }

    clear() {
        this.#objects = [];
        this.#changed();
    }

    /** The number of primitives: one per sphere, quad and box, and one per triangle. */
    get primitiveCount() {
        return this.#objects.reduce((sum, o) => sum + (o instanceof Mesh ? o.triangleCount : 1), 0);
    }

    /**
     * The box around every object, or null for an empty scene. Quads and
     * spheres count in full, so a huge floor makes a huge box.
     * @returns {{ min: Vec3, max: Vec3 } | null}
     */
    bounds() {

        const packed = this.pack();
        if (packed.primitiveCount == 0)
            return null;

        const f = new Float32Array(packed.nodes, 0, 8);
        return { min: new Vec3(f[0], f[1], f[2]), max: new Vec3(f[4], f[5], f[6]) };
    }

    /** The scene packed for the GPU, built once per version. */
    pack() {

        if (!this.#packed)
            this.#packed = Scene.#pack(this.#objects);

        return this.#packed;
    }

    /**
     * Follows a ray through the scene on the CPU, with the same tests the
     * shader uses, and returns the first hit or null.
     * @param {Vec3} origin
     * @param {Vec3} direction needn't be unit length
     * @param {number} [maxDistance]
     * @returns {Hit | null}
     */
    raycast(origin, direction, maxDistance = Infinity) {

        const packed = this.pack();
        if (packed.primitiveCount == 0)
            return null;

        const floats = new Float32Array(packed.primitives);
        const uints = new Uint32Array(packed.primitives);
        const node_floats = new Float32Array(packed.nodes);
        const node_uints = new Uint32Array(packed.nodes);

        const o = [origin.x, origin.y, origin.z];
        const d = [direction.x, direction.y, direction.z];
        const inv = d.map((c) => 1.0 / c);

        let best_t = maxDistance;
        let best = -1;
        let best_u = 0.0, best_v = 0.0;

        const stack = [0];
        while (stack.length > 0) {

            const n = /** @type {number} */ (stack.pop());
            const nb = n * 8;

            if (Scene.#slabs(node_floats, nb, o, inv) >= best_t)
                continue;

            const count = node_uints[nb + 7];
            const first = node_uints[nb + 3];

            if (count == 0) {
                // Visit the nearer child first, so it can rule out the other.
                const t_left = Scene.#slabs(node_floats, first * 8, o, inv);
                const t_right = Scene.#slabs(node_floats, (first + 1) * 8, o, inv);
                if (t_left <= t_right)
                    stack.push(first + 1, first);
                else
                    stack.push(first, first + 1);
                continue;
            }

            for (let p = first; p < first + count; ++p) {
                const hit = Scene.#intersect(floats, uints, p, o, d, best_t);
                if (hit) {
                    best_t = hit[0];
                    best_u = hit[1];
                    best_v = hit[2];
                    best = p;
                }
            }
        }

        if (best < 0)
            return null;

        const point = origin.add(direction.scale(best_t));
        const material = packed.materialList[uints[best * PRIMITIVE_FLOATS + 1]];
        const { geometric, shading: smooth } = Scene.#normals(packed, floats, uints, best, point, best_u, best_v);
        const uv = Scene.#uv(packed, floats, uints, best, point, best_u, best_v);

        let shading = smooth;
        if (material.normalMap) {
            const { tangent, up } = Scene.#tangents(packed, floats, uints, best, point, best_u, best_v);
            const scale = material.textureScale;
            const t = material.normalMap.sample(uv.x * scale.x, uv.y * scale.y, false);
            shading = bump(smooth, geometric, tangent, up, t, material.normalScale);
        }

        const front_face = geometric.dot(direction) < 0.0;
        const facing = front_face ? shading : shading.negate();

        return {
            distance: best_t,
            point,
            normal: facing,
            frontFace: front_face,
            uv,
            object: packed.objects[best],
            material,
        };
    }

    #changed() {
        this.#version++;
        this.#packed = null;
    }

    /**
     * @param {SceneObject[]} objects
     * @returns {PackedScene}
     */
    static #pack(objects) {

        /** @type {Map<Material, number>} */
        const material_index = new Map();
        /** @type {Material[]} */
        const material_list = [];

        /** @param {Material} m */
        const materialOf = (m) => {
            let index = material_index.get(m);
            if (index === undefined) {
                index = material_list.length;
                material_list.push(m);
                material_index.set(m, index);
            }
            return index;
        };

        /** @type {Map<Texture, number>} */
        const texture_index = new Map();
        /** @type {Texture[]} */
        const texture_list = [];
        /** @type {Map<Texture, number>} */
        const normal_map_index = new Map();
        /** @type {Texture[]} */
        const normal_map_list = [];

        /**
         * @param {Texture | null} texture
         * @param {Map<Texture, number>} index
         * @param {Texture[]} list
         */
        const textureOf = (texture, index, list) => {
            if (!texture)
                return NONE;
            let i = index.get(texture);
            if (i === undefined) {
                i = list.length;
                list.push(texture);
                index.set(texture, i);
            }
            return i;
        };

        // Each primitive, in object order: its packed record (with the
        // attributes index still to fix), its attribute block, its bounds.
        /** @type {Float32Array[]} */
        const records = [];
        /** @type {(number[] | null)[]} */
        const blocks = [];
        /** @type {SceneObject[]} */
        const owners = [];
        /** @type {number[]} */
        const bound_list = [];

        /**
         * @param {SceneObject} owner
         * @param {number} kind
         * @param {Material} material
         * @param {number[]} p
         * @param {Vec3[]} points the primitive's extreme points, for its bounds
         * @param {number[] | null} [block] a triangle's attribute block
         */
        const addPrimitive = (owner, kind, material, p, points, block = null) => {

            const record = new Float32Array(PRIMITIVE_FLOATS);
            const u = new Uint32Array(record.buffer);
            u[0] = kind;
            u[1] = materialOf(material);
            u[2] = NONE;
            u[3] = NONE;
            record.set(p, 4);

            records.push(record);
            blocks.push(block);
            owners.push(owner);

            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (const q of points) {
                const c = [q.x, q.y, q.z];
                for (let a = 0; a < 3; ++a) {
                    min[a] = Math.min(min[a], c[a]);
                    max[a] = Math.max(max[a], c[a]);
                }
            }

            // A little padding, so flat primitives still have boxes that
            // rays can enter despite rounding.
            for (let a = 0; a < 3; ++a) {
                const pad = 1e-4 * Math.max(1.0, Math.abs(min[a]), Math.abs(max[a]));
                min[a] -= pad;
                max[a] += pad;
            }

            bound_list.push(...min, ...max);
        };

        for (const object of objects) {

            if (object.material.type == "volume" && !(object instanceof Sphere || object instanceof Box))
                throw new TypeError("A volume must be a Sphere or a Box.");

            if (object instanceof Sphere) {
                const c = object.center, r = object.radius;
                const { x, north } = object.axes();
                addPrimitive(object, PRIMITIVE_KINDS.sphere, object.material,
                    [c.x, c.y, c.z, r, x.x, x.y, x.z, 0.0, north.x, north.y, north.z, 0.0],
                    [c.subtract(new Vec3(r, r, r)), c.add(new Vec3(r, r, r))]);
            }
            else if (object instanceof Quad) {
                const { corner: q, u, v } = object;
                addPrimitive(object, PRIMITIVE_KINDS.quad, object.material,
                    [q.x, q.y, q.z, 0.0, u.x, u.y, u.z, 0.0, v.x, v.y, v.z, 0.0],
                    [q, q.add(u), q.add(v), q.add(u).add(v)]);
            }
            else if (object instanceof Box) {
                const m = object.inverse;
                addPrimitive(object, PRIMITIVE_KINDS.box, object.material,
                    [0, 1, 2].flatMap((r) => [m.value(r, 0), m.value(r, 1), m.value(r, 2), m.value(r, 3)]),
                    object.corners());
            }
            else {
                const { positions, indices, normals, uvs } = object;
                for (let i = 0; i < indices.length; i += 3) {
                    const tri = [indices[i], indices[i + 1], indices[i + 2]];
                    const [a, b, c] = tri.map((k) => positions[k]);

                    /** @type {number[] | null} */
                    let block = null;
                    if (normals || uvs) {
                        block = [];
                        for (const k of tri) {
                            const n = normals ? normals[k] : new Vec3();
                            block.push(n.x, n.y, n.z, uvs ? uvs[k].x : 0.0);
                        }
                        block.push(...tri.map((k) => uvs ? uvs[k].y : 0.0), (normals ? SMOOTH : 0) + (uvs ? TEXTURED : 0));
                    }

                    addPrimitive(object, PRIMITIVE_KINDS.triangle, object.material,
                        [a.x, a.y, a.z, 0.0, b.x, b.y, b.z, 0.0, c.x, c.y, c.z, 0.0],
                        [a, b, c], block);
                }
            }
        }

        // Volumes stay out of the BVH: rays go through them.
        const is_volume = records.map((r) => material_list[new Uint32Array(r.buffer)[1]].type == "volume");
        const surface_ids = records.map((_, i) => i).filter((i) => !is_volume[i]);
        const volume_ids = records.map((_, i) => i).filter((i) => is_volume[i]);

        const count = surface_ids.length;
        const bounds = new Float64Array(bound_list);
        const mins = new Float64Array(count * 3);
        const maxs = new Float64Array(count * 3);
        surface_ids.forEach((id, i) => {
            mins.set(bounds.subarray(id * 6, id * 6 + 3), i * 3);
            maxs.set(bounds.subarray(id * 6 + 3, id * 6 + 6), i * 3);
        });

        const bvh = BVH.build(mins, maxs);

        const slots = Math.max(count, 1);
        const primitives = new ArrayBuffer((slots + volume_ids.length) * PRIMITIVE_FLOATS * 4);
        const prim_floats = new Float32Array(primitives);
        const prim_uints = new Uint32Array(primitives);

        // An empty scene still needs something to bind: a root leaf holding
        // one primitive of no kind, which nothing hits.
        if (count == 0) {
            prim_uints[0] = NONE;
            new Uint32Array(bvh.nodes)[7] = 1;
        }

        /** @type {number[]} */
        const attribute_list = [];
        /** @type {number[]} */
        const light_list = [];
        /** @type {SceneObject[]} */
        const packed_owners = [];

        /** @type {number[]} */
        const volume_list = volume_ids.map((id, k) => {
            prim_floats.set(records[id], (slots + k) * PRIMITIVE_FLOATS);
            return slots + k;
        });

        for (let i = 0; i < count; ++i) {

            const source = surface_ids[bvh.order[i]];
            prim_floats.set(records[source], i * PRIMITIVE_FLOATS);
            packed_owners.push(owners[source]);

            const block = blocks[source];
            if (block) {
                prim_uints[i * PRIMITIVE_FLOATS + 3] = attribute_list.length / 4;
                attribute_list.push(...block);
            }

            const kind = prim_uints[i * PRIMITIVE_FLOATS];
            const material = material_list[prim_uints[i * PRIMITIVE_FLOATS + 1]];
            if (material.emissive && (kind == PRIMITIVE_KINDS.sphere || kind == PRIMITIVE_KINDS.quad)) {
                prim_uints[i * PRIMITIVE_FLOATS + 2] = light_list.length;
                light_list.push(i);
            }
        }

        const materials = new ArrayBuffer(Math.max(material_list.length, 1) * MATERIAL_FLOATS * 4);
        const mat_floats = new Float32Array(materials);
        const mat_uints = new Uint32Array(materials);

        material_list.forEach((m, i) => {
            const o = i * MATERIAL_FLOATS;
            mat_floats.set([m.color.x, m.color.y, m.color.z], o);
            mat_uints[o + 3] = MATERIAL_TYPES[m.type];
            mat_floats.set([m.emission.x, m.emission.y, m.emission.z, m.roughness], o + 4);
            if (m.checker)
                mat_floats.set([m.checker.x, m.checker.y, m.checker.z, m.checkerSize], o + 8);
            mat_floats[o + 12] = m.ior;
            mat_uints[o + 13] = textureOf(m.texture, texture_index, texture_list);
            mat_floats.set([m.textureScale.x, m.textureScale.y], o + 14);
            mat_uints[o + 16] = textureOf(m.normalMap, normal_map_index, normal_map_list);
            mat_floats[o + 17] = m.normalScale;
            mat_uints[o + 18] = textureOf(m.emissionTexture, texture_index, texture_list);
            mat_floats[o + 19] = m.dispersion;
            mat_floats[o + 20] = m.density;
            mat_floats[o + 21] = m.anisotropy;
        });

        return {
            primitives,
            primitiveCount: count,
            nodes: bvh.nodes,
            nodeCount: bvh.nodeCount,
            materials,
            materialCount: material_list.length,
            // At least one element each: WebGPU can't bind an empty buffer.
            attributes: new Float32Array(attribute_list.length > 0 ? attribute_list : [0, 0, 0, 0]),
            textures: texture_list,
            normalMaps: normal_map_list,
            lights: new Uint32Array(light_list.length > 0 ? light_list : [NONE]),
            volumes: volume_list,
            objects: packed_owners,
            materialList: material_list,
        };
    }

    // The distance at which a ray enters a node's box, or Infinity if it
    // misses. A ray starting inside enters at 0.
    /**
     * @param {Float32Array} f
     * @param {number} base
     * @param {number[]} o
     * @param {number[]} inv
     */
    static #slabs(f, base, o, inv) {

        let t_near = 0.0;
        let t_far = Infinity;

        for (let a = 0; a < 3; ++a) {
            let t0 = (f[base + a] - o[a]) * inv[a];
            let t1 = (f[base + 4 + a] - o[a]) * inv[a];
            if (Number.isNaN(t0) || Number.isNaN(t1))
                continue; // On the slab's plane while running along it.
            if (t0 > t1)
                [t0, t1] = [t1, t0];
            t_near = Math.max(t_near, t0);
            t_far = Math.min(t_far, t1);
        }

        return t_near <= t_far ? t_near : Infinity;
    }

    // [t, u, v] for a hit nearer than t_max, or null. u and v are a
    // triangle's barycentric coordinates.
    /**
     * @param {Float32Array} f
     * @param {Uint32Array} u32
     * @param {number} p
     * @param {number[]} o
     * @param {number[]} d
     * @param {number} t_max
     * @returns {number[] | null}
     */
    static #intersect(f, u32, p, o, d, t_max) {

        const b = p * PRIMITIVE_FLOATS;
        const kind = u32[b];
        const T_MIN = 1e-4;

        /** @param {number} i */
        const vec = (i) => [f[b + i], f[b + i + 1], f[b + i + 2]];

        if (kind == PRIMITIVE_KINDS.sphere) {

            const oc = sub(o, vec(4));
            const r = f[b + 7];
            const a = dot(d, d);
            const half_b = dot(oc, d);
            const c = dot(oc, oc) - r * r;
            const disc = half_b * half_b - a * c;
            if (disc < 0.0)
                return null;
            const sq = Math.sqrt(disc);
            let t = (-half_b - sq) / a;
            if (t <= T_MIN || t >= t_max) {
                t = (-half_b + sq) / a;
                if (t <= T_MIN || t >= t_max)
                    return null;
            }
            return [t, 0.0, 0.0];
        }

        if (kind == PRIMITIVE_KINDS.quad) {

            const q = vec(4), qu = vec(8), qv = vec(12);
            const n = cross(qu, qv);
            const denom = dot(n, d);
            if (Math.abs(denom) < 1e-12)
                return null;
            const t = dot(n, sub(q, o)) / denom;
            if (t <= T_MIN || t >= t_max)
                return null;
            const h = sub(add(o, scale(d, t)), q);
            const nn = dot(n, n);
            const alpha = dot(n, cross(h, qv)) / nn;
            const beta = dot(n, cross(qu, h)) / nn;
            if (alpha < 0.0 || alpha > 1.0 || beta < 0.0 || beta > 1.0)
                return null;
            return [t, alpha, beta];
        }

        if (kind == PRIMITIVE_KINDS.box) {

            const lo = [0, 1, 2].map((r) => f[b + 4 + r * 4] * o[0] + f[b + 5 + r * 4] * o[1] + f[b + 6 + r * 4] * o[2] + f[b + 7 + r * 4]);
            const ld = [0, 1, 2].map((r) => f[b + 4 + r * 4] * d[0] + f[b + 5 + r * 4] * d[1] + f[b + 6 + r * 4] * d[2]);
            let t_near = -Infinity, t_far = Infinity;
            for (let a = 0; a < 3; ++a) {
                const inv = 1.0 / ld[a];
                let t0 = (-1.0 - lo[a]) * inv;
                let t1 = (1.0 - lo[a]) * inv;
                if (Number.isNaN(t0) || Number.isNaN(t1))
                    continue;
                if (t0 > t1)
                    [t0, t1] = [t1, t0];
                t_near = Math.max(t_near, t0);
                t_far = Math.min(t_far, t1);
            }
            if (t_near > t_far)
                return null;
            const t = t_near > T_MIN ? t_near : t_far;
            if (t <= T_MIN || t >= t_max)
                return null;
            return [t, 0.0, 0.0];
        }

        if (kind != PRIMITIVE_KINDS.triangle)
            return null;

        // A triangle, by the Möller–Trumbore test.
        const v0 = vec(4), v1 = vec(8), v2 = vec(12);
        const e1 = sub(v1, v0), e2 = sub(v2, v0);
        const pv = cross(d, e2);
        const det = dot(e1, pv);
        if (Math.abs(det) < 1e-12)
            return null;
        const inv_det = 1.0 / det;
        const tv = sub(o, v0);
        const bu = dot(tv, pv) * inv_det;
        if (bu < 0.0 || bu > 1.0)
            return null;
        const qv = cross(tv, e1);
        const bv = dot(d, qv) * inv_det;
        if (bv < 0.0 || bu + bv > 1.0)
            return null;
        const t = dot(e2, qv) * inv_det;
        if (t <= T_MIN || t >= t_max)
            return null;
        return [t, bu, bv];
    }

    // The geometric normal (the primitive's outside or front, unflipped)
    // and the shading normal (interpolated, for smooth triangles).
    /**
     * @param {PackedScene} packed
     * @param {Float32Array} f
     * @param {Uint32Array} u32
     * @param {number} p
     * @param {Vec3} point
     * @param {number} bu
     * @param {number} bv
     */
    static #normals(packed, f, u32, p, point, bu, bv) {

        const b = p * PRIMITIVE_FLOATS;
        const kind = u32[b];

        /** @param {number} i */
        const vec = (i) => new Vec3(f[b + i], f[b + i + 1], f[b + i + 2]);

        if (kind == PRIMITIVE_KINDS.sphere) {
            const n = point.subtract(vec(4)).scale(1.0 / f[b + 7]).normalized();
            return { geometric: n, shading: n };
        }

        if (kind == PRIMITIVE_KINDS.quad) {
            const n = vec(8).cross(vec(12)).normalized();
            return { geometric: n, shading: n };
        }

        if (kind == PRIMITIVE_KINDS.box) {
            // The face is the axis on which the box-space point is furthest
            // out. Its normal goes back to world space through the transpose
            // of the world-to-box matrix: that is, it's that axis's row.
            const lp = [0, 1, 2].map((r) => f[b + 4 + r * 4] * point.x + f[b + 5 + r * 4] * point.y + f[b + 6 + r * 4] * point.z + f[b + 7 + r * 4]);
            let axis = 0;
            for (let a = 1; a < 3; ++a)
                if (Math.abs(lp[a]) > Math.abs(lp[axis]))
                    axis = a;
            const sign = Math.sign(lp[axis]) || 1.0;
            const n = new Vec3(f[b + 4 + axis * 4], f[b + 5 + axis * 4], f[b + 6 + axis * 4]).scale(sign).normalized();
            return { geometric: n, shading: n };
        }

        const v0 = vec(4), v1 = vec(8), v2 = vec(12);
        const geometric = v1.subtract(v0).cross(v2.subtract(v0)).normalized();

        const ai = u32[b + 3];
        const af = packed.attributes;
        if (ai == NONE || !(af[(ai + 3) * 4 + 3] & SMOOTH))
            return { geometric, shading: geometric };

        /** @param {number} k */
        const normal = (k) => new Vec3(af[(ai + k) * 4], af[(ai + k) * 4 + 1], af[(ai + k) * 4 + 2]);

        let shading = normal(0).scale(1.0 - bu - bv).add(normal(1).scale(bu)).add(normal(2).scale(bv)).normalized();

        // Keep the shading normal on the same side as the surface.
        if (shading.dot(geometric) < 0.0)
            shading = shading.negate();

        return { geometric, shading };
    }

    // The directions on the surface in which the texture runs right
    // (increasing u) and up (decreasing v), for normal maps, as the shader
    // works them out. Neither need be unit length or quite perpendicular to
    // the normal.
    /**
     * @param {PackedScene} packed
     * @param {Float32Array} f
     * @param {Uint32Array} u32
     * @param {number} p
     * @param {Vec3} point
     * @param {number} bu
     * @param {number} bv
     */
    static #tangents(packed, f, u32, p, point, bu, bv) {

        const b = p * PRIMITIVE_FLOATS;
        const kind = u32[b];

        /** @param {number} i */
        const vec = (i) => new Vec3(f[b + i], f[b + i + 1], f[b + i + 2]);

        if (kind == PRIMITIVE_KINDS.sphere) {
            // Eastwards, and northwards.
            const d = point.subtract(vec(4)).normalized();
            let tangent = vec(12).cross(d);
            if (tangent.length() < 1e-6)
                tangent = vec(8);
            return { tangent, up: d.cross(tangent) };
        }

        if (kind == PRIMITIVE_KINDS.quad)
            return { tangent: vec(8), up: vec(12) };

        if (kind == PRIMITIVE_KINDS.box) {
            // The face's axes, as boxUv lays the texture on them.
            const lp = [0, 1, 2].map((r) => f[b + 4 + r * 4] * point.x + f[b + 5 + r * 4] * point.y + f[b + 6 + r * 4] * point.z + f[b + 7 + r * 4]);
            const [ax, ay, az] = lp.map(Math.abs);
            const r0 = vec(4), r1 = vec(8), r2 = vec(12);
            if (ax >= ay && ax >= az)
                return { tangent: r2.scale(-Math.sign(lp[0])), up: r1 };
            if (ay >= az)
                return { tangent: r0, up: r2.scale(-Math.sign(lp[1])) };
            return { tangent: r0.scale(Math.sign(lp[2])), up: r1 };
        }

        // A triangle: solve for how the position changes with u and v,
        // from its edges and their texture coordinates.
        const v0 = vec(4);
        const e1 = vec(8).subtract(v0), e2 = vec(12).subtract(v0);
        const ai = u32[b + 3];
        const af = packed.attributes;
        let du1 = [1, 0], du2 = [0, 1];
        if (ai != NONE && af[(ai + 3) * 4 + 3] & TEXTURED) {
            const uv = (/** @type {number} */ k) => [af[(ai + k) * 4 + 3], af[(ai + 3) * 4 + k]];
            const [a, c, d] = [uv(0), uv(1), uv(2)];
            const t1 = [c[0] - a[0], c[1] - a[1]], t2 = [d[0] - a[0], d[1] - a[1]];
            if (Math.abs(t1[0] * t2[1] - t2[0] * t1[1]) > 1e-12)
                [du1, du2] = [t1, t2];
        }
        const det = du1[0] * du2[1] - du2[0] * du1[1];
        const dpdu = e1.scale(du2[1]).subtract(e2.scale(du1[1])).scale(1.0 / det);
        const dpdv = e2.scale(du1[0]).subtract(e1.scale(du2[0])).scale(1.0 / det);
        return { tangent: dpdu, up: dpdv.negate() };
    }

    // Where a hit falls on the texture, as the shader works it out: a
    // sphere by latitude and longitude on its globe; a quad by how far
    // along u and v (with v up, so a texture stands upright on a wall
    // built with u right and v up); a box's face by distance from its top
    // left corner, in world units, upright on the sides; a triangle by its
    // vertices' coordinates, or failing those, its barycentric ones.
    /**
     * @param {PackedScene} packed
     * @param {Float32Array} f
     * @param {Uint32Array} u32
     * @param {number} p
     * @param {Vec3} point
     * @param {number} bu
     * @param {number} bv
     */
    static #uv(packed, f, u32, p, point, bu, bv) {

        const b = p * PRIMITIVE_FLOATS;
        const kind = u32[b];

        /** @param {number} i */
        const vec = (i) => new Vec3(f[b + i], f[b + i + 1], f[b + i + 2]);

        if (kind == PRIMITIVE_KINDS.sphere)
            return sphereUv(point.subtract(vec(4)).normalized(), vec(8), vec(12));

        if (kind == PRIMITIVE_KINDS.quad)
            return new Vec2(bu, 1.0 - bv);

        if (kind == PRIMITIVE_KINDS.box) {
            const lp = [0, 1, 2].map((r) => f[b + 4 + r * 4] * point.x + f[b + 5 + r * 4] * point.y + f[b + 6 + r * 4] * point.z + f[b + 7 + r * 4]);
            const half = [0, 1, 2].map((r) => 1.0 / Math.hypot(f[b + 4 + r * 4], f[b + 5 + r * 4], f[b + 6 + r * 4]));
            return boxUv(lp, half);
        }

        const ai = u32[b + 3];
        const af = packed.attributes;
        if (ai == NONE || !(af[(ai + 3) * 4 + 3] & TEXTURED))
            return new Vec2(bu, bv);

        const w = 1.0 - bu - bv;
        return new Vec2(
            af[ai * 4 + 3] * w + af[(ai + 1) * 4 + 3] * bu + af[(ai + 2) * 4 + 3] * bv,
            af[(ai + 3) * 4] * w + af[(ai + 3) * 4 + 1] * bu + af[(ai + 3) * 4 + 2] * bv);
    }
}

/**
 * The shading normal n tilted by a normal map's texel t (its channels
 * from 0 to 1), in the frame of the texture's right (tangent) and up, as
 * the shader does it. The tilt is kept on the outside of the geometric
 * normal ng.
 * @param {Vec3} n
 * @param {Vec3} ng
 * @param {Vec3} tangent
 * @param {Vec3} up
 * @param {Vec3} t
 * @param {number} strength
 */
function bump(n, ng, tangent, up, t, strength) {

    let right = tangent.subtract(n.scale(n.dot(tangent)));
    if (right.length() < 1e-9)
        return n;
    right = right.normalized();
    let above = n.cross(right);
    if (above.dot(up) < 0.0)
        above = above.negate();

    const tilted = right.scale((t.x * 2.0 - 1.0) * strength)
        .add(above.scale((t.y * 2.0 - 1.0) * strength))
        .add(n.scale(t.z * 2.0 - 1.0))
        .normalized();

    return tilted.dot(ng) > 0.0 ? tilted : n;
}

/**
 * Longitude and latitude on a globe: d is the unit direction from the
 * centre, x where u = 0 on the equator, north the pole at v = 0.
 * @param {Vec3} d
 * @param {Vec3} x
 * @param {Vec3} north
 */
export function sphereUv(d, x, north) {
    const z = x.cross(north);
    const u = Math.atan2(-d.dot(z), d.dot(x)) / (2.0 * Math.PI);
    const v = Math.acos(Math.min(Math.max(d.dot(north), -1.0), 1.0)) / Math.PI;
    return new Vec2(u - Math.floor(u), v);
}

/**
 * Where a box-space point on a box's face falls on the texture: the face
 * is the axis it's furthest out on, and the other two span the texture,
 * upright on the four sides, seen from outside, measured in world units
 * from the face's top left corner, so a texture keeps its size on boxes of
 * any shape.
 * @param {number[]} lp the point in box space, from -1 to 1
 * @param {number[]} half the box's half-size along each axis, in world units
 */
export function boxUv(lp, half) {

    const [x, y, z] = lp;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);

    if (ax >= ay && ax >= az)
        return new Vec2((1.0 - Math.sign(x) * z) * half[2], (1.0 - y) * half[1]);
    if (ay >= az)
        return new Vec2((1.0 + x) * half[0], (1.0 + Math.sign(y) * z) * half[2]);
    return new Vec2((1.0 + Math.sign(z) * x) * half[0], (1.0 - y) * half[1]);
}

/** @param {number[]} a @param {number[]} b */
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** @param {number[]} a @param {number[]} b */
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** @param {number[]} a @param {number} s */
function scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}

/** @param {number[]} a @param {number[]} b */
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** @param {number[]} a @param {number[]} b */
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
