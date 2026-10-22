// What makes each of the later scenes correct, beyond the checks every
// scene gets in scenes.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Box, Material, Mesh, Sphere, Vec3 } from "../../src/index.mjs";
import { rack, BALL_RADIUS } from "../../scenes/billiards.mjs";
import { sunbeams } from "../../scenes/blinds.mjs";
import { pinSpots } from "../../scenes/bowling.mjs";
import { PIECES } from "../../scenes/chess.mjs";
import { cityAtNight, tinyCity } from "../../scenes/city.mjs";
import { COUNT, dominoLayout } from "../../scenes/dominoes.mjs";
import { mistyForest } from "../../scenes/forest.mjs";
import { lensProfile } from "../../scenes/magnifier.mjs";
import { SHELL_RADIUS, floatingSpheres, mirrorBall } from "../../scenes/mirrorball.mjs";
import { pendulums } from "../../scenes/pendulum.mjs";
import { prismMesh } from "../../scenes/prism.mjs";
import { rubiksCube } from "../../scenes/rubik.mjs";
import { sierpinskiScene } from "../../scenes/sierpinski.mjs";
import { BODY } from "../../scenes/snowman.mjs";
import { PLANETS } from "../../scenes/solar.mjs";
import { sphereflake } from "../../scenes/sphereflake.mjs";
import { stones } from "../../scenes/stonehenge.mjs";
import { TUMBLER, WATER } from "../../scenes/water.mjs";
import { mirrorDepth, wavyMirror } from "../../scenes/wavymirror.mjs";

const glass = Material.glass();

function signedVolume(mesh) {
    const { positions: p, indices: t } = mesh;
    let volume = 0;
    for (let i = 0; i < t.length; i += 3)
        volume += p[t[i]].dot(p[t[i + 1]].cross(p[t[i + 2]])) / 6;
    return volume;
}

test("the glass pieces, lens and tumbler are solids wound outwards", () => {

    const profiles = { ...PIECES, lens: lensProfile(0.5, 0.12), tumbler: TUMBLER, water: WATER };
    for (const [name, profile] of Object.entries(profiles))
        assert.ok(signedVolume(Mesh.lathe(profile, glass)) > 0, name);
});

test("the water fits inside the tumbler's walls", () => {

    // The inside wall runs from (0.188, 0.06) up to (0.225, 0.5).
    const inner = (y) => 0.188 + (0.225 - 0.188) * (y - 0.06) / (0.5 - 0.06);
    for (const p of WATER) {
        assert.ok(p.y > 0.06 && p.y < 0.5, "between the base and the rim");
        assert.ok(p.x < inner(p.y), `inside the wall at height ${p.y}`);
    }
});

test("the racked billiard balls sit on the cloth, touching but not overlapping", () => {

    const balls = rack();
    assert.equal(balls.length, 15);

    for (const [i, a] of balls.entries()) {
        assert.equal(a.y, BALL_RADIUS);
        const nearest = Math.min(...balls.filter((_, j) => j != i).map((b) => a.subtract(b).length()));
        assert.ok(Math.abs(nearest - 2 * BALL_RADIUS) < 1e-9, "each touches a neighbour");
    }
});

test("ten pins stand in a triangle, a row more each time", () => {

    const spots = pinSpots();
    assert.equal(spots.length, 10);

    const rows = new Map();
    for (const s of spots)
        rows.set(s.z.toFixed(6), (rows.get(s.z.toFixed(6)) ?? 0) + 1);
    assert.deepEqual([...rows.values()], [1, 2, 3, 4]);
});

test("the dominoes fall as one wave, from the outside in, without overlapping", () => {

    const layout = dominoLayout();
    assert.equal(layout.length, COUNT);

    // Standing ones first, then a wave that only ever leans further.
    for (let i = 1; i < layout.length; ++i)
        assert.ok(layout[i].tilt >= layout[i - 1].tilt);
    assert.equal(layout[0].tilt, 0);
    assert.ok(layout[layout.length - 1].tilt > 1);

    // Spaced further apart than they're thick.
    for (let i = 1; i < layout.length; ++i)
        assert.ok(layout[i].at.subtract(layout[i - 1].at).length() > 0.1);
});

test("the faster pendulums are shorter, and every bob hangs from its pivot", () => {

    const swings = pendulums();
    const lengths = swings.map(({ pivot, bob }) => pivot.subtract(bob).length());

    for (let n = 1; n < lengths.length; ++n)
        assert.ok(lengths[n] < lengths[n - 1]);
    for (const { pivot, bob } of swings)
        assert.ok(bob.y < pivot.y);

    // The first swings 25.5 times a minute: a pendulum of g / (2 pi f)^2.
    assert.ok(Math.abs(lengths[0] - 9.81 / (2 * Math.PI * 25.5 / 60) ** 2) < 1e-9);
});

test("the sphereflake has 9 children per sphere, each touching its parent", () => {

    const flake = sphereflake(new Vec3(0, 0, 0), 1, new Vec3(0, 1, 0), 3, glass);
    assert.equal(flake.length, 1 + 9 + 81 + 729);

    // The first level: a third the size, resting on the surface.
    for (const child of flake.slice(1, 1 + 9 + 81 + 729)) {
        if (Math.abs(child.radius - 1 / 3) > 1e-12)
            continue;
        assert.ok(Math.abs(child.center.length() - (1 + 1 / 3)) < 1e-12);
    }
    assert.equal(flake.filter((s) => s instanceof Sphere && Math.abs(s.radius - 1 / 3) < 1e-12).length, 9);
});

test("the Sierpinski tetrahedron stands on the floor, 4096 tetrahedra wound outwards", () => {

    const { scene } = sierpinskiScene();
    const shape = scene.objects.find((o) => o instanceof Mesh);

    assert.equal(shape.triangleCount, 4096 * 4);
    assert.ok(Math.abs(Math.min(...shape.positions.map((p) => p.y))) < 1e-9, "resting on y = 0");
    assert.ok(signedVolume(shape) > 0);
});

test("Stonehenge's stones stand on the ground", () => {

    for (const box of stones())
        assert.ok(Math.min(...box.corners().map((c) => c.y)) > -1e-9);
});

test("the planets go out in order, clear of the sun and each other", () => {

    for (let i = 0; i < PLANETS.length; ++i) {
        const p = PLANETS[i];
        assert.ok(p.distance - p.radius > 1.0, `${p.name} clear of the sun`);
        if (i > 0) {
            const q = PLANETS[i - 1];
            assert.ok(p.distance > q.distance);
            assert.ok(p.distance - p.radius > q.distance + q.radius, `${p.name} clear of ${q.name}`);
        }
    }
});

test("the Rubik's cube has 27 cubies and 54 stickers", () => {

    const boxes = rubiksCube();
    assert.equal(boxes.length, 27 + 54);
    assert.equal(new Set(boxes.map((b) => b.material)).size, 1 + 6, "a body colour and six sticker colours");
});

test("the snowman's balls are stacked, each resting on the one below", () => {

    for (let k = 1; k < BODY.length; ++k) {
        const below = BODY[k - 1], above = BODY[k];
        const gap = above.at.subtract(below.at).length() - (above.r + below.r);
        // Pressed a little into each other, as packed snow would be.
        assert.ok(gap < 0 && gap > -0.25 * above.r, `ball ${k} rests on ball ${k - 1}`);
    }
});

test("the prism is a triangular glass solid, wound outwards", () => {

    // An equilateral triangle in a circle of radius r has area 3√3/4 r².
    const r = 0.7, h = 2;
    const volume = signedVolume(prismMesh(glass, r, h));
    assert.ok(Math.abs(volume - 3 * Math.sqrt(3) / 4 * r * r * h) < 1e-9, `volume ${volume}`);
});

test("at night, the offices' windows and the streets glow, and by day nothing does", () => {

    const glowing = (scene) => scene.objects.filter((o) => o.material.glows && o.material.type != "light");

    assert.equal(glowing(tinyCity().scene).length, 0);

    const night = glowing(cityAtNight().scene);
    const offices = night.filter((o) => o instanceof Box);
    assert.ok(offices.length > 20, `${offices.length} offices lit`);
    assert.ok(offices.every((o) => o.material.emissionTexture == offices[0].material.emissionTexture));
    assert.equal(night.length - offices.length, 1, "and the streets");
});

// The corners of the box a volume fills.
const extent = (box) => {
    const corners = box.corners();
    return {
        min: new Vec3(Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.y)), Math.min(...corners.map((c) => c.z))),
        max: new Vec3(Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.z))),
    };
};

test("the haze fills the room with the sunbeams, and stays inside it", () => {

    const { scene, camera } = sunbeams();
    const [haze, ...others] = scene.objects.filter((o) => o.material.type == "volume");
    assert.equal(others.length, 0);

    // The room runs from -3 to 3 across and 0 to 3 up; outside, the sun
    // would light the haze without the blind's shadows.
    const { min, max } = extent(haze);
    assert.ok(min.x >= -3 && min.y >= 0 && min.z >= -3 && max.x <= 3 && max.y <= 3 && max.z <= 3);
    const p = camera.position;
    assert.ok(p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z, "the camera is in it");
});

test("the misty forest's mist lies over the whole forest, thickest low down", () => {

    const { scene, camera } = mistyForest();
    const mist = scene.objects.filter((o) => o.material.type == "volume");
    assert.equal(mist.length, 2);

    const [low, high] = mist.map(extent);
    assert.ok(low.max.y == high.min.y, "the layers meet");
    assert.ok(mist[0].material.density > mist[1].material.density);

    // Every tree stands within the mist's square.
    const trees = scene.objects.filter((o) => o instanceof Mesh && o.triangleCount < 200);
    assert.ok(trees.length > 100);
    for (const tree of trees) {
        const p = tree.positions[0];
        assert.ok(Math.abs(p.x) < low.max.x && Math.abs(p.z) < low.max.z);
    }
    assert.ok(camera.position.y < high.max.y, "the camera is in it");
});

test("inside the mirror ball, the spheres float near the middle, clear of each other and the camera, and their reflections too", () => {

    const spheres = floatingSpheres();
    const kinds = new Set(spheres.map((s) => s.material.type));
    for (const kind of ["light", "glass", "diffuse", "plastic", "metal"])
        assert.ok(kinds.has(kind), `a ${kind} sphere`);

    const { camera } = mirrorBall();
    const eye = camera.position;
    assert.ok(eye.length() < SHELL_RADIUS / 4, "the camera is well inside the mirror");

    for (const [i, a] of spheres.entries()) {
        // Well short of the focus, halfway out, where reflections are
        // magnified into smears.
        assert.ok(a.center.length() + a.radius < SHELL_RADIUS / 3, `sphere ${i} near the middle`);
        assert.ok(a.center.subtract(eye).length() > a.radius + 1, `sphere ${i} clear of the camera`);
        // Its reflection near the middle is upside down, opposite it
        // through the centre: kept away from the camera, where it'd loom.
        assert.ok(a.center.negate().subtract(eye).length() > 2.5, `sphere ${i}'s reflection clear of the camera`);
        for (const b of spheres.slice(i + 1))
            assert.ok(a.center.subtract(b.center).length() > a.radius + b.radius + 0.1, `sphere ${i} clear of the others`);
    }
});

test("the funhouse mirror's waves stay inside its frame, and it's smooth and polished", () => {

    // The frame is 0.4 deep, centred on the mirror's plane.
    for (let x = -2; x <= 2; x += 0.05)
        for (let y = 0.25; y <= 2.85; y += 0.05)
            assert.ok(Math.abs(mirrorDepth(x, y)) < 0.18, `${x}, ${y}`);

    const mirror = wavyMirror().scene.objects.find((o) => o instanceof Mesh && o.material.type == "metal");
    assert.ok(mirror, "a metal mesh");
    assert.ok(mirror.material.roughness < 0.01, "polished, so it reflects sharply");
    assert.ok(mirror.normals, "with smooth normals, so its reflections don't break into facets");
});
