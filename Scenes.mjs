// The catalogue of demo scenes. Each build function returns
// { scene, camera, bounces? }, where camera holds Camera options and
// bounces suggests a maxBounces for the scene. The settings panel lists
// these in order.

import { sunbeams } from "./scenes/blinds.mjs";
import { tinyCity } from "./scenes/city.mjs";
import { cornellBox, cornellSpheres } from "./scenes/cornell.mjs";
import { newtonsCradle } from "./scenes/cradle.mjs";
import { dna } from "./scenes/dna.mjs";
import { gems } from "./scenes/gems.mjs";
import { glassGarden } from "./scenes/glass.mjs";
import { materialChart } from "./scenes/materials.mjs";
import { mengerScene } from "./scenes/menger.mjs";
import { hallOfMirrors } from "./scenes/mirrors.mjs";
import { neonNight } from "./scenes/neon.mjs";
import { swimmingPool } from "./scenes/pool.mjs";
import { seashells } from "./scenes/shells.mjs";
import { sphereField } from "./scenes/spheres.mjs";
import { stillLife } from "./scenes/stilllife.mjs";
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
    { id: "pool", name: "Swimming pool", build: swimmingPool },
    { id: "gems", name: "Gems", build: gems },
    { id: "still-life", name: "Still life", build: stillLife },
    { id: "cradle", name: "Newton's cradle", build: newtonsCradle },
    { id: "mirrors", name: "Hall of mirrors", build: hallOfMirrors },
    { id: "sunbeams", name: "Sunbeams", build: sunbeams },
    { id: "shells", name: "Seashells", build: seashells },
    { id: "neon", name: "Neon", build: neonNight },
    { id: "city", name: "Tiny city", build: tinyCity },
    { id: "dna", name: "DNA", build: dna },
];
