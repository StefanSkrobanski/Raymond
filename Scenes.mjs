// The catalogue of demo scenes. Each build function returns
// { scene, camera, bounces? }, where camera holds Camera options and
// bounces suggests a maxBounces for the scene. The settings panel lists
// these in order.

import { cornellBox, cornellSpheres } from "./scenes/cornell.mjs";
import { glassGarden } from "./scenes/glass.mjs";
import { materialChart } from "./scenes/materials.mjs";
import { mengerScene } from "./scenes/menger.mjs";
import { sphereField } from "./scenes/spheres.mjs";
import { island } from "./scenes/terrain.mjs";

/**
 * @typedef {object} Demo
 * @property {string} id the key saved in settings
 * @property {string} name shown in the scene picker
 * @property {() => { scene: import("./src/index.mjs").Scene, camera: import("./src/Camera.mjs").CameraOptions, bounces?: number }} build
 */

/** @type {Demo[]} */
export const SCENES = [
    { id: "cornell", name: "Cornell box", build: cornellBox },
    { id: "cornell-spheres", name: "Cornell box: glass and mirror", build: cornellSpheres },
    { id: "spheres", name: "Sphere field", build: sphereField },
    { id: "materials", name: "Material chart", build: materialChart },
    { id: "glass", name: "Glass garden", build: glassGarden },
    { id: "menger", name: "Menger sponge", build: mengerScene },
    { id: "island", name: "Island at sunset", build: island },
];
