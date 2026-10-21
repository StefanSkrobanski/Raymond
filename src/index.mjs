// The public API. Mat2, Mat3 and the shaders are internal.

export { Vec2 } from "./Vec2.mjs";
export { Vec3 } from "./Vec3.mjs";
export { Vec4 } from "./Vec4.mjs";
export { Mat4 } from "./Mat4.mjs";

export { Material, MATERIAL_TYPES, hexColor } from "./Material.mjs";
export { Sphere } from "./Sphere.mjs";
export { Quad } from "./Quad.mjs";
export { Box } from "./Box.mjs";
export { Mesh } from "./Mesh.mjs";
export { Texture } from "./Texture.mjs";
export { EnvironmentMap } from "./EnvironmentMap.mjs";
export { Sky } from "./Sky.mjs";
export { Scene, PRIMITIVE_KINDS, NONE } from "./Scene.mjs";
export { BVH } from "./BVH.mjs";
export { Camera } from "./Camera.mjs";
export { OrbitControls } from "./OrbitControls.mjs";
export { Renderer } from "./Renderer.mjs";

// The types that appear in the API, for TypeScript users.
/** @typedef {import("./Renderer.mjs").View} View */
/** @typedef {import("./Camera.mjs").CameraOptions} CameraOptions */
/** @typedef {import("./Material.mjs").MaterialType} MaterialType */
/** @typedef {import("./Material.mjs").MaterialOptions} MaterialOptions */
/** @typedef {import("./Mesh.mjs").Shading} Shading */
/** @typedef {import("./Sky.mjs").SkyOptions} SkyOptions */
/** @typedef {import("./Scene.mjs").SceneObject} SceneObject */
/** @typedef {import("./Scene.mjs").Hit} Hit */
/** @typedef {import("./Scene.mjs").PackedScene} PackedScene */
/** @typedef {import("./OrbitControls.mjs").OrbitView} OrbitView */
