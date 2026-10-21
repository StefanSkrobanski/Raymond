// The catalogue of demo scenes. Each build function returns
// { scene, camera, bounces? }, where camera holds Camera options and
// bounces suggests a maxBounces for the scene. The settings panel lists
// these in order, grouped by category.

import { atom } from "./scenes/atom.mjs";
import { hotAirBalloons } from "./scenes/balloons.mjs";
import { billiards } from "./scenes/billiards.mjs";
import { sunbeams } from "./scenes/blinds.mjs";
import { toyBricks } from "./scenes/bricks.mjs";
import { bowling } from "./scenes/bowling.mjs";
import { chess } from "./scenes/chess.mjs";
import { candlelight } from "./scenes/candles.mjs";
import { coffeeCupCaustic } from "./scenes/caustic.mjs";
import { cityAtNight, tinyCity } from "./scenes/city.mjs";
import { cornellBox, cornellSpheres } from "./scenes/cornell.mjs";
import { crystalCave } from "./scenes/crystals.mjs";
import { newtonsCradle } from "./scenes/cradle.mjs";
import { dna } from "./scenes/dna.mjs";
import { dominoSpiral } from "./scenes/dominoes.mjs";
import { lowPolyForest, mistyForest } from "./scenes/forest.mjs";
import { textureGallery } from "./scenes/gallery.mjs";
import { gems } from "./scenes/gems.mjs";
import { glassGarden } from "./scenes/glass.mjs";
import { lighthouse } from "./scenes/lighthouse.mjs";
import { magnifyingGlass } from "./scenes/magnifier.mjs";
import { materialChart } from "./scenes/materials.mjs";
import { mengerScene } from "./scenes/menger.mjs";
import { hallOfMirrors } from "./scenes/mirrors.mjs";
import { neonNight } from "./scenes/neon.mjs";
import { pendulumWave } from "./scenes/pendulum.mjs";
import { swimmingPool } from "./scenes/pool.mjs";
import { pyramids } from "./scenes/pyramids.mjs";
import { rocketLaunch } from "./scenes/rocket.mjs";
import { rubik } from "./scenes/rubik.mjs";
import { seashells } from "./scenes/shells.mjs";
import { sierpinskiScene } from "./scenes/sierpinski.mjs";
import { snowman } from "./scenes/snowman.mjs";
import { solarSystem } from "./scenes/solar.mjs";
import { mirrorBall } from "./scenes/mirrorball.mjs";
import { prism } from "./scenes/prism.mjs";
import { alpineMeadow, studioShot, sunsetWater } from "./scenes/skies.mjs";
import { sphereflakeScene } from "./scenes/sphereflake.mjs";
import { sphereField } from "./scenes/spheres.mjs";
import { spiralStaircase } from "./scenes/staircase.mjs";
import { stillLife } from "./scenes/stilllife.mjs";
import { stonehenge } from "./scenes/stonehenge.mjs";
import { strangeSurfaces } from "./scenes/surfaces.mjs";
import { island } from "./scenes/terrain.mjs";
import { glassOfWater } from "./scenes/water.mjs";

/**
 * @typedef {object} Demo
 * @property {string} id the key saved in settings
 * @property {string} name shown in the scene picker
 * @property {string} category groups the scene picker
 * @property {() => { scene: import("./src/index.mjs").Scene, camera: import("./src/Camera.mjs").CameraOptions, bounces?: number }} build
 */

/** @type {Demo[]} */
export const SCENES = [
    { id: "cornell", name: "Cornell box", category: "Classics", build: cornellBox },
    { id: "cornell-spheres", name: "Cornell box: glass and mirror", category: "Classics", build: cornellSpheres },
    { id: "spheres", name: "Sphere field", category: "Classics", build: sphereField },
    { id: "materials", name: "Material chart", category: "Classics", build: materialChart },
    { id: "sphereflake", name: "Sphereflake", category: "Classics", build: sphereflakeScene },
    { id: "textures", name: "Texture gallery", category: "Classics", build: textureGallery },
    { id: "studio", name: "Studio: chrome and glass", category: "Classics", build: studioShot },
    { id: "glass", name: "Glass garden", category: "Light and glass", build: glassGarden },
    { id: "pool", name: "Swimming pool", category: "Light and glass", build: swimmingPool },
    { id: "gems", name: "Gems", category: "Light and glass", build: gems },
    { id: "mirrors", name: "Hall of mirrors", category: "Light and glass", build: hallOfMirrors },
    { id: "mirror-ball", name: "Inside a mirror ball", category: "Light and glass", build: mirrorBall },
    { id: "sunbeams", name: "Sunbeams", category: "Light and glass", build: sunbeams },
    { id: "neon", name: "Neon", category: "Light and glass", build: neonNight },
    { id: "crystals", name: "Crystal cave", category: "Light and glass", build: crystalCave },
    { id: "candles", name: "Candlelight", category: "Light and glass", build: candlelight },
    { id: "caustic", name: "Coffee cup caustic", category: "Light and glass", build: coffeeCupCaustic },
    { id: "magnifier", name: "Magnifying glass", category: "Light and glass", build: magnifyingGlass },
    { id: "water", name: "Glass of water", category: "Light and glass", build: glassOfWater },
    { id: "prism", name: "Prism", category: "Light and glass", build: prism },
    { id: "still-life", name: "Still life", category: "Objects", build: stillLife },
    { id: "cradle", name: "Newton's cradle", category: "Objects", build: newtonsCradle },
    { id: "chess", name: "Chess", category: "Objects", build: chess },
    { id: "bowling", name: "Bowling", category: "Objects", build: bowling },
    { id: "billiards", name: "Billiards", category: "Objects", build: billiards },
    { id: "rubik", name: "Rubik's cube", category: "Objects", build: rubik },
    { id: "bricks", name: "Toy bricks", category: "Objects", build: toyBricks },
    { id: "pendulum", name: "Pendulum wave", category: "Objects", build: pendulumWave },
    { id: "dominoes", name: "Domino spiral", category: "Objects", build: dominoSpiral },
    { id: "dna", name: "DNA", category: "Objects", build: dna },
    { id: "atom", name: "Atom", category: "Objects", build: atom },
    { id: "rocket", name: "Rocket launch", category: "Objects", build: rocketLaunch },
    { id: "island", name: "Island at sunset", category: "Places", build: island },
    { id: "alpine", name: "Alpine meadow", category: "Places", build: alpineMeadow },
    { id: "sunset-water", name: "Sunset on the water", category: "Places", build: sunsetWater },
    { id: "city", name: "Tiny city", category: "Places", build: tinyCity },
    { id: "city-night", name: "City at night", category: "Places", build: cityAtNight },
    { id: "solar", name: "Solar system", category: "Places", build: solarSystem },
    { id: "stonehenge", name: "Stonehenge", category: "Places", build: stonehenge },
    { id: "staircase", name: "Spiral staircase", category: "Places", build: spiralStaircase },
    { id: "forest", name: "Low-poly forest", category: "Places", build: lowPolyForest },
    { id: "misty-forest", name: "Misty forest", category: "Places", build: mistyForest },
    { id: "snowman", name: "Snowman", category: "Places", build: snowman },
    { id: "lighthouse", name: "Lighthouse", category: "Places", build: lighthouse },
    { id: "pyramids", name: "Pyramids", category: "Places", build: pyramids },
    { id: "balloons", name: "Hot-air balloons", category: "Places", build: hotAirBalloons },
    { id: "menger", name: "Menger sponge", category: "Maths", build: mengerScene },
    { id: "shells", name: "Seashells", category: "Maths", build: seashells },
    { id: "sierpinski", name: "Sierpinski tetrahedron", category: "Maths", build: sierpinskiScene },
    { id: "surfaces", name: "Strange surfaces", category: "Maths", build: strangeSurfaces },
];
