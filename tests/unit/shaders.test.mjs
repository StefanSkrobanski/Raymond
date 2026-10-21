import { test } from "node:test";
import assert from "node:assert/strict";
import { BVH, MATERIAL_TYPES, PRIMITIVE_KINDS } from "../../src/index.mjs";
import { DENOISE_SHADER, DISPLAY_SHADER, TRACE_SHADER } from "../../src/shaders.mjs";

// WGSL's sizes and alignments for the types the shaders' structs use.
const TYPES = {
    f32: { size: 4, align: 4 },
    u32: { size: 4, align: 4 },
    vec2f: { size: 8, align: 8 },
    vec3f: { size: 12, align: 16 },
    vec4f: { size: 16, align: 16 },
};

// Lays out a struct from the shader source as WGSL does, returning its
// size and each field's byte offset.
function layout(source, name) {

    const body = source.match(new RegExp(`struct ${name} \\{([^}]*)\\}`))[1]
        .replace(/\/\/.*$/gm, "");

    const offsets = {};
    let offset = 0;
    let align = 0;

    for (const [, field, type] of body.matchAll(/(\w+)\s*:\s*(\w+)/g)) {
        const t = TYPES[type];
        assert.ok(t, `type ${type} is known`);
        offset = Math.ceil(offset / t.align) * t.align;
        offsets[field] = offset;
        offset += t.size;
        align = Math.max(align, t.align);
    }

    return { size: Math.ceil(offset / align) * align, offsets };
}

test("the packed records are the sizes the shader expects", () => {

    assert.equal(layout(TRACE_SHADER, "Primitive").size, 64, "Scene packs primitives in 64 bytes");
    assert.equal(layout(TRACE_SHADER, "Material").size, 96, "and materials in 96");

    // Where Scene.#pack writes each of a material's fields, in floats.
    const material = layout(TRACE_SHADER, "Material").offsets;
    const written = {
        color: 0, kind: 3, emission: 4, roughness: 7, checker: 8, checker_size: 11, ior: 12, texture: 13,
        texture_scale: 14, normal_map: 16, normal_scale: 17, emission_texture: 18, dispersion: 19,
        density: 20, anisotropy: 21,
    };
    for (const [field, index] of Object.entries(written))
        assert.equal(material[field], index * 4, field);
    assert.equal(layout(TRACE_SHADER, "Node").size, BVH.NODE_BYTES);
});

test("Renderer writes each uniform where the shader reads it", () => {

    const { size, offsets } = layout(TRACE_SHADER, "Params");

    assert.equal(size, 192);
    assert.deepEqual(layout(DISPLAY_SHADER, "Params"), { size, offsets }, "the shaders agree");
    assert.deepEqual(layout(DENOISE_SHADER, "Params"), { size, offsets }, "the shaders agree");

    // The float or u32 index Renderer.#writeParams uses for each field.
    const written = {
        cam_pos: 0, lens_radius: 3, cam_right: 4, tan_half_fov: 7, cam_up: 8, focus_distance: 11,
        cam_forward: 12, aspect: 15, sky_zenith: 16, sun_omc: 19, sky_horizon: 20, sun_on: 23,
        sky_ground: 24, firefly_clamp: 27, sun_dir: 28, light_count: 31, sun_radiance: 32, max_bounces: 35,
        view: 36, volume_count: 37, env_strength: 38, env_rotation: 39, width: 40, height: 41, sample_offset: 42, samples_per_frame: 43, total_samples: 44, exposure: 45, denoise: 46,
    };

    for (const [field, index] of Object.entries(written))
        assert.equal(offsets[field], index * 4, field);

    // Everything that changes the image comes before the 168 bytes that
    // decide whether to start again; the per-frame fields come after.
    for (const field of ["view", "volume_count", "env_strength", "env_rotation", "width", "height", "max_bounces", "firefly_clamp", "lens_radius"])
        assert.ok(offsets[field] < 168, `${field} restarts the image`);
    for (const field of ["sample_offset", "samples_per_frame", "total_samples", "exposure", "denoise"])
        assert.ok(offsets[field] >= 168, `${field} doesn't`);
});

test("the shader's codes match the library's", () => {

    const code = (name) => Number(TRACE_SHADER.match(new RegExp(`const ${name} = (\\d+)u;`))[1]);

    for (const [type, value] of Object.entries(MATERIAL_TYPES))
        assert.equal(code(type.toUpperCase()), value, type);

    for (const [kind, value] of Object.entries(PRIMITIVE_KINDS))
        assert.equal(code(kind.toUpperCase()), value, kind);
});
