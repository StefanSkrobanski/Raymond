import { Vec2 } from "./Vec2.mjs";
import { Vec3 } from "./Vec3.mjs";
/** @import { Camera } from "./Camera.mjs" */

/**
 * A view the camera orbits from: a distance (radius) from the orbit point,
 * an inclination down from straight above (0 is overhead, pi / 2 is level)
 * and an azimuth around the vertical axis (-pi / 2 looks along +z).
 * @typedef {object} OrbitView
 * @property {Vec3} orbitPoint
 * @property {number} radius
 * @property {number} inclination
 * @property {number} azimuth
 */

/**
 * Orbits a camera around a point, driven by pointer events on a canvas, so
 * the same handlers serve mouse, touch and pen:
 *   - one pointer drags to orbit, and keeps spinning briefly when released
 *   - two pointers pinch to zoom and drag together to pan
 *   - right- or middle-drag (or shift-drag) with a mouse also pans
 *   - the mouse wheel zooms
 *   - a double tap or double click animates back to the home view
 *
 * It sets the camera's position and target, and fires "change" whenever it
 * moves the camera, and "tap" (a CustomEvent whose detail is { x, y }, in
 * CSS pixels from the element's top left) for a tap or click that isn't a
 * drag. Adapted from Styx's CameraTool.
 *
 * The home view is where the camera starts. Give the canvas the CSS
 * touch-action: none, so touch gestures don't scroll or zoom the page.
 */
export class OrbitControls extends EventTarget {

    #camera
    #canvas

    #mouse_sensitivity = 0.005;

    #orbit_point = new Vec3(0.0, 0.0, 0.0);
    #radius = 10.0;
    #inclination = Math.PI / 2.0;
    #azimuth = -Math.PI / 2.0;

    // The home view, restored by a double tap.
    /** @type {OrbitView} */
    #home

    // Removes the event listeners.
    #listeners = new AbortController();

    // Active pointers on the canvas.
    /** @type {Map<number, { position: Vec2, start: Vec2, start_time: number }>} */
    #pointers = new Map();
    #pinch_distance = 0.0;
    #pinch_centre = new Vec2(0.0, 0.0);
    #pan_with_one_pointer = false;

    // Whether the current gesture could still be a tap, and the last tap.
    #tap_candidate = false;
    /** @type {{ time: number, position: Vec2 } | null} */
    #last_tap = null;

    // Orbit speed in radians per millisecond (x: azimuth, y: inclination),
    // carried on as momentum after a flick.
    #velocity = new Vec2(0.0, 0.0);
    #last_move_time = 0.0;
    #last_move_interval = 0.0;

    // State of the momentum or reset animation, if one is running.
    #animation_frame = 0;
    #last_frame_time = 0.0;
    /** @type {{ start_time: number, from: OrbitView, to: OrbitView } | null} */
    #reset_animation = null;

    /**
     * @param {Camera} camera the camera to move
     * @param {HTMLElement} canvas the element to listen to
     * @param {Partial<OrbitView>} [home] the home view; anything left out
     *     keeps its default (the origin, 10, pi / 2 and -pi / 2)
     */
    constructor(camera, canvas, home = {}) {

        super();

        this.#camera = camera;
        this.#canvas = canvas;

        this.#home = {
            orbitPoint: this.#orbit_point,
            radius: this.#radius,
            inclination: this.#inclination,
            azimuth: this.#azimuth,
            ...home,
        };

        this.#orbit_point = this.#home.orbitPoint;
        this.#radius = this.#home.radius;
        this.#inclination = this.#home.inclination;
        this.#azimuth = this.#home.azimuth;

        const signal = this.#listeners.signal;

        canvas.addEventListener("pointerdown", (e) => this.#onPointerDown(e), { signal });
        canvas.addEventListener("pointermove", (e) => this.#onPointerMove(e), { signal });
        canvas.addEventListener("pointerup", (e) => this.#onPointerUp(e), { signal });
        canvas.addEventListener("pointercancel", (e) => this.#onPointerUp(e), { signal });

        // Not passive, so preventDefault() can stop the page scrolling.
        canvas.addEventListener("wheel", (e) => this.#onWheel(e), { passive: false, signal });

        // Right-drag pans, so don't open the context menu.
        canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });

        this.#updateCamera();
    }

    /** The distance from the camera to the orbit point. */
    get radius() {
        return this.#radius;
    }

    set radius(value) {
        this.#radius = value;
        this.#updateCamera();
    }

    /** The current view. */
    get view() {
        return {
            orbitPoint: this.#orbit_point,
            radius: this.#radius,
            inclination: this.#inclination,
            azimuth: this.#azimuth,
        };
    }

    /**
     * Changes any of the home view's settings and goes there: at once, or
     * with animate, by animating.
     * @param {Partial<OrbitView>} home
     * @param {{ animate?: boolean }} [options]
     */
    setHome(home, { animate = true } = {}) {

        this.#home = { ...this.#home, ...home };

        if (animate) {
            this.reset();
        }
        else {
            this.#stopAnimation();
            this.#velocity = new Vec2(0.0, 0.0);
            this.#orbit_point = this.#home.orbitPoint;
            this.#radius = this.#home.radius;
            this.#inclination = this.#home.inclination;
            this.#azimuth = this.#home.azimuth;
            this.#updateCamera();
        }
    }

    /**
     * The orbit view that looks from position at target.
     * @param {Vec3} position
     * @param {Vec3} target
     * @returns {OrbitView}
     */
    static viewFrom(position, target) {

        const offset = position.subtract(target);
        const radius = offset.length();

        return {
            orbitPoint: target,
            radius,
            inclination: Math.acos(Math.min(Math.max(offset.y / radius, -1.0), 1.0)),
            azimuth: Math.atan2(offset.z, offset.x),
        };
    }

    /** Animates back to the home view. */
    reset() {

        const home = this.#home;

        // Turn the shortest way round rather than unwinding full turns.
        const turns = Math.round((this.#azimuth - home.azimuth) / (2.0 * Math.PI));

        this.#velocity = new Vec2(0.0, 0.0);

        this.#reset_animation = {
            start_time: performance.now(),
            from: {
                orbitPoint: this.#orbit_point,
                radius: this.#radius,
                inclination: this.#inclination,
                azimuth: this.#azimuth,
            },
            to: {
                orbitPoint: home.orbitPoint,
                radius: home.radius,
                inclination: home.inclination,
                azimuth: home.azimuth + turns * 2.0 * Math.PI,
            },
        };

        this.#startAnimation();
    }

    /**
     * Stops listening to the canvas and stops any animation, for when the
     * camera tool is no longer needed.
     */
    dispose() {
        this.#listeners.abort();
        this.#stopAnimation();
        this.#pointers.clear();
    }

    /** @param {PointerEvent} e */
    #onPointerDown(e) {

        // Keep receiving this pointer's events if it leaves the canvas.
        this.#canvas.setPointerCapture(e.pointerId);

        // Touching the canvas stops any momentum or reset in progress.
        this.#stopAnimation();
        this.#velocity = new Vec2(0.0, 0.0);
        this.#last_move_time = 0.0;
        this.#last_move_interval = 0.0;

        const position = new Vec2(e.clientX, e.clientY);

        this.#pointers.set(e.pointerId, {
            position: position,
            start: position,
            start_time: e.timeStamp,
        });

        if (this.#pointers.size == 1) {

            this.#tap_candidate = true;

            this.#pan_with_one_pointer =
                e.pointerType == "mouse" && (e.button == 1 || e.button == 2 || e.shiftKey);
        }
        else {

            this.#tap_candidate = false;
            this.#startPinch();
        }
    }

    /** @param {PointerEvent} e */
    #onPointerMove(e) {

        const pointer = this.#pointers.get(e.pointerId);

        if (pointer === undefined) {
            return;
        }

        const previous = pointer.position;
        const point = new Vec2(e.clientX, e.clientY);

        pointer.position = point;

        // Moving more than a few pixels turns a tap into a drag.
        if (Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 10.0) {
            this.#tap_candidate = false;
        }

        if (this.#pointers.size == 1) {

            const delta_x = point.x - previous.x;
            const delta_y = point.y - previous.y;

            if (this.#pan_with_one_pointer) {
                this.#pan(delta_x, delta_y);
            }
            else {
                this.#orbit(-delta_x * this.#mouse_sensitivity, delta_y * this.#mouse_sensitivity);
                this.#trackVelocity(e.timeStamp, -delta_x, delta_y);
            }
        }
        else if (this.#pointers.size == 2) {

            const distance = this.#pinchDistance();
            const centre = this.#pinchCentre();

            // Fingers apart -> zoom in, together -> zoom out.
            if (distance > 0.0) {
                this.#radius *= this.#pinch_distance / distance;
            }

            this.#pan(
                centre.x - this.#pinch_centre.x,
                centre.y - this.#pinch_centre.y);

            this.#pinch_distance = distance;
            this.#pinch_centre = centre;
        }

        this.#updateCamera();
    }

    /** @param {PointerEvent} e */
    #onPointerUp(e) {

        const pointer = this.#pointers.get(e.pointerId);

        if (pointer === undefined) {
            return;
        }

        this.#pointers.delete(e.pointerId);

        if (this.#pointers.size == 0) {

            if (e.type == "pointerup" && this.#tap_candidate && e.timeStamp - pointer.start_time < 300.0) {
                this.#onTap(e.timeStamp, pointer.position);
            }
            else if (!this.#pan_with_one_pointer && this.#releasedWhileMoving(e.timeStamp)) {
                this.#startAnimation();
            }
        }
        else {

            // The remaining fingers carry on without a jump, but a lift
            // mid-gesture shouldn't fling the view.
            this.#velocity = new Vec2(0.0, 0.0);
            this.#last_move_time = 0.0;

            if (this.#pointers.size == 2) {
                this.#startPinch();
            }
        }
    }

    /**
     * @param {number} time
     * @param {Vec2} position
     */
    #onTap(time, position) {

        const last = this.#last_tap;

        if (last !== null &&
            time - last.time < 350.0 &&
            Math.hypot(position.x - last.position.x, position.y - last.position.y) < 30.0) {

            this.#last_tap = null;
            this.reset();
        }
        else {
            this.#last_tap = { time: time, position: position };

            const rect = this.#canvas.getBoundingClientRect();
            this.dispatchEvent(new CustomEvent("tap", {
                detail: { x: position.x - rect.left, y: position.y - rect.top },
            }));
        }
    }

    /** @param {WheelEvent} e */
    #onWheel(e) {

        e.preventDefault();

        this.#stopAnimation();

        if (e.deltaY > 0.0) {
            this.#radius *= 1.1;
        }
        else {
            this.#radius *= 0.9;
        }

        this.#updateCamera();
    }

    /**
     * @param {number} delta_azimuth
     * @param {number} delta_inclination
     */
    #orbit(delta_azimuth, delta_inclination) {

        this.#azimuth += delta_azimuth;
        this.#inclination += delta_inclination;

        // Short of straight up or down, where "up" would be ambiguous.
        this.#inclination = Math.min(Math.max(this.#inclination, 0.00001), Math.PI - 0.00001);
    }

    // Moves the orbit point so the scene follows a drag of (delta_x,
    // delta_y) CSS pixels, at the depth of the orbit point.
    /**
     * @param {number} delta_x
     * @param {number} delta_y
     */
    #pan(delta_x, delta_y) {

        // Size of one CSS pixel in world units at the orbit point.
        const world_per_pixel = 2.0 * this.#radius * Math.tan(this.#camera.fov / 2.0) /
            Math.max(this.#canvas.clientHeight, 1);

        const { right, up } = this.#camera.basis();

        const dx = -delta_x * world_per_pixel;
        const dy = delta_y * world_per_pixel;

        this.#orbit_point = new Vec3(
            this.#orbit_point.x + right.x * dx + up.x * dy,
            this.#orbit_point.y + right.y * dx + up.y * dy,
            this.#orbit_point.z + right.z * dx + up.z * dy);
    }

    // Smooths the orbit speed over recent moves, for momentum on release.
    /**
     * @param {number} time
     * @param {number} delta_x
     * @param {number} delta_y
     */
    #trackVelocity(time, delta_x, delta_y) {

        const dt = time - this.#last_move_time;

        if (this.#last_move_time > 0.0 && dt > 0.0) {

            this.#last_move_interval = dt;

            const vx = delta_x * this.#mouse_sensitivity / dt;
            const vy = delta_y * this.#mouse_sensitivity / dt;

            this.#velocity = new Vec2(
                0.6 * vx + 0.4 * this.#velocity.x,
                0.6 * vy + 0.4 * this.#velocity.y);
        }

        this.#last_move_time = time;
    }

    // A pointer still moving when lifted sends its last move shortly before
    // the release; one held still first doesn't. Allow for slow frames,
    // which space out the moves, so a flick isn't lost when busy.
    /** @param {number} time */
    #releasedWhileMoving(time) {

        if (this.#last_move_time == 0.0) {
            return false;
        }

        const allowed = Math.max(50.0, 1.5 * this.#last_move_interval);

        return time - this.#last_move_time < allowed;
    }

    #startPinch() {
        this.#pinch_distance = this.#pinchDistance();
        this.#pinch_centre = this.#pinchCentre();
    }

    #pinchDistance() {

        const [a, b] = this.#pointers.values();

        return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    }

    #pinchCentre() {

        const [a, b] = this.#pointers.values();

        return new Vec2(
            0.5 * (a.position.x + b.position.x),
            0.5 * (a.position.y + b.position.y));
    }

    #startAnimation() {

        if (this.#animation_frame == 0) {
            this.#last_frame_time = 0.0;
            this.#animation_frame = requestAnimationFrame(this.#animate.bind(this));
        }
    }

    #stopAnimation() {

        if (this.#animation_frame != 0) {
            cancelAnimationFrame(this.#animation_frame);
            this.#animation_frame = 0;
        }

        this.#reset_animation = null;
    }

    // One frame of the reset animation or of momentum.
    /** @param {number} time */
    #animate(time) {

        this.#animation_frame = 0;

        const dt = this.#last_frame_time > 0.0 ? Math.min(time - this.#last_frame_time, 100.0) : 16.0;
        this.#last_frame_time = time;

        let running;

        if (this.#reset_animation !== null) {

            const { start_time, from, to } = this.#reset_animation;

            const t = Math.min((time - start_time) / 400.0, 1.0);
            const ease = 1.0 - Math.pow(1.0 - t, 3.0);
            const lerp = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * ease;

            this.#orbit_point = new Vec3(
                lerp(from.orbitPoint.x, to.orbitPoint.x),
                lerp(from.orbitPoint.y, to.orbitPoint.y),
                lerp(from.orbitPoint.z, to.orbitPoint.z));
            this.#radius = lerp(from.radius, to.radius);
            this.#inclination = lerp(from.inclination, to.inclination);
            this.#azimuth = lerp(from.azimuth, to.azimuth);

            running = t < 1.0;

            if (!running) {
                this.#reset_animation = null;
            }
        }
        else {

            this.#orbit(this.#velocity.x * dt, this.#velocity.y * dt);

            // Slow down smoothly, and stop at the top or bottom.
            const decay = Math.exp(-dt / 325.0);
            const at_limit = this.#inclination <= 0.00001 || this.#inclination >= Math.PI - 0.00001;

            this.#velocity = new Vec2(
                this.#velocity.x * decay,
                at_limit ? 0.0 : this.#velocity.y * decay);

            running = Math.hypot(this.#velocity.x, this.#velocity.y) > 0.00002;
        }

        this.#updateCamera();

        if (running) {
            this.#startAnimation();
        }
    }

    #updateCamera() {

        const cos_inc = Math.cos(this.#inclination);
        const sin_inc = Math.sin(this.#inclination);
        const cos_az = Math.cos(this.#azimuth);
        const sin_az = Math.sin(this.#azimuth);

        const x = this.#radius * sin_inc * cos_az;
        const y = this.#radius * cos_inc;
        const z = this.#radius * sin_inc * sin_az;

        const look_at = this.#orbit_point;

        this.#camera.position = new Vec3(look_at.x + x, look_at.y + y, look_at.z + z);
        this.#camera.target = look_at;
        this.#camera.up = new Vec3(0.0, 1.0, 0.0);

        this.dispatchEvent(new Event("change"));
    }
}
