// The WGSL shaders, kept in a module (rather than .wgsl files) so they load
// with the library wherever it's served or bundled. Not part of the public
// API.
//
// Uniform layout, shared by all the shaders and written by Renderer: 12
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
    view: u32, _pad0: u32, _pad1: u32, _pad2: u32,
    width: u32, height: u32, sample_offset: u32, samples_per_frame: u32,
    total_samples: u32, exposure: f32, denoise: u32, _pad4: u32,
}

const VIEW_COLOR = 0u;
const VIEW_ALBEDO = 1u;
const VIEW_NORMAL = 2u;
const VIEW_DEPTH = 3u;
`;

/** Traces samplesPerFrame paths per pixel, adding them to the accumulation. */
export const TRACE_SHADER = PARAMS + /* wgsl */ `
const PI = 3.14159265358979;
const NONE = 0xffffffffu;
const T_MIN = 1e-4;
const INF = 1e30;

const SPHERE = 0u;
const QUAD = 1u;
const BOX = 2u;
const TRIANGLE = 3u;

const DIFFUSE = 0u;
const METAL = 1u;
const PLASTIC = 2u;
const GLASS = 3u;
const LIGHT = 4u;

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
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> prims: array<Primitive>;
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;
// Triangles' vertex normals and texture coordinates: see PackedScene.
@group(0) @binding(4) var<storage, read> attributes: array<vec4f>;
@group(0) @binding(5) var<storage, read> lights: array<u32>;
// Per pixel, summed over samples: the colour, with the luminance squared in
// w (for the noise estimate); and the denoiser's guides, the albedo and
// the normal (w: the distance) of the first surface that isn't a mirror.
@group(0) @binding(6) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> guide_albedo: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> guide_normal: array<vec4f>;
@group(0) @binding(9) var textures: texture_2d_array<f32>;
@group(0) @binding(10) var texture_sampler: sampler;

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

    // The texture coordinates follow Scene.raycast's: see Scene.#uv.
    switch p.kind {
        case 0u: {
            ng = normalize(point - p.p0.xyz);
            ns = ng;
            // Longitude and latitude on the globe.
            let z = cross(p.p1.xyz, p.p2.xyz);
            let u = atan2(-dot(ng, z), dot(ng, p.p1.xyz)) / (2.0 * PI);
            uv = vec2f(u - floor(u), acos(clamp(dot(ng, p.p2.xyz), -1.0, 1.0)) / PI);
        }
        case 1u: {
            ng = normalize(cross(p.p1.xyz, p.p2.xyz));
            ns = ng;
            uv = vec2f(hit.u, 1.0 - hit.v);
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
            }
            else if (a.y >= a.z) {
                ng = p.p1.xyz * sign(lp.y);
                uv = vec2f((1.0 + lp.x) * half.x, (1.0 + sign(lp.y) * lp.z) * half.z);
            }
            else {
                ng = p.p2.xyz * sign(lp.z);
                uv = vec2f((1.0 + sign(lp.z) * lp.x) * half.x, (1.0 - lp.y) * half.y);
            }
            ng = normalize(ng);
            ns = ng;
        }
        default: {
            ng = normalize(cross(p.p1.xyz - p.p0.xyz, p.p2.xyz - p.p0.xyz));
            ns = ng;
            uv = vec2f(hit.u, hit.v);
            if (p.attributes != NONE) {
                let w = 1.0 - hit.u - hit.v;
                let a0 = attributes[p.attributes];
                let a1 = attributes[p.attributes + 1u];
                let a2 = attributes[p.attributes + 2u];
                let vs = attributes[p.attributes + 3u];
                uv = vec2f(a0.w * w + a1.w * hit.u + a2.w * hit.v, vs.x * w + vs.y * hit.u + vs.z * hit.v);
                if (vs.w != 0.0) {
                    ns = normalize(a0.xyz * w + a1.xyz * hit.u + a2.xyz * hit.v);
                    if (dot(ns, ng) < 0.0) {
                        ns = -ns;
                    }
                }
            }
        }
    }

    let front = dot(ng, d) < 0.0;
    let flip = select(-1.0, 1.0, front);

    return Surface(point, ns * flip, ng * flip, front, p.material, p.light, p.kind, uv);
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

fn sky(d: vec3f) -> vec3f {
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
    if (m.texture != NONE) {
        c *= textureSampleLevel(textures, texture_sampler, uv * m.texture_scale, m.texture, 0.0).rgb;
    }
    return c;
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

fn light_choices() -> u32 {
    return params.light_count + select(0u, 1u, params.sun_on != 0u);
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

    if (pick == params.light_count) {
        let wi = sample_cone(params.sun_dir, params.sun_omc);
        return LightSample(wi, INF, params.sun_radiance, chance / (2.0 * PI * params.sun_omc));
    }

    let prim = prims[lights[pick]];
    let emission = materials[prim.material].emission;

    if (prim.kind == QUAD) {
        let q = prim.p0.xyz + prim.p1.xyz * rand() + prim.p2.xyz * rand();
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
        return LightSample(wi, dist, emission, chance * d2 / (cos_l * area));
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
    return LightSample(wi, dist, emission, chance / (2.0 * PI * omc));
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

    for (var depth = 0u; depth <= params.max_bounces; depth++) {

        let hit = trace(o, d, INF, false);

        if (hit.prim == NONE) {
            if (!guided) {
                g_albedo = throughput;
            }
            result += throughput * sky(d);
            if (in_sun(d)) {
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

        if (m.kind == LIGHT) {
            if (s.front) {
                var w = 1.0;
                if (!last_delta && s.light != NONE) {
                    w = power_heuristic(last_pdf, light_pdf(hit.prim, last_p, d, hit.t));
                }
                result += throughput * m.emission * w;
            }
            break;
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
                    result += throughput * e.f * ls.radiance * (power_heuristic(ls.pdf, e.pdf) / ls.pdf);
                }
            }
        }

        let bs = sample_bsdf(m, base, s, wo);
        if (!bs.ok) {
            break;
        }

        throughput *= bs.weight;
        last_pdf = bs.pdf;
        last_delta = bs.delta;
        last_p = s.p;
        o = offset(s, bs.wi);
        d = bs.wi;

        // Russian roulette: after a few bounces, end dim paths at random,
        // boosting the survivors to make up for them.
        if (depth >= 3u) {
            let survive = min(max(throughput.x, max(throughput.y, throughput.z)), 0.95);
            if (rand() >= survive) {
                break;
            }
            throughput /= survive;
        }
    }

    return result;
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
                return m.emission / max(max(m.emission.x, m.emission.y), max(m.emission.z, 1.0));
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
