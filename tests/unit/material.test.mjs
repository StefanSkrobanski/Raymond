import { test } from "node:test";
import assert from "node:assert/strict";
import { Material, Sky, Vec3, hexColor } from "../../src/index.mjs";
import { assertClose, assertVecClose } from "./helpers.mjs";

test("hexColor converts sRGB to linear light", () => {

    assertVecClose(hexColor("#ffffff"), new Vec3(1, 1, 1));
    assertVecClose(hexColor("#000"), new Vec3(0, 0, 0));
    // sRGB 50% grey is about 21% in linear light.
    assertClose(hexColor("#808080").x, 0.2158605, "mid grey", 1e-6);
    assertVecClose(hexColor("f00"), new Vec3(1, 0, 0), "without the #");

    assert.throws(() => hexColor("#12345"), RangeError);
    assert.throws(() => hexColor("red"), RangeError);
});

test("the factories make each type", () => {

    const color = new Vec3(0.5, 0.25, 1);

    assert.equal(Material.diffuse(color).type, "diffuse");
    assert.equal(Material.metal(color, 0.3).roughness, 0.3);
    assert.equal(Material.plastic(color).type, "plastic");
    assert.equal(Material.glass(1.33).ior, 1.33);

    const lamp = Material.light(color, 4);
    assert.equal(lamp.emissive, true);
    assertVecClose(lamp.emission, new Vec3(2, 1, 4));

    const checker = Material.checkered(color, new Vec3(0, 0, 0), 0.5);
    assert.equal(checker.checkerSize, 0.5);
    assert.equal(Material.diffuse(color).checker, null);
});

test("materials keep their values in range", () => {

    assert.equal(Material.metal(new Vec3(), 3).roughness, 1);
    assert.equal(Material.metal(new Vec3(), -1).roughness, 0);
    assert.equal(Material.glass(0.5).ior, 1);
    assert.equal(Material.light(new Vec3(1, 1, 1), 0).emissive, false);
    assert.throws(() => new Material({ type: /** @type {any} */ ("chrome") }), RangeError);
});

test("the sun's radiance over its disc adds up to its strength", () => {

    for (const size of [0.01, 0.05, 0.3]) {

        const sky = new Sky({ sunStrength: 3, sunColor: new Vec3(1, 0.5, 0.25), sunSize: size });

        // The light falling on a surface facing the sun: radiance times
        // the disc's projected solid angle, pi sin^2(size).
        const irradiance = sky.sunRadiance.scale(Math.PI * Math.sin(size) ** 2);
        const expected = 3 * (1 + Math.cos(size)) / 2;

        assertClose(irradiance.x, expected, `size ${size}`, 1e-9);
        assertClose(irradiance.y, expected * 0.5, `size ${size}`, 1e-9);
    }
});

test("sky directions are normalised, and with() changes only what it's given", () => {

    const sky = new Sky({ sunDirection: new Vec3(0, 10, 0), sunStrength: 2 });
    assertVecClose(sky.sunDirection, new Vec3(0, 1, 0));

    const dimmer = sky.with({ sunStrength: 1 });
    assert.equal(dimmer.sunStrength, 1);
    assert.equal(dimmer.zenith, sky.zenith);
    assertVecClose(dimmer.sunDirection, sky.sunDirection);

    const black = Sky.black();
    assertVecClose(black.horizon, new Vec3(0, 0, 0));
    assert.equal(black.sunStrength, 0);
});
