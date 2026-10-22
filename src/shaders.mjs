// The WGSL shaders, kept in a module (rather than .wgsl files) so they load
// with the library wherever it's served or bundled. Not part of the public
// API.
//
// Uniform layout, shared by all the shaders and written by Renderer: 13
// rows of 16 bytes. The first 168 bytes (rows 0-9 and width, height) decide
// the image; if they change, the accumulated samples are thrown away.

const PARAMS = /* wgsl */ `
struct Params {
    cam_pos: vec3f, lens_radius: f32,
    cam_right: vec3f, tan_half_fov: f32,
    cam_up: vec3f, focus_distance: f32,
    cam_forward: vec3f, aspect: f32,
    sky_zenith: vec3f, sun_omc: f32,        // sun_omc: 1 - cos(sun's angular radius)
    sky_horizon: vec3f, sun_on: u32,
    sky_ground: vec3f, firefly_clamp: f32,
    sun_dir: vec3f, light_count: u32,
    sun_radiance: vec3f, max_bounces: u32,
    view: u32, volume_count: u32, env_strength: f32, env_rotation: f32,  // env_strength: 0 for no environment map
    width: u32, height: u32, sample_offset: u32, samples_per_frame: u32,
    total_samples: u32, exposure: f32, denoise: u32, caustics: u32,  // caustics: light tracing is on
    photon_radius: f32, photon_cell: f32, _pad5: u32, _pad6: u32,     // photon mapping's gathering radius this frame, and its grid's cell size
}

const VIEW_COLOR = 0u;
const VIEW_ALBEDO = 1u;
const VIEW_NORMAL = 2u;
const VIEW_DEPTH = 3u;
`;

/**
 * Traces samplesPerFrame paths per pixel, adding them to the accumulation,
 * with the optional features given (see the constants below).
 * @param {{ VOLUMES: boolean, TEXTURES: boolean, ENVIRONMENT: boolean, DISPERSION: boolean }} features
 */
export function traceShader(features) {
    return TRACE_SHADER.replace(/^const (VOLUMES|TEXTURES|ENVIRONMENT|DISPERSION): bool = true;$/gm,
        (_, name) => `const ${name}: bool = ${features[/** @type {keyof typeof features} */ (name)]};`);
}

/** The trace shader with every feature. */
export const TRACE_SHADER = PARAMS + /* wgsl */ `
const PI = 3.14159265358979;
const NONE = 0xffffffffu;
const T_MIN = 1e-4;
const INF = 1e30;

// Whether the scene has volumes, textures (of any kind), an environment
// map or glass that splits colours. Renderer compiles the shader with the
// ones a scene doesn't use turned off (traceShader()), so the compiler
// leaves their code out: even code that never runs slows the rest down on
// some GPUs. (They're plain constants written into the source rather than
// override constants, which Safari's compiler failed on.)
const VOLUMES: bool = true;
const TEXTURES: bool = true;
const ENVIRONMENT: bool = true;
const DISPERSION: bool = true;

const SPHERE = 0u;
const QUAD = 1u;
const BOX = 2u;
const TRIANGLE = 3u;

const DIFFUSE = 0u;
const METAL = 1u;
const PLASTIC = 2u;
const GLASS = 3u;
const LIGHT = 4u;
const VOLUME = 5u;

struct Primitive {
    kind: u32, material: u32, light: u32, attributes: u32,
    p0: vec4f, p1: vec4f, p2: vec4f,
}

struct Node {
    min: vec3f, first: u32,
    max: vec3f, count: u32,
}

struct Material {
    color: vec3f, kind: u32,
    emission: vec3f, roughness: f32,
    checker: vec3f, checker_size: f32,
    ior: f32, texture: u32, texture_scale: vec2f,
    normal_map: u32, normal_scale: f32, emission_texture: u32, dispersion: f32,
    density: f32, anisotropy: f32, _m0: f32, _m1: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> prims: array<Primitive>;
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;
// Triangles' vertex normals and texture coordinates: see PackedScene.
@group(0) @binding(4) var<storage, read> attributes: array<vec4f>;
// The primitives to sample as lights (light_count of them), then the
// volumes (volume_count).
@group(0) @binding(5) var<storage, read> lights: array<u32>;
// Per pixel, summed over samples: the colour, with the luminance squared in
// w (for the noise estimate); and the denoiser's guides, the albedo and
// the normal (w: the distance) of the first surface that isn't a mirror.
@group(0) @binding(6) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> guide_albedo: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> guide_normal: array<vec4f>;
@group(0) @binding(9) var textures: texture_2d_array<f32>;
@group(0) @binding(10) var texture_sampler: sampler;
// For light tracing: the light it adds to each pixel this frame, in fixed
// point (4 per pixel), and the lights it starts from and the spheres it
// aims at (see Renderer.#writeEmitters).
@group(0) @binding(15) var<storage, read_write> splats: array<atomic<u32>>;
@group(0) @binding(16) var<storage, read> emitters: array<vec4f>;
// For photon mapping: a hash table of grid cells, each the head of a list
// of the photons in it (an index + 1, 0 for none), with the number stored
// in the entry after the table; and the photons, three vec4s each: where
// it landed (and the next in its cell's list, in w), its power, and the
// direction it came from.
@group(0) @binding(17) var<storage, read_write> photon_heads: array<atomic<u32>>;
@group(0) @binding(18) var<storage, read_write> photons: array<vec4f>;

// Normal maps, read as plain numbers rather than sRGB.
@group(0) @binding(11) var normal_maps: texture_2d_array<f32>;
// The environment map, and the table for picking directions from it: see
// EnvironmentMap.importance(). Its sampler wraps round the horizon but not
// over the poles.
@group(0) @binding(12) var env_map: texture_2d<f32>;
@group(0) @binding(13) var env_table: texture_2d<f32>;
@group(0) @binding(14) var env_sampler: sampler;

// ---- Random numbers: PCG ----

var<private> rng_state: u32;

fn pcg(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand() -> f32 {
    rng_state = pcg(rng_state);
    return f32(rng_state >> 8u) * (1.0 / 16777216.0);
}

// ---- Geometry ----

// A tangent frame whose third column is n (Duff et al., 2017).
fn frame(n: vec3f) -> mat3x3f {
    let s = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (s + n.z);
    let b = n.x * n.y * a;
    return mat3x3f(
        vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x),
        vec3f(b, s + n.y * n.y * a, -n.y),
        n);
}

fn cosine_hemisphere(n: vec3f) -> vec3f {
    let r = sqrt(rand());
    let phi = 2.0 * PI * rand();
    let local = vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - r * r)));
    return normalize(frame(n) * local);
}

// A direction within the cone round axis whose half-angle has
// 1 - cos = omc, uniformly by solid angle.
fn sample_cone(axis: vec3f, omc: f32) -> vec3f {
    let cos_t = 1.0 - rand() * omc;
    let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    let phi = 2.0 * PI * rand();
    return normalize(frame(axis) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}

fn concentric_disk() -> vec2f {
    let u = 2.0 * vec2f(rand(), rand()) - 1.0;
    if (u.x == 0.0 && u.y == 0.0) {
        return vec2f(0.0);
    }
    if (abs(u.x) > abs(u.y)) {
        let phi = (PI / 4.0) * (u.y / u.x);
        return u.x * vec2f(cos(phi), sin(phi));
    }
    let phi = PI / 2.0 - (PI / 4.0) * (u.x / u.y);
    return u.y * vec2f(cos(phi), sin(phi));
}

// ---- Intersection ----

// (t, u, v) for a hit between T_MIN and t_max, else t = -1. u and v are a
// triangle's barycentric coordinates.
fn intersect(i: u32, o: vec3f, d: vec3f, t_max: f32) -> vec3f {

    let p = prims[i];
    let miss = vec3f(-1.0, 0.0, 0.0);

    switch p.kind {
        case 0u: { // SPHERE
            let oc = o - p.p0.xyz;
            let r = p.p0.w;
            let a = dot(d, d);
            let half_b = dot(oc, d);
            let c = dot(oc, oc) - r * r;
            let disc = half_b * half_b - a * c;
            if (disc < 0.0) {
                return miss;
            }
            let sq = sqrt(disc);
            var t = (-half_b - sq) / a;
            if (t <= T_MIN || t >= t_max) {
                t = (-half_b + sq) / a;
                if (t <= T_MIN || t >= t_max) {
                    return miss;
                }
            }
            return vec3f(t, 0.0, 0.0);
        }
        case 1u: { // QUAD
            let q = p.p0.xyz;
            let qu = p.p1.xyz;
            let qv = p.p2.xyz;
            let n = cross(qu, qv);
            let denom = dot(n, d);
            if (abs(denom) < 1e-12) {
                return miss;
            }
            let t = dot(n, q - o) / denom;
            if (t <= T_MIN || t >= t_max) {
                return miss;
            }
            let h = o + d * t - q;
            let nn = dot(n, n);
            let alpha = dot(n, cross(h, qv)) / nn;
            let beta = dot(n, cross(qu, h)) / nn;
            if (alpha < 0.0 || alpha > 1.0 || beta < 0.0 || beta > 1.0) {
                return miss;
            }
            return vec3f(t, alpha, beta);
        }
        case 2u: { // BOX: slabs in box space, where it spans -1..1
            let lo = vec3f(dot(p.p0.xyz, o) + p.p0.w, dot(p.p1.xyz, o) + p.p1.w, dot(p.p2.xyz, o) + p.p2.w);
            let ld = safe(vec3f(dot(p.p0.xyz, d), dot(p.p1.xyz, d), dot(p.p2.xyz, d)));
            let inv = 1.0 / ld;
            let t0 = (-1.0 - lo) * inv;
            let t1 = (1.0 - lo) * inv;
            let tmin = min(t0, t1);
            let tmax = max(t0, t1);
            let t_near = max(max(tmin.x, tmin.y), tmin.z);
            let t_far = min(min(tmax.x, tmax.y), tmax.z);
            if (t_near > t_far) {
                return miss;
            }
            let t = select(t_far, t_near, t_near > T_MIN);
            if (t <= T_MIN || t >= t_max) {
                return miss;
            }
            return vec3f(t, 0.0, 0.0);
        }
        case 3u: { // TRIANGLE: Möller–Trumbore
            let v0 = p.p0.xyz;
            let e1 = p.p1.xyz - v0;
            let e2 = p.p2.xyz - v0;
            let pv = cross(d, e2);
            let det = dot(e1, pv);
            if (abs(det) < 1e-12) {
                return miss;
            }
            let inv_det = 1.0 / det;
            let tv = o - v0;
            let bu = dot(tv, pv) * inv_det;
            if (bu < 0.0 || bu > 1.0) {
                return miss;
            }
            let qv = cross(tv, e1);
            let bv = dot(d, qv) * inv_det;
            if (bv < 0.0 || bu + bv > 1.0) {
                return miss;
            }
            let t = dot(e2, qv) * inv_det;
            if (t <= T_MIN || t >= t_max) {
                return miss;
            }
            return vec3f(t, bu, bv);
        }
        default: {
            return miss;
        }
    }
}

// Replaces zero components, so dividing by them gives huge numbers rather
// than infinities or NaNs, which GPUs needn't handle consistently.
fn safe(d: vec3f) -> vec3f {
    let tiny = 1e-20;
    return select(d, select(vec3f(-tiny), vec3f(tiny), d >= vec3f(0.0)), abs(d) < vec3f(tiny));
}

// The distance at which a ray enters a node's box (0 if it starts inside),
// or INF if it misses or enters beyond t_max.
fn slabs(n: Node, o: vec3f, inv: vec3f, t_max: f32) -> f32 {
    let t0 = (n.min - o) * inv;
    let t1 = (n.max - o) * inv;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    let t_near = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
    let t_far = min(min(tmax.x, tmax.y), min(tmax.z, t_max));
    return select(INF, t_near, t_near <= t_far);
}

struct Hit {
    t: f32,
    prim: u32,
    u: f32,
    v: f32,
}

// The nearest hit before t_max, or with any_hit, the first found (for
// shadow rays). prim is NONE for a miss.
fn trace(o: vec3f, d: vec3f, t_max: f32, any_hit: bool) -> Hit {

    var hit = Hit(t_max, NONE, 0.0, 0.0);
    let inv = 1.0 / safe(d);

    if (slabs(nodes[0], o, inv, t_max) >= INF) {
        return hit;
    }

    var stack: array<u32, 64>;
    var sp = 0u;
    var current = 0u;

    loop {
        let n = nodes[current];
        var descend = false;

        if (n.count > 0u) {
            for (var i = n.first; i < n.first + n.count; i++) {
                let h = intersect(i, o, d, hit.t);
                if (h.x > 0.0) {
                    hit = Hit(h.x, i, h.y, h.z);
                    if (any_hit) {
                        return hit;
                    }
                }
            }
        }
        else {
            // Visit the nearer child first; push the other if the ray
            // enters it too.
            let left = n.first;
            let right = n.first + 1u;
            let t_left = slabs(nodes[left], o, inv, hit.t);
            let t_right = slabs(nodes[right], o, inv, hit.t);
            let near = select(right, left, t_left <= t_right);
            let far = select(left, right, t_left <= t_right);

            if (min(t_left, t_right) < INF) {
                if (max(t_left, t_right) < INF && sp < 64u) {
                    stack[sp] = far;
                    sp++;
                }
                current = near;
                descend = true;
            }
        }

        if (!descend) {
            if (sp == 0u) {
                break;
            }
            sp--;
            current = stack[sp];
        }
    }

    return hit;
}

struct Surface {
    p: vec3f,
    n: vec3f,      // shading normal, facing the incoming ray
    ng: vec3f,     // geometric normal, facing the incoming ray
    front: bool,   // the ray hit the outside (or front)
    material: u32,
    light: u32,
    kind: u32,
    uv: vec2f,     // where it falls on the material's texture
}

fn surface(o: vec3f, d: vec3f, hit: Hit) -> Surface {

    let p = prims[hit.prim];
    let point = o + d * hit.t;
    var ng: vec3f;
    var ns: vec3f;
    var uv: vec2f;
    // Which way the texture runs right and up, for normal maps: see
    // Scene.#tangents.
    var tangent: vec3f;
    var up: vec3f;

    // The texture coordinates follow Scene.raycast's: see Scene.#uv.
    switch p.kind {
        case 0u: {
            ng = normalize(point - p.p0.xyz);
            ns = ng;
            uv = sphere_uv(ng, p);
            tangent = cross(p.p2.xyz, ng);
            if (length(tangent) < 1e-6) {
                tangent = p.p1.xyz;
            }
            up = cross(ng, tangent);
        }
        case 1u: {
            ng = normalize(cross(p.p1.xyz, p.p2.xyz));
            ns = ng;
            uv = vec2f(hit.u, 1.0 - hit.v);
            tangent = p.p1.xyz;
            up = p.p2.xyz;
        }
        case 2u: {
            // The axis on which the box-space point is furthest out; its
            // row of the world-to-box matrix is the face's world normal.
            let lp = vec3f(dot(p.p0.xyz, point) + p.p0.w, dot(p.p1.xyz, point) + p.p1.w, dot(p.p2.xyz, point) + p.p2.w);
            let a = abs(lp);
            // The box's half-size along each of its axes, in world units:
            // the world-to-box rows shrink as the box grows.
            let half = 1.0 / vec3f(length(p.p0.xyz), length(p.p1.xyz), length(p.p2.xyz));
            if (a.x >= a.y && a.x >= a.z) {
                ng = p.p0.xyz * sign(lp.x);
                uv = vec2f((1.0 - sign(lp.x) * lp.z) * half.z, (1.0 - lp.y) * half.y);
                tangent = -sign(lp.x) * p.p2.xyz;
                up = p.p1.xyz;
            }
            else if (a.y >= a.z) {
                ng = p.p1.xyz * sign(lp.y);
                uv = vec2f((1.0 + lp.x) * half.x, (1.0 + sign(lp.y) * lp.z) * half.z);
                tangent = p.p0.xyz;
                up = -sign(lp.y) * p.p2.xyz;
            }
            else {
                ng = p.p2.xyz * sign(lp.z);
                uv = vec2f((1.0 + sign(lp.z) * lp.x) * half.x, (1.0 - lp.y) * half.y);
                tangent = sign(lp.z) * p.p0.xyz;
                up = p.p1.xyz;
            }
            ng = normalize(ng);
            ns = ng;
        }
        default: {
            let e1 = p.p1.xyz - p.p0.xyz;
            let e2 = p.p2.xyz - p.p0.xyz;
            ng = normalize(cross(e1, e2));
            ns = ng;
            uv = vec2f(hit.u, hit.v);
            var du1 = vec2f(1.0, 0.0);
            var du2 = vec2f(0.0, 1.0);
            if (p.attributes != NONE) {
                let w = 1.0 - hit.u - hit.v;
                let a0 = attributes[p.attributes];
                let a1 = attributes[p.attributes + 1u];
                let a2 = attributes[p.attributes + 2u];
                let vs = attributes[p.attributes + 3u];
                // Flags: 1 for smooth normals, 2 for texture coordinates.
                let flags = u32(vs.w);
                if ((flags & 1u) != 0u) {
                    ns = normalize(a0.xyz * w + a1.xyz * hit.u + a2.xyz * hit.v);
                    if (dot(ns, ng) < 0.0) {
                        ns = -ns;
                    }
                }
                if ((flags & 2u) != 0u) {
                    uv = vec2f(a0.w * w + a1.w * hit.u + a2.w * hit.v, vs.x * w + vs.y * hit.u + vs.z * hit.v);
                    let t1 = vec2f(a1.w - a0.w, vs.y - vs.x);
                    let t2 = vec2f(a2.w - a0.w, vs.z - vs.x);
                    if (abs(t1.x * t2.y - t2.x * t1.y) > 1e-12) {
                        du1 = t1;
                        du2 = t2;
                    }
                }
            }
            // How the position changes with u and v.
            let det = du1.x * du2.y - du2.x * du1.y;
            tangent = (e1 * du2.y - e2 * du1.y) / det;
            up = -(e2 * du1.x - e1 * du2.x) / det;
        }
    }

    let m = materials[p.material];
    if (TEXTURES && m.normal_map != NONE) {
        let t = textureSampleLevel(normal_maps, texture_sampler, uv * m.texture_scale, m.normal_map, 0.0).xyz;
        ns = bump(ns, ng, tangent, up, t, m.normal_scale);
    }

    let front = dot(ng, d) < 0.0;
    let flip = select(-1.0, 1.0, front);

    return Surface(point, ns * flip, ng * flip, front, p.material, p.light, p.kind, uv);
}

// Longitude and latitude on a sphere's globe, for unit direction n from
// its centre: see sphereUv.
fn sphere_uv(n: vec3f, p: Primitive) -> vec2f {
    let z = cross(p.p1.xyz, p.p2.xyz);
    let u = atan2(-dot(n, z), dot(n, p.p1.xyz)) / (2.0 * PI);
    return vec2f(u - floor(u), acos(clamp(dot(n, p.p2.xyz), -1.0, 1.0)) / PI);
}

// The shading normal n tilted by a normal map's texel t, in the frame of
// the texture's right and up, kept outside the geometric normal ng: as
// Scene's bump().
fn bump(n: vec3f, ng: vec3f, tangent: vec3f, up: vec3f, t: vec3f, strength: f32) -> vec3f {
    var right = tangent - n * dot(n, tangent);
    if (length(right) < 1e-9) {
        return n;
    }
    right = normalize(right);
    var above = cross(n, right);
    if (dot(above, up) < 0.0) {
        above = -above;
    }
    let tilted = normalize(right * ((t.x * 2.0 - 1.0) * strength) + above * ((t.y * 2.0 - 1.0) * strength) + n * (t.z * 2.0 - 1.0));
    return select(n, tilted, dot(tilted, ng) > 0.0);
}

fn occluded(o: vec3f, d: vec3f, dist: f32) -> bool {
    return trace(o, d, dist, true).prim != NONE;
}

// A ray origin nudged off the surface, to the side wi leaves by, so it
// doesn't hit the surface it starts on.
fn offset(s: Surface, wi: vec3f) -> vec3f {
    let eps = 1e-4 * max(1.0, max(abs(s.p.x), max(abs(s.p.y), abs(s.p.z))));
    return s.p + s.ng * select(-eps, eps, dot(wi, s.ng) > 0.0);
}

// ---- Sky ----

// Where direction d falls on the environment map, turned by its rotation:
// see EnvironmentMap.uv().
fn env_uv(d: vec3f) -> vec2f {
    let u = 0.5 + atan2(d.x, -d.z) / (2.0 * PI) - params.env_rotation / (2.0 * PI);
    return vec2f(u - floor(u), acos(clamp(d.y, -1.0, 1.0)) / PI);
}

fn env_radiance(d: vec3f) -> vec3f {
    return textureSampleLevel(env_map, env_sampler, env_uv(d), 0.0).rgb * params.env_strength;
}

fn env_cdf(x: u32, y: u32) -> f32 {
    return textureLoad(env_table, vec2u(x, y), 0).r;
}

// The first of n entries of a cumulative distribution in row y of the
// table that exceeds xi.
fn env_search(y: u32, n: u32, xi: f32) -> u32 {
    var lo = 0u;
    var hi = n - 1u;
    loop {
        if (lo >= hi) {
            break;
        }
        let mid = (lo + hi) / 2u;
        if (env_cdf(mid, y) > xi) {
            hi = mid;
        }
        else {
            lo = mid + 1u;
        }
    }
    return lo;
}

// The probability density per steradian of picking direction d from the
// environment: see EnvironmentMap.pdf().
fn env_pdf(d: vec3f) -> f32 {
    let size = textureDimensions(env_table);
    let cw = size.x;
    let ch = size.y - 1u;
    let uv = env_uv(d);
    let x = min(u32(uv.x * f32(cw)), cw - 1u);
    let y = min(u32(uv.y * f32(ch)), ch - 1u);
    let row = env_cdf(y, ch) - select(0.0, env_cdf(y - 1u, ch), y > 0u);
    let cell = env_cdf(x, y) - select(0.0, env_cdf(x - 1u, y), x > 0u);
    let s = sin(uv.y * PI);
    return select(0.0, row * cell * f32(cw * ch) / (2.0 * PI * PI * s), s > 0.0);
}

// A direction picked from the environment in proportion to its light.
fn sample_env() -> vec3f {
    let size = textureDimensions(env_table);
    let cw = size.x;
    let ch = size.y - 1u;
    let y = env_search(ch, ch, rand());
    let x = env_search(y, cw, rand());
    let u = (f32(x) + rand()) / f32(cw) + params.env_rotation / (2.0 * PI);
    let v = (f32(y) + rand()) / f32(ch);
    let phi = (u - 0.5) * 2.0 * PI;
    let theta = v * PI;
    return vec3f(sin(theta) * sin(phi), cos(theta), -sin(theta) * cos(phi));
}

fn sky(d: vec3f) -> vec3f {
    if (ENVIRONMENT && params.env_strength > 0.0) {
        return env_radiance(d);
    }
    if (d.y >= 0.0) {
        return mix(params.sky_horizon, params.sky_zenith, sqrt(min(d.y, 1.0)));
    }
    return mix(params.sky_horizon, params.sky_ground, sqrt(min(-d.y, 1.0)));
}

fn in_sun(d: vec3f) -> bool {
    return params.sun_on != 0u && dot(d, params.sun_dir) >= 1.0 - params.sun_omc;
}

// ---- Materials ----

// The surface's colour at point p, texture coordinate uv: its colour, or
// the checkerboard's, times its texture if it has one.
fn albedo(m: Material, p: vec3f, uv: vec2f) -> vec3f {
    var c = m.color;
    if (m.checker_size > 0.0) {
        let cell = floor(p / m.checker_size + 1e-3);
        let odd = (i32(cell.x) + i32(cell.y) + i32(cell.z)) & 1;
        c = select(m.color, m.checker, odd != 0);
    }
    if (TEXTURES && m.texture != NONE) {
        c *= textureSampleLevel(textures, texture_sampler, uv * m.texture_scale, m.texture, 0.0).rgb;
    }
    return c;
}

// What a material gives off at texture coordinate uv.
fn emitted(m: Material, uv: vec2f) -> vec3f {
    if (!TEXTURES || m.emission_texture == NONE) {
        return m.emission;
    }
    return m.emission * textureSampleLevel(textures, texture_sampler, uv * m.texture_scale, m.emission_texture, 0.0).rgb;
}

fn is_delta(m: Material) -> bool {
    return m.kind == GLASS || (m.kind == METAL && m.roughness < 0.01);
}

fn ggx_alpha2(roughness: f32) -> f32 {
    let alpha = max(roughness * roughness, 0.002);
    return alpha * alpha;
}

fn ggx_d(nh: f32, a2: f32) -> f32 {
    let k = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / (PI * k * k);
}

fn smith_g1(nv: f32, a2: f32) -> f32 {
    return 2.0 * nv / (nv + sqrt(a2 + (1.0 - a2) * nv * nv));
}

// A microfacet normal, drawn in proportion to D(h) cos(h).
fn sample_ggx(n: vec3f, a2: f32) -> vec3f {
    let r = rand();
    let cos_t = sqrt((1.0 - r) / (1.0 + (a2 - 1.0) * r));
    let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    let phi = 2.0 * PI * rand();
    return normalize(frame(n) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}

fn schlick(f0: vec3f, c: f32) -> vec3f {
    return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}

fn dielectric_f0(ior: f32) -> f32 {
    let r = (ior - 1.0) / (ior + 1.0);
    return r * r;
}

// The fraction reflected at a smooth boundary into a medium eta times as
// dense (n_transmitted / n_incident), from the exact Fresnel equations.
fn fresnel_dielectric(cos_i: f32, eta: f32) -> f32 {
    let sin2_t = (1.0 - cos_i * cos_i) / (eta * eta);
    if (sin2_t >= 1.0) {
        return 1.0;
    }
    let cos_t = sqrt(1.0 - sin2_t);
    let rs = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    let rp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    return 0.5 * (rs * rs + rp * rp);
}

// How often plastic samples its glossy coat rather than its base.
fn plastic_spec_chance(m: Material, nv: f32) -> f32 {
    return clamp(schlick(vec3f(dielectric_f0(m.ior)), nv).x * 4.0 + 0.1, 0.1, 0.9);
}

struct Eval {
    f: vec3f,   // the BSDF times cos(n, wi)
    pdf: f32,   // of sampling wi, per solid angle
}

// For the materials that aren't delta (perfectly sharp).
fn eval_bsdf(m: Material, base: vec3f, n: vec3f, wo: vec3f, wi: vec3f) -> Eval {

    let nl = dot(n, wi);
    let nv = dot(n, wo);
    if (nl <= 0.0 || nv <= 0.0) {
        return Eval(vec3f(0.0), 0.0);
    }

    if (m.kind == DIFFUSE) {
        return Eval(base * (nl / PI), nl / PI);
    }

    let a2 = ggx_alpha2(m.roughness);
    let h = normalize(wo + wi);
    let nh = max(dot(n, h), 0.0);
    let vh = max(dot(wo, h), 1e-6);
    let d = ggx_d(nh, a2);
    let g = smith_g1(nv, a2) * smith_g1(nl, a2);
    let spec_pdf = d * nh / (4.0 * vh);

    if (m.kind == METAL) {
        let f = schlick(base, vh);
        return Eval(f * (d * g / (4.0 * nv)), spec_pdf);
    }

    // Plastic: a clear coat over a diffuse base, which gets the light the
    // coat lets through, both ways.
    let f0 = vec3f(dielectric_f0(m.ior));
    let coat = schlick(f0, vh).x * d * g / (4.0 * nv);
    let through = (1.0 - schlick(f0, nl).x) * (1.0 - schlick(f0, nv).x);
    let diffuse = base * (through * nl / PI);
    let chance = plastic_spec_chance(m, nv);

    return Eval(vec3f(coat) + diffuse, chance * spec_pdf + (1.0 - chance) * nl / PI);
}

struct BsdfSample {
    wi: vec3f,
    weight: vec3f,  // f cos / pdf
    pdf: f32,       // 0 for a delta lobe
    delta: bool,
    ok: bool,
}

fn sample_bsdf(m: Material, base: vec3f, s: Surface, wo: vec3f) -> BsdfSample {

    let fail = BsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false, false);
    let n = s.n;
    let nv = dot(n, wo);

    if (m.kind == GLASS) {
        // Entering the outside goes into the denser medium.
        let eta = select(1.0 / m.ior, m.ior, s.front);
        let cos_i = clamp(nv, 0.0, 1.0);
        let f = fresnel_dielectric(cos_i, eta);
        if (rand() < f) {
            return BsdfSample(reflect(-wo, n), vec3f(1.0), 0.0, true, true);
        }
        let wi = refract(-wo, n, 1.0 / eta);
        if (dot(wi, wi) == 0.0) {
            return BsdfSample(reflect(-wo, n), vec3f(1.0), 0.0, true, true);
        }
        // Tint once per crossing of the glass, on the way in.
        let tint = select(vec3f(1.0), base, s.front);
        return BsdfSample(normalize(wi), tint, 0.0, true, true);
    }

    if (m.kind == METAL && m.roughness < 0.01) {
        let wi = reflect(-wo, n);
        return BsdfSample(wi, schlick(base, nv), 0.0, true, true);
    }

    var wi: vec3f;
    if (m.kind == DIFFUSE) {
        wi = cosine_hemisphere(n);
    }
    else if (m.kind == METAL || rand() < plastic_spec_chance(m, nv)) {
        let h = sample_ggx(n, ggx_alpha2(m.roughness));
        wi = reflect(-wo, h);
    }
    else {
        wi = cosine_hemisphere(n);
    }

    // Reject directions below the true surface, which smooth normals can
    // otherwise send through it.
    if (dot(wi, s.ng) <= 0.0) {
        return fail;
    }

    let e = eval_bsdf(m, base, n, wo, wi);
    if (e.pdf <= 0.0) {
        return fail;
    }

    return BsdfSample(wi, e.f / e.pdf, e.pdf, false, true);
}

// ---- Lights ----

// The lights next event estimation chooses among: the lights, then the
// sun, then the environment.
fn light_choices() -> u32 {
    return params.light_count + select(0u, 1u, params.sun_on != 0u) + select(0u, 1u, ENVIRONMENT && params.env_strength > 0.0);
}

fn sun_choice() -> u32 {
    return select(NONE, params.light_count, params.sun_on != 0u);
}

fn env_choice() -> u32 {
    return select(NONE, params.light_count + select(0u, 1u, params.sun_on != 0u), ENVIRONMENT && params.env_strength > 0.0);
}

// 1 - cos of the half-angle a sphere covers from a point at squared
// distance d2, accurate even when tiny.
fn sphere_omc(r: f32, d2: f32) -> f32 {
    let x = min(r * r / d2, 1.0);
    return x / (1.0 + sqrt(1.0 - x));
}

struct LightSample {
    wi: vec3f,
    dist: f32,  // from the point sampled from, to the light
    radiance: vec3f,
    pdf: f32,   // per solid angle, including the chance of choosing this light; 0 for none
}

fn sample_light(p: vec3f) -> LightSample {

    let none = LightSample(vec3f(0.0), 0.0, vec3f(0.0), 0.0);
    let choices = light_choices();
    let pick = min(u32(rand() * f32(choices)), choices - 1u);
    let chance = 1.0 / f32(choices);

    if (ENVIRONMENT && pick == env_choice()) {
        let wi = sample_env();
        let pdf = env_pdf(wi);
        if (pdf <= 0.0) {
            return none;
        }
        return LightSample(wi, INF, env_radiance(wi), chance * pdf);
    }

    if (pick == sun_choice()) {
        let wi = sample_cone(params.sun_dir, params.sun_omc);
        return LightSample(wi, INF, params.sun_radiance, chance / (2.0 * PI * params.sun_omc));
    }

    let prim = prims[lights[pick]];
    let m = materials[prim.material];

    if (prim.kind == QUAD) {
        let a = rand();
        let b = rand();
        let q = prim.p0.xyz + prim.p1.xyz * a + prim.p2.xyz * b;
        let to = q - p;
        let d2 = dot(to, to);
        let dist = sqrt(d2);
        let wi = to / dist;
        let c = cross(prim.p1.xyz, prim.p2.xyz);
        let area = length(c);
        let cos_l = -dot(wi, c / area);
        if (cos_l <= 0.0) {
            return none;
        }
        return LightSample(wi, dist, emitted(m, vec2f(a, 1.0 - b)), chance * d2 / (cos_l * area));
    }

    // A sphere: sample the cone it covers.
    let to = prim.p0.xyz - p;
    let d2 = dot(to, to);
    let r = prim.p0.w;
    if (d2 <= r * r) {
        return none;
    }
    let omc = sphere_omc(r, d2);
    let wi = sample_cone(to / sqrt(d2), omc);
    let b = dot(to, wi);
    let dist = b - sqrt(max(b * b - (d2 - r * r), 0.0));
    let n = normalize(p + wi * dist - prim.p0.xyz);
    return LightSample(wi, dist, emitted(m, sphere_uv(n, prim)), chance / (2.0 * PI * omc));
}

// The pdf sample_light would have had of choosing a direction that hit
// light primitive prim at distance t from p.
fn light_pdf(prim_index: u32, p: vec3f, wi: vec3f, t: f32) -> f32 {

    let prim = prims[prim_index];
    let chance = 1.0 / f32(light_choices());

    if (prim.kind == QUAD) {
        let c = cross(prim.p1.xyz, prim.p2.xyz);
        let area = length(c);
        let cos_l = abs(dot(wi, c / area));
        return chance * t * t / max(cos_l * area, 1e-12);
    }

    let to = prim.p0.xyz - p;
    let omc = sphere_omc(prim.p0.w, dot(to, to));
    return chance / (2.0 * PI * omc);
}

fn power_heuristic(a: f32, b: f32) -> f32 {
    let a2 = a * a;
    let b2 = b * b;
    if (a2 + b2 <= 0.0) {
        return 0.0;
    }
    return a2 / (a2 + b2);
}

// ---- Volumes ----

// Where a ray crosses volume primitive i, a sphere or box: from x to y,
// with x at least 0; x >= y if it misses.
fn volume_span(i: u32, o: vec3f, d: vec3f) -> vec2f {

    let p = prims[i];

    if (p.kind == SPHERE) {
        let oc = o - p.p0.xyz;
        let a = dot(d, d);
        let half_b = dot(oc, d);
        let disc = half_b * half_b - a * (dot(oc, oc) - p.p0.w * p.p0.w);
        if (disc < 0.0) {
            return vec2f(1.0, 0.0);
        }
        let sq = sqrt(disc);
        return vec2f(max((-half_b - sq) / a, 0.0), (-half_b + sq) / a);
    }

    let lo = vec3f(dot(p.p0.xyz, o) + p.p0.w, dot(p.p1.xyz, o) + p.p1.w, dot(p.p2.xyz, o) + p.p2.w);
    let inv = 1.0 / safe(vec3f(dot(p.p0.xyz, d), dot(p.p1.xyz, d), dot(p.p2.xyz, d)));
    let t0 = (-1.0 - lo) * inv;
    let t1 = (1.0 - lo) * inv;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    return vec2f(max(max(max(tmin.x, tmin.y), tmin.z), 0.0), min(min(tmax.x, tmax.y), tmax.z));
}

fn volume(k: u32) -> u32 {
    return lights[params.light_count + k];
}

struct Scatter {
    t: f32,
    volume: u32,  // NONE if the ray got through
}

// Where, before t_max, a ray along unit direction d first meets a particle
// in a volume, if it does. Each volume's distance is drawn from its own
// exponential and the nearest wins, which is the same as drawing from all
// of them together.
fn scatter_in_volumes(o: vec3f, d: vec3f, t_max: f32) -> Scatter {

    var s = Scatter(t_max, NONE);
    if (!VOLUMES) {
        return s;
    }

    for (var k = 0u; k < params.volume_count; k++) {
        let i = volume(k);
        let span = volume_span(i, o, d);
        let end = min(span.y, s.t);
        if (span.x < end) {
            let t = span.x - log(1.0 - rand()) / materials[prims[i].material].density;
            if (t < end) {
                s = Scatter(t, i);
            }
        }
    }

    return s;
}

// The fraction of light that gets through the volumes along unit
// direction d, from o to dist.
fn transmittance(o: vec3f, d: vec3f, dist: f32) -> f32 {

    if (!VOLUMES) {
        return 1.0;
    }
    var depth = 0.0;

    for (var k = 0u; k < params.volume_count; k++) {
        let i = volume(k);
        let span = volume_span(i, o, d);
        let end = min(span.y, dist);
        if (span.x < end) {
            depth += materials[prims[i].material].density * (end - span.x);
        }
    }

    return exp(-depth);
}

// The Henyey-Greenstein phase function, per steradian, for light
// travelling along d turned to wi, where c = dot(d, wi).
fn henyey_greenstein(c: f32, g: f32) -> f32 {
    let k = 1.0 + g * g - 2.0 * g * c;
    return (1.0 - g * g) / (4.0 * PI * k * sqrt(k));
}

// A direction drawn from henyey_greenstein, for light travelling along d.
fn sample_henyey_greenstein(d: vec3f, g: f32) -> vec3f {
    var c = 1.0 - 2.0 * rand();
    if (abs(g) >= 1e-3) {
        let sq = (1.0 - g * g) / (1.0 + g - 2.0 * g * rand());
        c = clamp((1.0 + g * g - sq * sq) / (2.0 * g), -1.0, 1.0);
    }
    let sin_t = sqrt(max(0.0, 1.0 - c * c));
    let phi = 2.0 * PI * rand();
    return normalize(frame(d) * vec3f(sin_t * cos(phi), sin_t * sin(phi), c));
}

// ---- Dispersion ----

fn lobe(x: f32, mu: f32, below: f32, above: f32) -> f32 {
    let t = (x - mu) / select(above, below, x < mu);
    return exp(-0.5 * t * t);
}

// The linear RGB of a single wavelength, in nanometres, from Wyman, Sloan
// and Shirley's fit to the CIE colour matching functions, with the colours
// sRGB can't show clipped, scaled so the average over 380-720 nm is white.
fn wavelength_rgb(l: f32) -> vec3f {
    let x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
    let y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
    let z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
    let rgb = vec3f(
        3.2406 * x - 1.5372 * y - 0.4986 * z,
        -0.9689 * x + 1.8758 * y + 0.0415 * z,
        0.0557 * x - 0.2040 * y + 1.0570 * z);
    return max(rgb, vec3f(0.0)) * vec3f(1.92985, 2.94689, 3.11081);
}

// ---- Paths ----

fn camera_ray(px: vec2f, jitter: bool) -> array<vec3f, 2> {

    let size = vec2f(f32(params.width), f32(params.height));
    let ndc = vec2f(2.0 * px.x / size.x - 1.0, 1.0 - 2.0 * px.y / size.y);
    let dir = normalize(params.cam_forward +
        params.cam_right * (ndc.x * params.tan_half_fov * params.aspect) +
        params.cam_up * (ndc.y * params.tan_half_fov));

    if (!jitter || params.lens_radius <= 0.0) {
        return array<vec3f, 2>(params.cam_pos, dir);
    }

    // Thin lens: start somewhere on the lens, aimed at the point on the
    // focus plane the pinhole ray would reach.
    let focus = params.cam_pos + dir * (params.focus_distance / dot(dir, params.cam_forward));
    let lens = concentric_disk() * params.lens_radius;
    let origin = params.cam_pos + params.cam_right * lens.x + params.cam_up * lens.y;
    return array<vec3f, 2>(origin, normalize(focus - origin));
}

// Where in the spectrum this sample's wavelength falls, from 0 to 1, if it
// needs one: successive samples of a pixel step through the spectrum by the
// golden ratio from a random start, so a few cover it evenly and colours
// split by glass converge far faster than with a random draw each.
var<private> spectrum_u: f32;

// What radiance() saw first, for the denoiser.
var<private> g_albedo: vec3f;
var<private> g_normal: vec4f;

// One sample of the light reaching the camera through pixel position px.
fn radiance(px: vec2f) -> vec3f {

    g_albedo = vec3f(1.0);
    g_normal = vec4f(0.0);
    var guided = false;
    var travelled = 0.0;

    let ray = camera_ray(px, true);
    var o = ray[0];
    var d = ray[1];

    var throughput = vec3f(1.0);
    var result = vec3f(0.0);
    var last_pdf = 0.0;
    var last_delta = true;
    var last_p = o;
    let choices = light_choices();
    // Once a path meets glass that splits colours, it follows one
    // wavelength, in nanometres; 0 until then.
    var wavelength = 0.0;
    // Whether the path so far is the camera, any mirrors and glass, a
    // surface that isn't, then only mirrors and glass: with caustics on,
    // the light it would find at the end of that is light tracing's to
    // count (if the camera sees the surface directly) or photon mapping's.
    var caustic = false;
    var diffuse_seen = false;

    for (var depth = 0u; depth <= params.max_bounces; depth++) {

        let hit = trace(o, d, INF, false);

        if (VOLUMES) {
            // A particle in a volume, before the surface (or the sky)?
            let sc = scatter_in_volumes(o, d, hit.t);
            if (sc.volume != NONE) {

                let vm = materials[prims[sc.volume].material];
                let p = o + d * sc.t;
                travelled += sc.t;

                if (!guided) {
                    guided = true;
                    g_albedo = throughput * vm.color;
                    g_normal = vec4f(-d, travelled);
                }

                if (depth == params.max_bounces) {
                    break;
                }

                throughput *= vm.color;

                // Next event estimation, through the volumes on the way.
                if (choices > 0u) {
                    let ls = sample_light(p);
                    if (ls.pdf > 0.0) {
                        let phase = henyey_greenstein(dot(d, ls.wi), vm.anisotropy);
                        let reach = ls.dist * (1.0 - 1e-3);
                        if (!occluded(p, ls.wi, reach)) {
                            result += throughput * ls.radiance * (phase * transmittance(p, ls.wi, reach) * power_heuristic(ls.pdf, phase) / ls.pdf);
                        }
                    }
                }

                // The phase function is sampled exactly, so its weight is 1.
                let wi = sample_henyey_greenstein(d, vm.anisotropy);
                last_pdf = henyey_greenstein(dot(d, wi), vm.anisotropy);
                last_delta = false;
                last_p = p;
                o = p;
                d = wi;

                caustic = false;
                diffuse_seen = true;

                if (!roulette(&throughput, depth)) {
                    break;
                }
                continue;
            }
        }

        if (hit.prim == NONE) {
            if (!guided) {
                g_albedo = throughput;
            }
            // An environment is sampled directly too, so weigh it against
            // that; the gradient isn't.
            var sky_weight = 1.0;
            if (ENVIRONMENT && params.env_strength > 0.0 && !last_delta) {
                sky_weight = power_heuristic(last_pdf, env_pdf(d) / f32(choices));
            }
            result += throughput * sky(d) * sky_weight;
            if (in_sun(d) && !(caustic && last_delta)) {
                var w = 1.0;
                if (!last_delta) {
                    w = power_heuristic(last_pdf, 1.0 / (f32(choices) * 2.0 * PI * params.sun_omc));
                }
                result += throughput * params.sun_radiance * w;
            }
            break;
        }

        let s = surface(o, d, hit);
        let m = materials[s.material];
        travelled += hit.t;

        // The guides come from the first surface that isn't a mirror or
        // glass, seen through any that are, so reflections keep their
        // edges.
        if (!guided && (m.kind == LIGHT || !is_delta(m) || depth == params.max_bounces)) {
            guided = true;
            g_albedo = throughput * select(albedo(m, s.p, s.uv), vec3f(1.0), m.kind == LIGHT);
            g_normal = vec4f(s.n, travelled);
        }

        // Lights, and glowing surfaces, give off light from their fronts;
        // but a light seen through mirrors and glass from the first surface
        // is left to light tracing.
        if (s.front && any(m.emission > vec3f(0.0)) && !(caustic && last_delta && s.light != NONE)) {
            var w = 1.0;
            if (!last_delta && s.light != NONE) {
                w = power_heuristic(last_pdf, light_pdf(hit.prim, last_p, d, hit.t));
            }
            result += throughput * emitted(m, s.uv) * w;
        }

        if (m.kind == LIGHT) {
            break;
        }

        if (!is_delta(m)) {
            caustic = params.caustics != 0u && !diffuse_seen;
            diffuse_seen = true;
        }

        if (depth == params.max_bounces) {
            break;
        }

        let base = albedo(m, s.p, s.uv);
        let wo = -d;

        // Next event estimation: aim a ray straight at a light.
        if (!is_delta(m) && choices > 0u) {
            let ls = sample_light(s.p);
            if (ls.pdf > 0.0 && dot(ls.wi, s.ng) > 0.0) {
                let e = eval_bsdf(m, base, s.n, wo, ls.wi);
                // The shadow ray starts off the surface, so it has a little
                // less far to go, and stops just short of the light.
                let origin = offset(s, ls.wi);
                let reach = (ls.dist - dot(origin - s.p, ls.wi)) * (1.0 - 1e-3);
                if (e.pdf > 0.0 && !occluded(origin, ls.wi, reach)) {
                    result += throughput * e.f * ls.radiance * (transmittance(origin, ls.wi, reach) * power_heuristic(ls.pdf, e.pdf) / ls.pdf);
                }
            }
        }

        let bs = sample_bsdf(dispersed(m, &wavelength, &throughput, spectrum_u), base, s, wo);
        if (!bs.ok) {
            break;
        }

        throughput *= bs.weight;
        last_pdf = bs.pdf;
        last_delta = bs.delta;
        last_p = s.p;
        o = offset(s, bs.wi);
        d = bs.wi;

        if (!roulette(&throughput, depth)) {
            break;
        }
    }

    return result;
}

// Russian roulette: after a few bounces, ends dim paths at random (returning
// false), boosting the survivors to make up for them.
fn roulette(throughput: ptr<function, vec3f>, depth: u32) -> bool {
    if (depth < 3u) {
        return true;
    }
    let t = *throughput;
    let survive = min(max(t.x, max(t.y, t.z)), 0.95);
    if (rand() >= survive) {
        return false;
    }
    *throughput = t / survive;
    return true;
}

// The albedo, normal or depth seen through the centre of pixel px.
fn inspect(px: vec2f) -> vec3f {

    let ray = camera_ray(px, false);
    let hit = trace(ray[0], ray[1], INF, false);

    if (hit.prim == NONE) {
        if (params.view == VIEW_ALBEDO) {
            return sky(ray[1]);
        }
        return vec3f(0.0);
    }

    let s = surface(ray[0], ray[1], hit);
    let m = materials[s.material];

    switch params.view {
        case 1u: {
            if (m.kind == LIGHT) {
                let e = emitted(m, s.uv);
                return e / max(max(e.x, e.y), max(e.z, 1.0));
            }
            return albedo(m, s.p, s.uv);
        }
        case 2u: {
            return s.n;
        }
        default: {
            return vec3f(hit.t);
        }
    }
}

// Glass that splits colours: chooses a wavelength from u, if the path has
// none yet, and carries its colour; from then on, glass bends the path by
// its index of refraction at that wavelength (Cauchy's equation).
fn dispersed(m: Material, wavelength: ptr<function, f32>, throughput: ptr<function, vec3f>, u: f32) -> Material {
    var sm = m;
    if (DISPERSION && m.kind == GLASS && m.dispersion > 0.0) {
        if (*wavelength == 0.0) {
            *wavelength = 380.0 + 340.0 * u;
            *throughput *= wavelength_rgb(*wavelength);
        }
        let l = *wavelength * 1e-3;
        sm.ior = m.ior + m.dispersion * (1.0 / (l * l) - 1.0 / (0.5876 * 0.5876));
    }
    return sm;
}

// ---- Light tracing ----
//
// Caustics (light from a lamp or the sun focused by mirrors and glass onto
// a surface) take path tracing ages, since a path from that surface must
// find its way back through the glass to the light by chance. Light
// tracing follows light the other way: from a light, through mirrors and
// glass, to the first other surface, which it connects to the camera.
// The two split the paths between them: the path tracer leaves out
// camera, surface, mirrors or glass, light (see caustic in radiance()),
// and light tracing counts only those. It works for the pinhole camera.

// Each photon's light is added to its pixel in fixed point, 1/SPLAT_SCALE
// at a time, rounded up or down at random in proportion, so on average
// nothing is lost however faint each photon (a pixel can take 65536 a
// frame before its 32 bits overflow).
const SPLAT_SCALE = 65536.0;

// Adds a photon's light to the pixel that sees surface s, if the camera
// sees it: beta is the photon's power, arriving along d.
fn splat(s: Surface, m: Material, base: vec3f, d: vec3f, beta: vec3f) {

    let to_camera = params.cam_pos - s.p;
    let dist = length(to_camera);
    let wo = to_camera / dist;
    let cos_film = -dot(wo, params.cam_forward);
    if (cos_film <= 1e-6 || dot(wo, s.ng) <= 0.0) {
        return;
    }

    // Where it falls on the film, a unit in front of the camera.
    let x = -dot(wo, params.cam_right) / (cos_film * params.tan_half_fov * params.aspect);
    let y = -dot(wo, params.cam_up) / (cos_film * params.tan_half_fov);
    let px = (x + 1.0) * 0.5 * f32(params.width);
    let py = (1.0 - y) * 0.5 * f32(params.height);
    if (px < 0.0 || py < 0.0 || px >= f32(params.width) || py >= f32(params.height)) {
        return;
    }

    let wi = -d;
    let e = eval_bsdf(m, base, s.n, wo, wi);
    let cos_in = dot(s.n, wi);
    if (e.pdf <= 0.0 || cos_in <= 0.0) {
        return;
    }

    let origin = offset(s, wo);
    if (occluded(origin, wo, dist - dot(origin - s.p, wo))) {
        return;
    }

    // The pixel's average radiance: the BSDF (without the photon's cosine,
    // which its spacing already holds), from the surface's area to the
    // solid angle at the camera, and from that to the pixel's area on the
    // film.
    let pixel_area = (4.0 * params.tan_half_fov * params.tan_half_fov * params.aspect) / f32(params.width * params.height);
    let value = beta * (e.f / cos_in) * dot(wo, s.ng) / (dist * dist * pixel_area * cos_film * cos_film * cos_film);

    if (!finite(value)) {
        return;
    }

    let index = (u32(py) * params.width + u32(px)) * 4u;
    let fixed = vec3u(min(value * SPLAT_SCALE + vec3f(rand(), rand(), rand()), vec3f(4e9)));
    atomicAdd(&splats[index], fixed.x);
    atomicAdd(&splats[index + 1u], fixed.y);
    atomicAdd(&splats[index + 2u], fixed.z);
}

// The photons each frame: one per sample, up to as many as photon mapping
// can store (Renderer's dispatch agrees).
fn photon_count() -> u32 {
    return min(params.width * params.height * params.samples_per_frame, PHOTON_CAPACITY);
}

// ---- Photon mapping ----
//
// Light tracing can't connect a surface to the camera through glass, so
// caustics seen through glass or water (a pool's floor through its water)
// are photon mapping's: light tracing's photons are also stored where
// they land, and photon_gather follows the camera through mirrors and
// glass to the first other surface and adds up the photons near it. The
// radius shrinks each frame, so the average converges, as progressive
// photon mapping does.

const PHOTON_TABLE = 1048576u;
const PHOTON_CAPACITY = 524288u;

fn photon_cell_hash(cell: vec3i) -> u32 {
    let c = bitcast<vec3u>(cell);
    return ((c.x * 73856093u) ^ (c.y * 19349663u) ^ (c.z * 83492791u)) & (PHOTON_TABLE - 1u);
}

// Stores a photon of power beta, which arrived along d at point p.
fn deposit(p: vec3f, d: vec3f, beta: vec3f) {
    let i = atomicAdd(&photon_heads[PHOTON_TABLE], 1u);
    if (i >= PHOTON_CAPACITY) {
        return;
    }
    let cell = vec3i(floor(p / params.photon_cell));
    let next = atomicExchange(&photon_heads[photon_cell_hash(cell)], i + 1u);
    photons[i * 3u] = vec4f(p, bitcast<f32>(next));
    photons[i * 3u + 1u] = vec4f(beta, 0.0);
    photons[i * 3u + 2u] = vec4f(-d, 0.0);
}

// The caustic light leaving surface s towards wo, from the photons within
// the radius: their power times the BSDF, over the disc's area. Photons
// must lie on the surface (not a thin wall's far side) and have come from
// its side.
fn gather(s: Surface, m: Material, base: vec3f, wo: vec3f) -> vec3f {

    let r = params.photon_radius;
    let r2 = r * r;
    let cell_size = params.photon_cell;
    let here = s.p / cell_size;
    let cell = vec3i(floor(here));
    // The cells are twice the radius, so the photons within it
    // are in this one or the neighbours on the nearer side each way.
    let side = vec3i(select(vec3i(-1), vec3i(1), fract(here) >= vec3f(0.5)));

    var sum = vec3f(0.0);
    var visited = 0u;
    for (var k = 0u; k < 8u; k++) {
        let c = cell + vec3i(i32(k & 1u), i32((k >> 1u) & 1u), i32((k >> 2u) & 1u)) * side;
        var index = atomicLoad(&photon_heads[photon_cell_hash(c)]);
        loop {
            if (index == 0u || visited >= 4096u) {
                break;
            }
            visited++;
            let at = photons[(index - 1u) * 3u];
            let offset = at.xyz - s.p;
            if (dot(offset, offset) < r2 && abs(dot(offset, s.ng)) < 0.25 * r) {
                let wi = photons[(index - 1u) * 3u + 2u].xyz;
                let cos_in = dot(s.n, wi);
                if (cos_in > 0.0 && dot(s.ng, wi) > 0.0) {
                    let e = eval_bsdf(m, base, s.n, wo, wi);
                    sum += photons[(index - 1u) * 3u + 1u].xyz * (e.f / cos_in);
                }
            }
            index = bitcast<u32>(at.w);
        }
    }

    return sum / (PI * r2);
}

// One path per pixel from the camera through mirrors and glass to the
// first other surface, adding the caustic light the photons there make
// to the average, once for each of the frame's samples. A surface the
// camera sees directly is light tracing's. Glass that splits colours is
// taken at its middle index here: the photons carry the colours.
@compute @workgroup_size(8, 8)
fn photon_gather(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let index = id.y * params.width + id.x;
    rng_state = pcg(index ^ pcg(params.sample_offset * 2654435769u + 4099u));

    let ray = camera_ray(vec2f(id.xy) + vec2f(rand(), rand()), true);
    var o = ray[0];
    var d = ray[1];
    var throughput = vec3f(1.0);

    for (var depth = 0u; depth < params.max_bounces; depth++) {

        let hit = trace(o, d, INF, false);
        if (hit.prim == NONE) {
            return;
        }

        let s = surface(o, d, hit);
        let m = materials[s.material];
        if (m.kind == LIGHT) {
            return;
        }

        let base = albedo(m, s.p, s.uv);

        if (!is_delta(m)) {
            if (depth > 0u) {
                let light = throughput * gather(s, m, base, -d);
                if (finite(light)) {
                    let l = luminance(light);
                    accum[index] += vec4f(light, l * l) * f32(params.samples_per_frame);
                }
            }
            return;
        }

        let bs = sample_bsdf(m, base, s, -d);
        if (!bs.ok) {
            return;
        }
        throughput *= bs.weight;
        o = offset(s, bs.wi);
        d = bs.wi;
    }
}

// One photon, of photon_count(): from a light chosen by power, through
// mirrors and glass, splatted where it first lands on anything else.
@compute @workgroup_size(64)
fn light_trace(@builtin(global_invocation_id) id: vec3u) {

    let photons = photon_count();
    if (id.x >= photons) {
        return;
    }

    rng_state = pcg(id.x ^ pcg(params.sample_offset * 2654435769u + 977u));

    // Choose a light: after a header, emitters holds each one's
    // cumulative chance, its primitive (NONE for the sun) and its chance,
    // then the spheres round the mirrors and glass to aim at.
    let header = emitters[0];
    let sources = bitcast<u32>(header.x);
    let targets = bitcast<u32>(header.y);
    let xi = rand();
    var k = 0u;
    loop {
        if (k + 1u >= sources || emitters[1u + k].x > xi) {
            break;
        }
        k++;
    }
    let entry = emitters[1u + k];
    let chance = entry.z;
    if (chance <= 0.0) {
        return;
    }
    let prim_index = bitcast<u32>(entry.y);
    let first_target = 1u + sources;

    var o: vec3f;
    var d: vec3f;
    var beta: vec3f;

    if (prim_index == NONE) {
        // The sun: from a direction within its disc, through a target's
        // circle facing that way, chosen by area, starting outside the
        // whole scene. Where circles overlap, light could have come
        // through any of them, so its weight is shared.
        d = -sample_cone(params.sun_dir, params.sun_omc);
        var pick = rand() * header.w / PI;
        var j = 0u;
        loop {
            let r = emitters[first_target + j].w;
            if (j + 1u >= targets || pick < r * r) {
                break;
            }
            pick -= r * r;
            j++;
        }
        let circle = emitters[first_target + j];
        let f = frame(d);
        let disk = concentric_disk() * circle.w;
        o = circle.xyz - d * header.z + f[0] * disk.x + f[1] * disk.y;
        var through = 1.0;
        for (var i = 0u; i < targets; i++) {
            let c = emitters[first_target + i];
            let q = o - c.xyz;
            let across = q - d * dot(q, d);
            through += select(0.0, 1.0, i != j && dot(across, across) < c.w * c.w);
        }
        let irradiance = params.sun_radiance * (2.0 * PI * params.sun_omc);
        beta = irradiance * header.w / (through * chance * f32(photons));
    }
    else {
        let prim = prims[prim_index];
        let m = materials[prim.material];
        var n: vec3f;
        var area: f32;
        var uv: vec2f;
        if (prim.kind == QUAD) {
            let a = rand();
            let b = rand();
            o = prim.p0.xyz + prim.p1.xyz * a + prim.p2.xyz * b;
            let c = cross(prim.p1.xyz, prim.p2.xyz);
            area = length(c);
            n = c / area;
            uv = vec2f(a, 1.0 - b);
        }
        else {
            let z = 1.0 - 2.0 * rand();
            let r = sqrt(max(0.0, 1.0 - z * z));
            let phi = 2.0 * PI * rand();
            n = vec3f(r * cos(phi), z, r * sin(phi));
            o = prim.p0.xyz + n * prim.p0.w;
            area = 4.0 * PI * prim.p0.w * prim.p0.w;
            uv = sphere_uv(n, prim);
        }
        // Aim at a sphere round some of the mirrors and glass, chosen by
        // the solid angle it covers: light that misses them all can't
        // reach them first, so can't make a caustic. The chance of a
        // direction is shared among every sphere's cone it's in.
        // Lambertian light carries power in proportion to cos(θ), which
        // the weight makes up for. From inside a sphere, any direction
        // will do, so cosine-weighted ones, which carry equal power.
        var cones = 0.0;
        var inside = false;
        for (var i = 0u; i < targets; i++) {
            let aim = emitters[first_target + i];
            let to = aim.xyz - o;
            let d2 = dot(to, to);
            inside = inside || d2 <= aim.w * aim.w;
            cones += sphere_omc(aim.w, max(d2, aim.w * aim.w));
        }
        if (!inside) {
            var pick = rand() * cones;
            var j = 0u;
            loop {
                let aim = emitters[first_target + j];
                let to = aim.xyz - o;
                let omc = sphere_omc(aim.w, dot(to, to));
                if (j + 1u >= targets || pick < omc) {
                    d = sample_cone(to / length(to), omc);
                    break;
                }
                pick -= omc;
                j++;
            }
            var within = 1.0;
            for (var i = 0u; i < targets; i++) {
                let aim = emitters[first_target + i];
                let to = aim.xyz - o;
                let omc = sphere_omc(aim.w, dot(to, to));
                within += select(0.0, 1.0, i != j && 1.0 - dot(d, to / length(to)) <= omc);
            }
            let cos_out = dot(d, n);
            if (cos_out <= 0.0) {
                return;
            }
            beta = emitted(m, uv) * (cos_out * area * 2.0 * PI * cones) / (within * chance * f32(photons));
        }
        else {
            d = cosine_hemisphere(n);
            beta = emitted(m, uv) * (PI * area) / (chance * f32(photons));
        }
        o += n * (1e-4 * max(1.0, max(abs(o.x), max(abs(o.y), abs(o.z)))));
    }

    var wavelength = 0.0;
    var bounces = 0u;
    // What's left of beta after the bounces, from 1: Russian roulette goes
    // by this, as beta is tiny, being shared among so many photons.
    var carried = vec3f(1.0);

    for (var depth = 0u; depth < params.max_bounces; depth++) {

        let hit = trace(o, d, INF, false);
        if (hit.prim == NONE) {
            return;
        }

        let s = surface(o, d, hit);
        let m = materials[s.material];
        if (m.kind == LIGHT) {
            return;
        }

        let base = albedo(m, s.p, s.uv);

        if (!is_delta(m)) {
            // Light straight from the lamp is the path tracer's; after
            // mirrors or glass, it's a caustic.
            if (bounces > 0u) {
                splat(s, m, base, d, beta * carried);
                deposit(s.p, d, beta * carried);
            }
            return;
        }

        let bs = sample_bsdf(dispersed(m, &wavelength, &carried, rand()), base, s, -d);
        if (!bs.ok) {
            return;
        }
        carried *= bs.weight;
        bounces++;
        o = offset(s, bs.wi);
        d = bs.wi;

        if (!roulette(&carried, depth)) {
            return;
        }
    }
}

// Adds each pixel's light from light tracing this frame to the average,
// once for each of the frame's samples, and clears it for the next. Its
// luminance squared goes in too, so the denoiser sees how much it varies.
@compute @workgroup_size(8, 8)
fn resolve_splats(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let index = id.y * params.width + id.x;
    let fixed = vec3f(f32(atomicExchange(&splats[index * 4u], 0u)), f32(atomicExchange(&splats[index * 4u + 1u], 0u)), f32(atomicExchange(&splats[index * 4u + 2u], 0u)));
    let light = fixed / SPLAT_SCALE;
    let l = luminance(light);
    accum[index] += vec4f(light, l * l) * f32(params.samples_per_frame);
}

fn finite(v: vec3f) -> bool {
    let bits = bitcast<vec3u>(v) & vec3u(0x7f800000u);
    return all(bits != vec3u(0x7f800000u));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let index = id.y * params.width + id.x;
    var sum = vec4f(0.0);
    var sum_albedo = vec3f(0.0);
    var sum_normal = vec4f(0.0);

    for (var k = 0u; k < params.samples_per_frame; k++) {

        rng_state = pcg(index ^ pcg(params.sample_offset + k));
        // In 32-bit fixed point, where 2654435769 is the golden ratio's
        // fractional part, so it stays exact however many samples.
        spectrum_u = f32((pcg(index * 7919u + 1u) + (params.sample_offset + k) * 2654435769u) >> 8u) * (1.0 / 16777216.0);

        var c: vec3f;
        g_albedo = vec3f(0.0);
        g_normal = vec4f(0.0);
        if (params.view == VIEW_COLOR) {
            c = radiance(vec2f(id.xy) + vec2f(rand(), rand()));
            let peak = max(c.x, max(c.y, c.z));
            if (params.firefly_clamp > 0.0 && peak > params.firefly_clamp) {
                c *= params.firefly_clamp / peak;
            }
        }
        else {
            c = inspect(vec2f(id.xy) + 0.5);
        }

        // A path whose weight overflowed is dropped, guides and all: one
        // NaN in a guide would spread through the denoiser.
        if (finite(c) && finite(g_albedo) && finite(g_normal.xyz) && finite(vec3f(g_normal.w))) {
            let l = luminance(c);
            sum += vec4f(c, l * l);
            sum_albedo += g_albedo;
            sum_normal += g_normal;
        }
    }

    if (params.sample_offset == 0u) {
        accum[index] = sum;
        guide_albedo[index] = vec4f(sum_albedo, 0.0);
        guide_normal[index] = sum_normal;
    }
    else {
        accum[index] += sum;
        guide_albedo[index] += vec4f(sum_albedo, 0.0);
        guide_normal[index] += sum_normal;
    }
}

fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
`;

/**
 * Denoises the average so far, in three entry points run in turn:
 * prepare, then atrous five times with steps 1, 2, 4, 8 and 16, then
 * compose.
 *
 * It's an edge-avoiding à-trous wavelet filter (Dammertz et al., 2010),
 * steered by an estimate of each pixel's noise as in SVGF (Schied et al.,
 * 2017). It filters the light arriving at each surface (the colour divided
 * by the albedo), so textures stay sharp, and only blends pixels whose
 * normals and distances match, so edges do too. Neighbours count less the
 * more their brightness differs, measured against the noise; as samples
 * build up the noise falls, the filter backs off, and the image converges
 * to the plain average.
 */
export const DENOISE_SHADER = PARAMS + /* wgsl */ `
struct Pass {
    step: u32, _p0: u32, _p1: u32, _p2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> pass_params: Pass;
@group(0) @binding(2) var<storage, read> accum: array<vec4f>;
@group(0) @binding(3) var<storage, read> guide_albedo: array<vec4f>;
@group(0) @binding(4) var<storage, read> guide_normal: array<vec4f>;
// Light at each surface (rgb) and the variance of its luminance (w).
@group(0) @binding(5) var<storage, read> light_in: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> light_out: array<vec4f>;

// The B3 spline's weights at offsets 0, 1 and 2.
const KERNEL = array<f32, 3>(0.375, 0.25, 0.0625);

fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn samples() -> f32 {
    return f32(max(params.total_samples, 1u));
}

fn albedo_at(i: u32) -> vec3f {
    return max(guide_albedo[i].rgb / samples(), vec3f(0.01));
}

// The average normal, and the average distance (0 where the sky was hit).
fn normal_at(i: u32) -> vec4f {
    let g = guide_normal[i];
    let n = select(vec3f(0.0), normalize(g.xyz), dot(g.xyz, g.xyz) > 0.0);
    return vec4f(n, g.w / samples());
}

fn light_at(i: u32) -> vec3f {
    return accum[i].rgb / samples() / albedo_at(i);
}

// How much a neighbour's guides let it count: alike normals and distances.
// Sky pixels only mix with each other.
fn similarity(p: vec4f, q: vec4f, step: f32) -> f32 {
    if (p.w <= 0.0 || q.w <= 0.0) {
        return select(0.0, 1.0, p.w <= 0.0 && q.w <= 0.0);
    }
    if (dot(p.xyz, p.xyz) == 0.0) {
        return 0.0;
    }
    let wn = pow(max(dot(p.xyz, q.xyz), 0.0), 64.0);
    let wz = exp(-abs(p.w - q.w) / (p.w * 0.02 * step + 1e-6));
    return wn * wz;
}

fn inside(x: i32, y: i32) -> bool {
    return x >= 0 && y >= 0 && x < i32(params.width) && y < i32(params.height);
}

@compute @workgroup_size(8, 8)
fn prepare(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let i = id.y * params.width + id.x;
    let n = samples();
    let light = light_at(i);
    let gp = normal_at(i);
    let a = luminance(albedo_at(i));

    var variance: f32;
    if (n >= 4.0) {
        // From the samples themselves: the variance of one sample's
        // luminance, over n for the variance of their mean, in the units
        // of light at the surface.
        let mean = luminance(accum[i].rgb) / n;
        let spread = max(accum[i].w / n - mean * mean, 0.0) * n / (n - 1.0);
        variance = spread / n / (a * a);
    }
    else {
        // Too few samples to tell: use how much alike neighbours differ.
        var sum = 0.0;
        var sum2 = 0.0;
        var weight = 0.0;
        for (var dy = -2; dy <= 2; dy++) {
            for (var dx = -2; dx <= 2; dx++) {
                let x = i32(id.x) + dx;
                let y = i32(id.y) + dy;
                if (!inside(x, y)) {
                    continue;
                }
                let j = u32(y) * params.width + u32(x);
                let w = similarity(gp, normal_at(j), 1.0);
                let l = luminance(light_at(j));
                sum += w * l;
                sum2 += w * l * l;
                weight += w;
            }
        }
        let mean = sum / max(weight, 1e-6);
        variance = max(sum2 / max(weight, 1e-6) - mean * mean, 0.0) + 0.01 * mean * mean;
    }

    light_out[i] = vec4f(light, variance);
}

@compute @workgroup_size(8, 8)
fn atrous(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let i = id.y * params.width + id.x;
    let step = i32(pass_params.step);
    let centre = light_in[i];
    let gp = normal_at(i);
    let lp = luminance(centre.rgb);

    // The noise, blurred over the nearest pixels: a pixel whose few
    // samples happened to agree (all dark, say) would otherwise seem
    // noiseless and refuse every neighbour, leaving a speck.
    var variance = 0.0;
    var variance_weight = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let x = i32(id.x) + dx;
            let y = i32(id.y) + dy;
            if (inside(x, y)) {
                let w = KERNEL[abs(dx)] * KERNEL[abs(dy)];
                variance += w * light_in[u32(y) * params.width + u32(x)].w;
                variance_weight += w;
            }
        }
    }
    let sigma = 4.0 * sqrt(variance / variance_weight) + 1e-4;

    var sum = vec3f(0.0);
    var sum_variance = 0.0;
    var weight = 0.0;

    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {

            let x = i32(id.x) + dx * step;
            let y = i32(id.y) + dy * step;
            if (!inside(x, y)) {
                continue;
            }

            let j = u32(y) * params.width + u32(x);
            let q = light_in[j];
            let w = KERNEL[abs(dx)] * KERNEL[abs(dy)] *
                similarity(gp, normal_at(j), f32(step)) *
                exp(-abs(lp - luminance(q.rgb)) / sigma);

            sum += w * q.rgb;
            sum_variance += w * w * q.w;
            weight += w;
        }
    }

    // The centre counts unless its normal is unknown, so check anyway.
    if (weight > 0.0) {
        light_out[i] = vec4f(sum / weight, sum_variance / (weight * weight));
    }
    else {
        light_out[i] = centre;
    }
}

@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {

    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let i = id.y * params.width + id.x;
    light_out[i] = vec4f(light_in[i].rgb * albedo_at(i), 0.0);
}
`;

/** Shows the accumulated image, averaged, exposed and tone mapped. */
export const DISPLAY_SHADER = PARAMS + /* wgsl */ `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> accum: array<vec4f>;
// The denoised average, when params.denoise is set.
@group(0) @binding(2) var<storage, read> denoised: array<vec4f>;

@vertex
fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    // One triangle that covers the screen.
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// Narkowicz's fit to the ACES filmic curve.
fn aces(x: vec3f) -> vec3f {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn to_srgb(c: vec3f) -> vec3f {
    let x = clamp(c, vec3f(0.0), vec3f(1.0));
    return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

@fragment
fn fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {

    let px = vec2u(pos.xy);
    if (params.total_samples == 0u || px.x >= params.width || px.y >= params.height) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let i = px.y * params.width + px.x;
    let c = accum[i].rgb / f32(params.total_samples);

    switch params.view {
        case 0u: {
            let shown = select(c, denoised[i].rgb, params.denoise != 0u);
            return vec4f(to_srgb(aces(shown * params.exposure)), 1.0);
        }
        case 1u: {
            return vec4f(to_srgb(c), 1.0);
        }
        case 2u: {
            return vec4f(c * 0.5 + 0.5, 1.0);
        }
        default: {
            // Nearer is brighter, halving at the focus distance.
            let g = select(1.0 / (1.0 + c.x / params.focus_distance), 0.0, c.x <= 0.0);
            return vec4f(vec3f(g), 1.0);
        }
    }
}
`;
