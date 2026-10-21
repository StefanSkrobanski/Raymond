import { test } from "node:test";
import assert from "node:assert/strict";
import { Box, Mat4, Material, Mesh, NONE, Quad, Scene, Sphere, Texture, Vec2, Vec3 } from "../../src/index.mjs";
import { assertClose, assertVecClose } from "./helpers.mjs";

// A 2 × 2 texture: red, green / blue, white.
const QUADRANTS = Texture.procedural(2, 2, (u, v) =>
    u < 0.5 ? (v < 0.5 ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1)) : (v < 0.5 ? new Vec3(0, 1, 0) : new Vec3(1, 1, 1)));

test("procedural textures store sRGB bytes, and sample back as linear light", () => {

    const grey = Texture.procedural(1, 1, () => new Vec3(0.2158605, 0.2158605, 0.2158605));
    assert.deepEqual([...grey.data], [128, 128, 128, 255], "linear 0.216 is sRGB 128");

    // At each pixel's centre, a sample is that pixel.
    assertVecClose(QUADRANTS.sample(0.25, 0.25), new Vec3(1, 0, 0), "top left");
    assertVecClose(QUADRANTS.sample(0.75, 0.25), new Vec3(0, 1, 0), "top right");
    assertVecClose(QUADRANTS.sample(0.25, 0.75), new Vec3(0, 0, 1), "bottom left");
});

test("samples blend the four nearest pixels and wrap round the edges", () => {

    // Halfway between red and green.
    assertVecClose(QUADRANTS.sample(0.5, 0.25), new Vec3(0.5, 0.5, 0));

    // At u = 0 the left edge blends with the right: red and green again.
    assertVecClose(QUADRANTS.sample(0.0, 0.25), new Vec3(0.5, 0.5, 0));
    assertVecClose(QUADRANTS.sample(1.25, -0.75), QUADRANTS.sample(0.25, 0.25), "repeats");
});

test("resizing keeps the picture", () => {

    const big = QUADRANTS.resized(8, 8);
    assert.equal(big.width, 8);
    assertVecClose(big.sample(0.1, 0.1), QUADRANTS.sample(0.1, 0.1), "", 0.01);
    assert.equal(QUADRANTS.resized(2, 2), QUADRANTS, "the same size is the same texture");
});

test("textures must have the pixels they say", () => {
    assert.throws(() => new Texture(2, 2, new Uint8Array(15)), RangeError);
    assert.throws(() => new Texture(0, 2, new Uint8Array(0)), RangeError);
});

test("withTexture keeps the material, adding the texture and its scale", () => {

    const plastic = Material.plastic(new Vec3(1, 0, 0), 0.3);
    const textured = plastic.withTexture(QUADRANTS, 4);

    assert.equal(textured.type, "plastic");
    assert.equal(textured.roughness, 0.3);
    assert.equal(textured.texture, QUADRANTS);
    assertVecClose(textured.color, new Vec3(1, 1, 1), "white, so the texture shows as it is");
    assert.deepEqual([textured.textureScale.x, textured.textureScale.y], [4, 4]);
    assert.equal(plastic.texture, null);
});

test("packed materials say which texture they use, shared between materials", () => {

    const a = Material.diffuse(new Vec3(1, 1, 1)).withTexture(QUADRANTS, new Vec2(2, 3));
    const b = Material.metal(new Vec3(1, 1, 1)).withTexture(QUADRANTS);
    const plain = Material.diffuse(new Vec3(1, 1, 1));
    const packed = new Scene().add(
        new Sphere(new Vec3(0, 0, 0), 1, a), new Sphere(new Vec3(3, 0, 0), 1, b), new Sphere(new Vec3(6, 0, 0), 1, plain)).pack();

    const f = new Float32Array(packed.materials), u = new Uint32Array(packed.materials);
    const at = (m) => packed.materialList.indexOf(m) * 24;

    assert.deepEqual(packed.textures, [QUADRANTS]);
    assert.equal(u[at(a) + 13], 0);
    assert.deepEqual([f[at(a) + 14], f[at(a) + 15]], [2, 3]);
    assert.equal(u[at(b) + 13], 0);
    assert.equal(u[at(plain) + 13], NONE);
});

test("a sphere's texture wraps it like a globe, and turns with it", () => {

    const scene = new Scene().add(new Sphere(new Vec3(0, 0, 0), 1, Material.diffuse(new Vec3(1, 1, 1))));
    const uvAt = (d) => scene.raycast(d.scale(5), d.negate()).uv;

    assertClose(uvAt(new Vec3(0, 1, 0)).y, 0, "north pole at the top", 1e-6);
    assertClose(uvAt(new Vec3(0, -1, 0)).y, 1, "south pole at the bottom", 1e-6);
    const equator = uvAt(new Vec3(1, 0, 0));
    assertClose(equator.x, 0, "+x is u = 0", 1e-6);
    assertClose(equator.y, 0.5, "on the equator", 1e-6);
    assertClose(uvAt(new Vec3(0, 0, -1)).x, 0.25, "a quarter turn on, towards -z", 1e-6);

    // Turned a quarter about y, +x on the globe now faces -z.
    const turned = new Scene().add(new Sphere(new Vec3(0, 0, 0), 1, Material.diffuse(new Vec3(1, 1, 1)), { rotation: Mat4.rotateY(Math.PI / 2) }));
    assertClose(turned.raycast(new Vec3(0, 0, -5), new Vec3(0, 0, 1)).uv.x, 0, "", 1e-6);
});

test("a quad's texture runs along u and up v", () => {

    // A wall: u to the right, v up.
    const scene = new Scene().add(new Quad(new Vec3(0, 0, 0), new Vec3(2, 0, 0), new Vec3(0, 1, 0), Material.diffuse(new Vec3(1, 1, 1))));
    const uv = scene.raycast(new Vec3(1.5, 0.25, 5), new Vec3(0, 0, -1)).uv;

    assertClose(uv.x, 0.75, "three quarters along", 1e-6);
    assertClose(uv.y, 0.75, "a quarter up is three quarters down the image", 1e-6);
});

test("a box's faces each show the texture, upright on the sides, by world size", () => {

    // A box 4 wide, 2 tall and 2 deep, turned a quarter, so it's 4 deep.
    const box = new Box(Mat4.rotateY(Math.PI / 2).multiplyMat4(Mat4.scale(2, 1, 1)), Material.diffuse(new Vec3(1, 1, 1)));
    const scene = new Scene().add(box);
    const uvAt = (origin, direction) => {
        const uv = scene.raycast(origin, direction).uv;
        return new Vec3(uv.x, uv.y, 0);
    };

    // On the front (+z), 2 wide: half a unit from the top left corner.
    assertVecClose(uvAt(new Vec3(-0.5, 0.5, 5), new Vec3(0, 0, -1)), new Vec3(0.5, 0.5, 0), "front", 1e-6);

    // On the right (+x), 4 wide: seen from outside, its left edge is at
    // z = 2, so z = 1.5 is half a unit in.
    assertVecClose(uvAt(new Vec3(5, 0.5, 1.5), new Vec3(-1, 0, 0)), new Vec3(0.5, 0.5, 0), "right", 1e-6);

    // On top, the image turns with the box: its u runs along the box's
    // own x axis, which now points along -z, from z = 2.
    assertVecClose(uvAt(new Vec3(-0.5, 5, 1.5), new Vec3(0, -1, 0)), new Vec3(0.5, 0.5, 0), "top", 1e-6);
});

test("triangles interpolate their vertices' texture coordinates", () => {

    const mesh = new Mesh(
        [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)], [0, 1, 2], Material.diffuse(new Vec3(1, 1, 1)),
        { shading: "flat", uvs: [new Vec2(0, 1), new Vec2(1, 1), new Vec2(0, 0)] });
    const packed = new Scene().add(mesh).pack();

    // A flat triangle with coordinates still gets a block, flagged as
    // having texture coordinates (2) but no normals (1).
    assert.equal(packed.attributes[3 * 4 + 3], 2);

    const uv = new Scene().add(mesh).raycast(new Vec3(0.25, 0.5, 5), new Vec3(0, 0, -1)).uv;
    assertClose(uv.x, 0.25, "u", 1e-6);
    assertClose(uv.y, 0.5, "v", 1e-6);
});

test("generated meshes come with texture coordinates", () => {

    const surface = Mesh.surface((u, v) => new Vec3(u, v, 0), 4, 2, Material.diffuse(new Vec3(1, 1, 1)));
    assert.equal(surface.uvs.length, surface.positions.length);
    surface.positions.forEach((p, i) => assertVecClose(new Vec3(surface.uvs[i].x, surface.uvs[i].y, 0), new Vec3(p.x, p.y, 0)));

    // A closed torus repeats its seam, with u = 1 beside u = 0.
    const torus = Mesh.torus(Material.diffuse(new Vec3(1, 1, 1)), { segments: 8, sides: 4 });
    assert.ok(torus.uvs.some((uv) => uv.x == 1) && torus.uvs.some((uv) => uv.x == 0));

    // A lathe shows textures upright: the profile's end at the top (v = 0).
    const cylinder = Mesh.lathe([new Vec2(1, 0), new Vec2(1, 2)], Material.diffuse(new Vec3(1, 1, 1)), { segments: 8 });
    cylinder.positions.forEach((p, i) => assertClose(cylinder.uvs[i].y, 1 - p.y / 2, "v down from the top", 1e-9));

    // Moving a mesh keeps its coordinates.
    assert.equal(torus.transformed(Mat4.translate(1, 2, 3)).uvs, torus.uvs);
    assert.throws(() => new Mesh([new Vec3(0, 0, 0)], [], Material.diffuse(new Vec3()), { uvs: [] }), RangeError);
});
