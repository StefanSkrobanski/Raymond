// An environment map shared by the browser tests' fixture (in the page)
// and the tests (in Node), which work out the exact answers from it: a
// soft sky, brighter overhead, with a small bright sun to one side.

import { EnvironmentMap, Vec3 } from "../../src/index.mjs";

export const SUN = new Vec3(0.45, 0.6, -0.66).normalized();

export const ENVIRONMENT = EnvironmentMap.procedural(128, 64, (d) => {
    const near = d.dot(SUN);
    const sun = near > Math.cos(0.18) ? 40 * (near - Math.cos(0.18)) / (1 - Math.cos(0.18)) + 10 : 0;
    const sky = 0.2 + 0.6 * Math.max(d.y, 0);
    return new Vec3(sky * 0.6 + sun, sky * 0.8 + sun * 0.9, sky + sun * 0.7);
});

export const STRENGTH = 1.5;
export const ROTATION = 0.7;
