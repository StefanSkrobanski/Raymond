import { Mat4, Material, Mesh, Quad, Scene, Sky, Vec3, hexColor } from "../src/index.mjs";

/** A Möbius strip: a band with a half twist, so it has only one side. */
export function mobius(material) {
    return Mesh.surface((u, v) => {
        const a = u * 2 * Math.PI, w = (v - 0.5) * 0.8;
        const r = 1 + (w / 2) * Math.cos(a / 2);
        return new Vec3(r * Math.cos(a), (w / 2) * Math.sin(a / 2), r * Math.sin(a));
    }, 160, 12, material);
}

/**
 * A Klein bottle, in the figure-eight immersion: a bottle whose neck passes
 * back through its side to join its own bottom, so it has no inside.
 */
export function kleinBottle(material) {
    return Mesh.surface((u, v) => {
        const a = u * 2 * Math.PI, b = v * 2 * Math.PI, r = 2;
        const w = r + Math.cos(a / 2) * Math.sin(b) - Math.sin(a / 2) * Math.sin(2 * b);
        return new Vec3(w * Math.cos(a), Math.sin(a / 2) * Math.sin(b) + Math.cos(a / 2) * Math.sin(2 * b), w * Math.sin(a)).scale(0.35);
    }, 160, 48, material, { vWrap: "closed" });
}

/** Dini's surface: a twisted pseudosphere, like a horn or a seashell. */
export function dini(material) {
    return Mesh.surface((u, v) => {
        const a = u * 4 * Math.PI, b = 0.08 + v * 1.9;
        return new Vec3(Math.cos(a) * Math.sin(b), Math.cos(b) + Math.log(Math.tan(b / 2)) + 0.18 * a, Math.sin(a) * Math.sin(b)).scale(0.45);
    }, 200, 48, material);
}

/** Three surfaces that bend the rules: a Möbius strip, a Klein bottle and Dini's surface, on plinths. */
export function strangeSurfaces() {

    const scene = new Scene({
        sky: new Sky({
            zenith: hexColor("#3a4a6a"),
            horizon: hexColor("#d8d8dc"),
            ground: hexColor("#2a2a30"),
            sunStrength: 2.5,
            sunDirection: new Vec3(-0.4, 0.75, 0.5),
            sunSize: 0.06,
        }),
    });

    scene.add(new Quad(new Vec3(-30, 0, 30), new Vec3(60, 0, 0), new Vec3(0, 0, -60), Material.plastic(hexColor("#e8e4dc"), 0.4)));

    scene.add(
        mobius(Material.plastic(hexColor("#e8524a"), 0.2)).transformed(Mat4.translate(-2.4, 0.95, 0).multiplyMat4(Mat4.rotateZ(0.5)).multiplyMat4(Mat4.rotateX(0.4))),
        kleinBottle(Material.plastic(hexColor("#4aa3e8"), 0.15)).transformed(Mat4.translate(0, 1.15, -0.4).multiplyMat4(Mat4.rotateX(-1.2))),
        dini(Material.metal(hexColor("#f0c060"), 0.2)).transformed(Mat4.translate(2.3, 0.75, 0.2).multiplyMat4(Mat4.rotateZ(-0.15))));

    return {
        scene,
        camera: {
            position: new Vec3(0.3, 2.6, 6.4),
            target: new Vec3(0, 0.9, 0),
            fov: 45 * Math.PI / 180,
        },
    };
}
