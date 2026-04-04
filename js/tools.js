/*
    Tool Controller - Select, Move, Rotate, Scale tools
    Handles raycasting, gizmo rendering, and mouse-based object manipulation
*/

import { vec3, mat4, radToDeg, degToRad } from './math.js';

// Axis definitions
const AXES = {
    x: { index: 0, dir: vec3.create(1, 0, 0), color: [1.0, 0.3, 0.3], highlight: [1.0, 0.8, 0.2] },
    y: { index: 1, dir: vec3.create(0, 1, 0), color: [0.3, 1.0, 0.3], highlight: [1.0, 0.8, 0.2] },
    z: { index: 2, dir: vec3.create(0, 0, 1), color: [0.3, 0.5, 1.0], highlight: [1.0, 0.8, 0.2] }
};

const ARROW_LENGTH = 1.5;
const ARROW_HEAD = 0.2;
const RING_RADIUS = 1.5;
const RING_SEGMENTS = 64;
const HIT_THRESHOLD = 0.12;
// Finger-friendly tolerance. Relative to the (larger) mobile gizmo scale, so
// the absolute pickable radius ends up slightly smaller than the old 0.5 * 0.08
// while the visible arrows/rings are noticeably bigger.
const TOUCH_HIT_THRESHOLD = 0.3;

// Mobile viewports get longer gizmos and a thickening pass. Matches the CSS
// mobile breakpoint in style.css so the JS and layout agree on "mobile".
const GIZMO_SCALE_DESKTOP = 0.08;
const GIZMO_SCALE_MOBILE = 0.12;
// Half-extent (in drawing-buffer pixels) of the offset grid used to fake line
// thickness. Radius 1 → 3x3 grid → 3px thick lines. Copies are 1 buffer pixel
// apart so they merge into a solid line instead of reading as distinct arrows.
const GIZMO_THICKEN_RADIUS = 1;

export class ToolController {
    constructor(canvas, camera, scene, controls, ui) {
        this.canvas = canvas;
        this.camera = camera;
        this.scene = scene;
        this.controls = controls;
        this.ui = ui;

        this.currentTool = 'select';
        this.isDragging = false;
        this.activeAxis = null;
        this.hoveredAxis = null;

        // Drag state
        this.dragStartValue = 0;
        this.dragStartTransform = null;
        // Snapshot of the canvas rect at drag start. Mobile browsers (Chrome Android especially)
        // can toggle the URL bar mid-drag, which changes getBoundingClientRect() height between
        // touchmove events and causes the dragged object to flicker between two positions.
        this.dragStartRect = null;

        // Gizmo GPU resources (initialized lazily)
        this.glResources = null;

        // Temp vectors
        this._ray = { origin: vec3.create(), direction: vec3.create() };
        this._tmpVec = vec3.create();
        this._tmpVec2 = vec3.create();
        this._tmpMat = mat4.create();

        this.setupEventListeners();
    }

    setTool(tool) {
        this.currentTool = tool;
        this.hoveredAxis = null;
        if (!this.isDragging) {
            this.canvas.style.cursor = '';
        }
    }

    // ===== Event Listeners =====

    setupEventListeners() {
        // Store bound handlers for cleanup
        this._handlers = {
            mousedown: this.onMouseDown.bind(this),
            mousemove: this.onMouseMove.bind(this),
            mouseup: this.onMouseUp.bind(this),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this)
        };
        // Use capture phase so we fire before OrbitControls
        this.canvas.addEventListener('mousedown', this._handlers.mousedown, true);
        this.canvas.addEventListener('mousemove', this._handlers.mousemove, true);
        this.canvas.addEventListener('mouseup', this._handlers.mouseup, true);
        // Touch equivalents - capture + non-passive so we can preventDefault when grabbing a gizmo
        this.canvas.addEventListener('touchstart', this._handlers.touchstart, { capture: true, passive: false });
        this.canvas.addEventListener('touchmove', this._handlers.touchmove, { capture: true, passive: false });
        this.canvas.addEventListener('touchend', this._handlers.touchend, { capture: true, passive: false });
        this.canvas.addEventListener('touchcancel', this._handlers.touchend, { capture: true, passive: false });
    }

    dispose() {
        this.canvas.removeEventListener('mousedown', this._handlers.mousedown, true);
        this.canvas.removeEventListener('mousemove', this._handlers.mousemove, true);
        this.canvas.removeEventListener('mouseup', this._handlers.mouseup, true);
        this.canvas.removeEventListener('touchstart', this._handlers.touchstart, { capture: true });
        this.canvas.removeEventListener('touchmove', this._handlers.touchmove, { capture: true });
        this.canvas.removeEventListener('touchend', this._handlers.touchend, { capture: true });
        this.canvas.removeEventListener('touchcancel', this._handlers.touchend, { capture: true });
    }

    // Check if the current tool is allowed for the given entity
    isToolAllowed(entity) {
        if (!entity || !this.ui) return true;
        const disabled = this.ui.getDisabledControls(entity);
        return !disabled[this.currentTool];
    }

    onMouseDown(e) {
        if (e.button !== 0) return; // Only left click

        const ray = this.screenToRay(e.clientX, e.clientY);
        const entity = this.scene.selectedEntity;

        if (this.currentTool === 'select') {
            // Pick entity on click, let orbit proceed
            const hit = this.pickEntity(ray);
            if (hit) {
                this.scene.selectEntity(hit);
            }
            return;
        }

        // Move/Rotate/Scale tools
        if (entity && this.isToolAllowed(entity)) {
            const gizmoScale = this.getGizmoScale(entity);
            const axis = this.hitTestGizmoHandles(ray, entity.transform.position, gizmoScale);

            if (axis) {
                // Start gizmo drag
                e.stopPropagation();
                e.preventDefault();
                this.isDragging = true;
                this.activeAxis = axis;
                this.controls.enabled = false;
                this.canvas.style.cursor = 'grabbing';
                this.dragStartRect = this.canvas.getBoundingClientRect();

                // Snapshot transform for undo
                this.dragStartTransform = {
                    position: vec3.clone(entity.transform.position),
                    rotation: vec3.clone(entity.transform.rotation),
                    scale: vec3.clone(entity.transform.scale)
                };

                // Get initial projection value
                const axisDir = AXES[axis].dir;
                this.dragStartValue = this.projectMouseToAxis(ray, entity.transform.position, axisDir);
                return;
            }
        }

        // Didn't hit gizmo - try picking a new entity
        const hit = this.pickEntity(ray);
        if (hit) {
            this.scene.selectEntity(hit);
        }
        // Let orbit proceed (don't stopPropagation)
    }

    onMouseMove(e) {
        if (this.isDragging) {
            e.stopPropagation();
            e.preventDefault();
            this.handleDrag(e);
            return;
        }

        // Hover detection for gizmo handles
        if (this.currentTool !== 'select') {
            const entity = this.scene.selectedEntity;
            if (entity && this.isToolAllowed(entity)) {
                const ray = this.screenToRay(e.clientX, e.clientY);
                const gizmoScale = this.getGizmoScale(entity);
                const axis = this.hitTestGizmoHandles(ray, entity.transform.position, gizmoScale);
                if (axis !== this.hoveredAxis) {
                    this.hoveredAxis = axis;
                    this.canvas.style.cursor = axis ? 'grab' : '';
                }
            }
        }
    }

    // ===== Touch Handlers =====
    // Mirror the mouse flow: pick on tap, drag gizmo axes in move/rotate/scale.
    // Only single-finger touches are handled here; multi-touch passes through
    // to OrbitControls for pinch-zoom.

    onTouchStart(e) {
        if (e.touches.length !== 1) {
            // Multi-touch: cancel any in-progress gizmo drag and let orbit take over
            if (this.isDragging) this.endDrag();
            return;
        }

        const t = e.touches[0];
        const ray = this.screenToRay(t.clientX, t.clientY);
        const entity = this.scene.selectedEntity;

        if (this.currentTool === 'select') {
            const hit = this.pickEntity(ray);
            if (hit) this.scene.selectEntity(hit);
            return;
        }

        if (entity && this.isToolAllowed(entity)) {
            const gizmoScale = this.getGizmoScale(entity);
            const axis = this.hitTestGizmoHandles(ray, entity.transform.position, gizmoScale, TOUCH_HIT_THRESHOLD);

            if (axis) {
                e.stopPropagation();
                e.preventDefault();
                this.isDragging = true;
                this.activeAxis = axis;
                this.controls.enabled = false;
                this.dragStartRect = this.canvas.getBoundingClientRect();

                this.dragStartTransform = {
                    position: vec3.clone(entity.transform.position),
                    rotation: vec3.clone(entity.transform.rotation),
                    scale: vec3.clone(entity.transform.scale)
                };

                const axisDir = AXES[axis].dir;
                this.dragStartValue = this.projectMouseToAxis(ray, entity.transform.position, axisDir);
                return;
            }
        }

        const hit = this.pickEntity(ray);
        if (hit) this.scene.selectEntity(hit);
    }

    onTouchMove(e) {
        if (!this.isDragging) return;
        if (e.touches.length !== 1) {
            // Second finger arrived mid-drag: cancel gizmo drag
            this.endDrag();
            return;
        }

        e.stopPropagation();
        e.preventDefault();
        const t = e.touches[0];
        // handleDrag only needs clientX/Y from the event
        this.handleDrag({ clientX: t.clientX, clientY: t.clientY });
    }

    onTouchEnd(e) {
        if (!this.isDragging) return;
        e.stopPropagation();
        e.preventDefault();
        this.endDrag();
    }

    // Shared end-of-drag cleanup for mouse and touch, including undo snapshot push.
    endDrag() {
        this.isDragging = false;
        this.controls.enabled = true;
        this.canvas.style.cursor = '';
        this.dragStartRect = null;

        const entity = this.scene.selectedEntity;
        if (entity && this.dragStartTransform) {
            const before = this.dragStartTransform;
            const after = {
                position: vec3.clone(entity.transform.position),
                rotation: vec3.clone(entity.transform.rotation),
                scale: vec3.clone(entity.transform.scale)
            };

            const changed = before.position[0] !== after.position[0] ||
                before.position[1] !== after.position[1] ||
                before.position[2] !== after.position[2] ||
                before.rotation[0] !== after.rotation[0] ||
                before.rotation[1] !== after.rotation[1] ||
                before.rotation[2] !== after.rotation[2] ||
                before.scale[0] !== after.scale[0] ||
                before.scale[1] !== after.scale[1] ||
                before.scale[2] !== after.scale[2];

            if (changed) {
                this.ui.pushUndo({
                    type: 'transform',
                    entity,
                    before,
                    after
                });
            }
        }

        this.dragStartTransform = null;
        this.activeAxis = null;
    }

    onMouseUp(e) {
        if (!this.isDragging) return;

        e.stopPropagation();
        e.preventDefault();
        this.endDrag();
        this.canvas.style.cursor = this.hoveredAxis ? 'grab' : '';
    }

    handleDrag(e) {
        const entity = this.scene.selectedEntity;
        if (!entity || !this.activeAxis) return;

        const ray = this.screenToRay(e.clientX, e.clientY);
        const axisInfo = AXES[this.activeAxis];
        const axisDir = axisInfo.dir;
        const axisIndex = axisInfo.index;

        const currentValue = this.projectMouseToAxis(ray, entity.transform.position, axisDir);
        if (currentValue === null || this.dragStartValue === null) return;

        const delta = currentValue - this.dragStartValue;

        if (this.currentTool === 'move') {
            entity.transform.position[axisIndex] = this.dragStartTransform.position[axisIndex] + delta;
            entity.transform.dirty = true;
        } else if (this.currentTool === 'rotate') {
            // Convert mouse delta to rotation (scale for usability)
            entity.transform.rotation[axisIndex] = this.dragStartTransform.rotation[axisIndex] + delta * 0.8;
            entity.transform.dirty = true;
        } else if (this.currentTool === 'scale') {
            const startScale = this.dragStartTransform.scale[axisIndex];
            const factor = 1 + delta / (ARROW_LENGTH * this.getGizmoScale(entity));
            entity.transform.scale[axisIndex] = Math.max(0.01, startScale * factor);
            entity.transform.dirty = true;
        }

        // Update properties panel live
        this.updatePropertiesPanel(entity);
    }

    updatePropertiesPanel(entity) {
        // Update the vector input fields directly
        const inputs = document.querySelectorAll('.vector-input input');
        inputs.forEach(input => {
            const prop = input.dataset.prop;
            const axis = parseInt(input.dataset.axis);
            if (isNaN(axis)) return;

            if (prop === 'position') {
                input.value = entity.transform.position[axis].toFixed(1);
            } else if (prop === 'rotation') {
                input.value = radToDeg(entity.transform.rotation[axis]).toFixed(1);
            } else if (prop === 'scale') {
                input.value = entity.transform.scale[axis].toFixed(1);
            }
        });
    }

    // ===== Raycasting =====

    screenToRay(clientX, clientY) {
        // Use the snapshotted rect during drags so URL-bar show/hide on mobile can't shift the
        // projection between frames. Falls back to a fresh rect for hit-tests and hover.
        const rect = this.dragStartRect || this.canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

        const invVP = this._tmpMat;
        mat4.invert(invVP, this.camera.viewProjectionMatrix);

        const nearPoint = vec3.create(ndcX, ndcY, -1);
        const farPoint = vec3.create(ndcX, ndcY, 1);

        vec3.transformMat4(nearPoint, nearPoint, invVP);
        vec3.transformMat4(farPoint, farPoint, invVP);

        const direction = vec3.create();
        vec3.subtract(direction, farPoint, nearPoint);
        vec3.normalize(direction, direction);

        return { origin: nearPoint, direction };
    }

    // Ray-AABB intersection using slab method (local space)
    rayAABBIntersect(localOrigin, localDir, bmin, bmax) {
        let tmin = -Infinity, tmax = Infinity;
        for (let i = 0; i < 3; i++) {
            if (Math.abs(localDir[i]) < 0.00001) {
                if (localOrigin[i] < bmin[i] || localOrigin[i] > bmax[i]) return -1;
            } else {
                let t1 = (bmin[i] - localOrigin[i]) / localDir[i];
                let t2 = (bmax[i] - localOrigin[i]) / localDir[i];
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
            }
        }
        if (tmin > tmax || tmax < 0) return -1;
        return tmin > 0 ? tmin : tmax;
    }

    // Ray-sphere intersection (used for lights)
    raySphereIntersect(rayOrigin, rayDir, center, radius) {
        const oc = this._tmpVec;
        vec3.subtract(oc, rayOrigin, center);

        const a = vec3.dot(rayDir, rayDir);
        const b = 2 * vec3.dot(oc, rayDir);
        const c = vec3.dot(oc, oc) - radius * radius;
        const disc = b * b - 4 * a * c;

        if (disc < 0) return -1;

        const t = (-b - Math.sqrt(disc)) / (2 * a);
        return t > 0 ? t : -1;
    }

    pickEntity(ray) {
        let closest = null;
        let closestDist = Infinity;
        const invModel = mat4.create();
        const localOrigin = vec3.create();
        const localDir = vec3.create();

        // Local-space AABB: unit box for all geometry types
        const bmin = [-0.5, -0.5, -0.5];
        const bmax = [0.5, 0.5, 0.5];

        // Test scene objects using ray-AABB in local space
        for (const obj of this.scene.objects) {
            if (!obj.visible) continue;

            // Ensure model matrix is up to date
            obj.transform.updateMatrix();

            // Transform ray into object's local space
            mat4.invert(invModel, obj.transform.modelMatrix);
            vec3.transformMat4(localOrigin, ray.origin, invModel);
            // Transform direction (without translation)
            const ro = ray.origin;
            const rd = ray.direction;
            const farPt = vec3.create(ro[0] + rd[0], ro[1] + rd[1], ro[2] + rd[2]);
            vec3.transformMat4(localDir, farPt, invModel);
            vec3.subtract(localDir, localDir, localOrigin);
            vec3.normalize(localDir, localDir);

            const tLocal = this.rayAABBIntersect(localOrigin, localDir, bmin, bmax);
            if (tLocal < 0) continue;

            // Compute world-space hit point to get true distance
            const hitLocal = vec3.create(
                localOrigin[0] + localDir[0] * tLocal,
                localOrigin[1] + localDir[1] * tLocal,
                localOrigin[2] + localDir[2] * tLocal
            );
            const hitWorld = vec3.create();
            vec3.transformMat4(hitWorld, hitLocal, obj.transform.modelMatrix);
            const dist = vec3.distance(ray.origin, hitWorld);

            if (dist < closestDist) {
                closestDist = dist;
                closest = obj;
            }
        }

        // Test lights (point and spot only - directional has no meaningful position)
        for (const light of this.scene.lights) {
            if (!light.visible) continue;
            if (light.lightType === 'directional') continue;

            const pos = light.transform.position;
            const radius = 0.4;

            const t = this.raySphereIntersect(ray.origin, ray.direction, pos, radius);
            if (t > 0) {
                const dist = t; // Already world-space distance along ray
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = light;
                }
            }
        }

        return closest;
    }

    // ===== Gizmo Hit Testing =====

    isMobileViewport() {
        return window.matchMedia('(max-width: 900px)').matches;
    }

    getGizmoScale(entity) {
        const dist = vec3.distance(this.camera.position, entity.transform.position);
        const factor = this.isMobileViewport() ? GIZMO_SCALE_MOBILE : GIZMO_SCALE_DESKTOP;
        return dist * factor;
    }

    hitTestGizmoHandles(ray, center, gizmoScale, hitThreshold = HIT_THRESHOLD) {
        const threshold = gizmoScale * hitThreshold;
        let closestAxis = null;
        let closestDist = threshold;

        for (const [name, axis] of Object.entries(AXES)) {
            let dist;

            if (this.currentTool === 'rotate') {
                dist = this.rayRingDistance(ray, center, axis.dir, RING_RADIUS * gizmoScale);
            } else {
                // Move and scale: test against axis line
                const end = this._tmpVec2;
                vec3.scale(end, axis.dir, ARROW_LENGTH * gizmoScale);
                vec3.add(end, center, end);
                dist = this.raySegmentDistance(ray.origin, ray.direction, center, end);
            }

            if (dist < closestDist) {
                closestDist = dist;
                closestAxis = name;
            }
        }

        return closestAxis;
    }

    raySegmentDistance(rayOrigin, rayDir, segA, segB) {
        // Closest distance between a ray and a line segment
        const d = this._tmpVec;
        vec3.subtract(d, segB, segA);
        const w = vec3.create();
        vec3.subtract(w, rayOrigin, segA);

        const a = vec3.dot(rayDir, rayDir);
        const b = vec3.dot(rayDir, d);
        const c = vec3.dot(d, d);
        const dd = vec3.dot(rayDir, w);
        const e = vec3.dot(d, w);

        const denom = a * c - b * b;
        if (Math.abs(denom) < 0.0001) return Infinity;

        let s = (b * e - c * dd) / denom;
        let t = (a * e - b * dd) / denom;

        s = Math.max(0, s);
        t = Math.max(0, Math.min(1, t));

        // Closest points
        const p1 = vec3.create();
        vec3.scale(p1, rayDir, s);
        vec3.add(p1, rayOrigin, p1);

        const p2 = vec3.create();
        vec3.scale(p2, d, t);
        vec3.add(p2, segA, p2);

        return vec3.distance(p1, p2);
    }

    rayRingDistance(ray, center, normal, radius) {
        // Test if ray passes near the ring (circle in 3D)
        // Intersect ray with the ring's plane, then check distance from center
        const denom = vec3.dot(ray.direction, normal);
        if (Math.abs(denom) < 0.0001) return Infinity;

        const diff = this._tmpVec;
        vec3.subtract(diff, center, ray.origin);
        const t = vec3.dot(diff, normal) / denom;
        if (t < 0) return Infinity;

        // Hit point on the plane
        const hitPoint = vec3.create();
        vec3.scale(hitPoint, ray.direction, t);
        vec3.add(hitPoint, ray.origin, hitPoint);

        // Distance from center to hit point
        const distFromCenter = vec3.distance(hitPoint, center);

        // How close is the hit to the ring itself?
        return Math.abs(distFromCenter - radius);
    }

    // ===== Axis Projection =====

    projectMouseToAxis(ray, origin, axisDir) {
        // Build a plane containing the axis that faces the camera
        const cameraDir = vec3.create();
        vec3.subtract(cameraDir, this.camera.position, origin);

        const planeNormal = vec3.create();
        vec3.cross(planeNormal, axisDir, cameraDir);
        vec3.cross(planeNormal, planeNormal, axisDir);
        vec3.normalize(planeNormal, planeNormal);

        if (vec3.length(planeNormal) < 0.0001) return null;

        // Ray-plane intersection
        const denom = vec3.dot(ray.direction, planeNormal);
        if (Math.abs(denom) < 0.0001) return null;

        const diff = vec3.create();
        vec3.subtract(diff, origin, ray.origin);
        const t = vec3.dot(diff, planeNormal) / denom;

        const hitPoint = vec3.create();
        vec3.scale(hitPoint, ray.direction, t);
        vec3.add(hitPoint, ray.origin, hitPoint);

        // Project onto axis
        const fromOrigin = vec3.create();
        vec3.subtract(fromOrigin, hitPoint, origin);
        return vec3.dot(fromOrigin, axisDir);
    }

    // ===== Gizmo Rendering =====

    initGLResources(gl, program) {
        if (this.glResources) return;

        this.glResources = {
            move: this.createGizmoVAO(gl, program, this.buildMoveGizmoData()),
            rotate: this.createGizmoVAO(gl, program, this.buildRotateGizmoData()),
            scale: this.createGizmoVAO(gl, program, this.buildScaleGizmoData())
        };
    }

    createGizmoVAO(gl, program, data) {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.vertices), gl.DYNAMIC_DRAW);

        const stride = 6 * 4; // 3 pos + 3 color = 6 floats * 4 bytes
        const posLoc = program.attributes.aPosition;
        const colLoc = program.attributes.aColor;

        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(colLoc);
        gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, stride, 3 * 4);

        gl.bindVertexArray(null);

        return {
            vao,
            buffer,
            vertexCount: data.vertices.length / 6,
            baseVertices: data.vertices.slice(), // Keep copy for color updates
            axisRanges: data.axisRanges // { x: [start, count], y: [...], z: [...] }
        };
    }

    buildMoveGizmoData() {
        const verts = [];
        const axisRanges = {};

        const addArrow = (name, ax, ay, az, r, g, b) => {
            const startIdx = verts.length / 6;

            // Shaft
            verts.push(0, 0, 0, r, g, b);
            verts.push(ax * ARROW_LENGTH, ay * ARROW_LENGTH, az * ARROW_LENGTH, r, g, b);

            // Arrowhead: two V-shaped lines at the tip
            const tip = [ax * ARROW_LENGTH, ay * ARROW_LENGTH, az * ARROW_LENGTH];
            const back = [ax * (ARROW_LENGTH - ARROW_HEAD), ay * (ARROW_LENGTH - ARROW_HEAD), az * (ARROW_LENGTH - ARROW_HEAD)];

            // Get two perpendicular directions
            let p1, p2;
            if (Math.abs(ax) > 0.5) { p1 = [0, 1, 0]; p2 = [0, 0, 1]; }
            else if (Math.abs(ay) > 0.5) { p1 = [1, 0, 0]; p2 = [0, 0, 1]; }
            else { p1 = [1, 0, 0]; p2 = [0, 1, 0]; }

            const hs = ARROW_HEAD * 0.4;
            // Head line 1
            verts.push(tip[0], tip[1], tip[2], r, g, b);
            verts.push(back[0] + p1[0] * hs, back[1] + p1[1] * hs, back[2] + p1[2] * hs, r, g, b);
            // Head line 2
            verts.push(tip[0], tip[1], tip[2], r, g, b);
            verts.push(back[0] - p1[0] * hs, back[1] - p1[1] * hs, back[2] - p1[2] * hs, r, g, b);
            // Head line 3
            verts.push(tip[0], tip[1], tip[2], r, g, b);
            verts.push(back[0] + p2[0] * hs, back[1] + p2[1] * hs, back[2] + p2[2] * hs, r, g, b);
            // Head line 4
            verts.push(tip[0], tip[1], tip[2], r, g, b);
            verts.push(back[0] - p2[0] * hs, back[1] - p2[1] * hs, back[2] - p2[2] * hs, r, g, b);

            const count = verts.length / 6 - startIdx;
            axisRanges[name] = [startIdx, count];
        };

        const x = AXES.x.color, y = AXES.y.color, z = AXES.z.color;
        addArrow('x', 1, 0, 0, x[0], x[1], x[2]);
        addArrow('y', 0, 1, 0, y[0], y[1], y[2]);
        addArrow('z', 0, 0, 1, z[0], z[1], z[2]);

        return { vertices: verts, axisRanges };
    }

    buildRotateGizmoData() {
        const verts = [];
        const axisRanges = {};

        const addRing = (name, planeA, planeB, r, g, b) => {
            const startIdx = verts.length / 6;
            for (let i = 0; i < RING_SEGMENTS; i++) {
                const a1 = (i / RING_SEGMENTS) * Math.PI * 2;
                const a2 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;

                const p1 = [0, 0, 0];
                const p2 = [0, 0, 0];
                p1[planeA] = Math.cos(a1) * RING_RADIUS;
                p1[planeB] = Math.sin(a1) * RING_RADIUS;
                p2[planeA] = Math.cos(a2) * RING_RADIUS;
                p2[planeB] = Math.sin(a2) * RING_RADIUS;

                verts.push(p1[0], p1[1], p1[2], r, g, b);
                verts.push(p2[0], p2[1], p2[2], r, g, b);
            }
            const count = verts.length / 6 - startIdx;
            axisRanges[name] = [startIdx, count];
        };

        const xc = AXES.x.color, yc = AXES.y.color, zc = AXES.z.color;
        // X-ring: rotation around X axis, ring in YZ plane
        addRing('x', 1, 2, xc[0], xc[1], xc[2]);
        // Y-ring: rotation around Y axis, ring in XZ plane
        addRing('y', 0, 2, yc[0], yc[1], yc[2]);
        // Z-ring: rotation around Z axis, ring in XY plane
        addRing('z', 0, 1, zc[0], zc[1], zc[2]);

        return { vertices: verts, axisRanges };
    }

    buildScaleGizmoData() {
        const verts = [];
        const axisRanges = {};
        const cubeSize = 0.08;

        const addScaleAxis = (name, ax, ay, az, r, g, b) => {
            const startIdx = verts.length / 6;

            // Shaft
            verts.push(0, 0, 0, r, g, b);
            verts.push(ax * ARROW_LENGTH, ay * ARROW_LENGTH, az * ARROW_LENGTH, r, g, b);

            // Small cube at the tip (drawn as 3 squares = 12 line segments)
            const cx = ax * ARROW_LENGTH, cy = ay * ARROW_LENGTH, cz = az * ARROW_LENGTH;
            const s = cubeSize;

            // Get perpendicular axes
            let p1, p2;
            if (Math.abs(ax) > 0.5) { p1 = [0, s, 0]; p2 = [0, 0, s]; }
            else if (Math.abs(ay) > 0.5) { p1 = [s, 0, 0]; p2 = [0, 0, s]; }
            else { p1 = [s, 0, 0]; p2 = [0, s, 0]; }

            // Front face
            verts.push(cx - p1[0] - p2[0], cy - p1[1] - p2[1], cz - p1[2] - p2[2], r, g, b);
            verts.push(cx + p1[0] - p2[0], cy + p1[1] - p2[1], cz + p1[2] - p2[2], r, g, b);
            verts.push(cx + p1[0] - p2[0], cy + p1[1] - p2[1], cz + p1[2] - p2[2], r, g, b);
            verts.push(cx + p1[0] + p2[0], cy + p1[1] + p2[1], cz + p1[2] + p2[2], r, g, b);
            verts.push(cx + p1[0] + p2[0], cy + p1[1] + p2[1], cz + p1[2] + p2[2], r, g, b);
            verts.push(cx - p1[0] + p2[0], cy - p1[1] + p2[1], cz - p1[2] + p2[2], r, g, b);
            verts.push(cx - p1[0] + p2[0], cy - p1[1] + p2[1], cz - p1[2] + p2[2], r, g, b);
            verts.push(cx - p1[0] - p2[0], cy - p1[1] - p2[1], cz - p1[2] - p2[2], r, g, b);

            const count = verts.length / 6 - startIdx;
            axisRanges[name] = [startIdx, count];
        };

        const xc = AXES.x.color, yc = AXES.y.color, zc = AXES.z.color;
        addScaleAxis('x', 1, 0, 0, xc[0], xc[1], xc[2]);
        addScaleAxis('y', 0, 1, 0, yc[0], yc[1], yc[2]);
        addScaleAxis('z', 0, 0, 1, zc[0], zc[1], zc[2]);

        return { vertices: verts, axisRanges };
    }

    renderGizmo(gl, program, camera) {
        const entity = this.scene.selectedEntity;
        if (!entity || this.currentTool === 'select') return;
        if (!this.isToolAllowed(entity)) return;

        this.initGLResources(gl, program);

        const gizmoData = this.glResources[this.currentTool];
        if (!gizmoData) return;

        // Update colors for hover/active highlight
        this.updateGizmoColors(gl, gizmoData);

        gl.useProgram(program.program);
        gl.disable(gl.DEPTH_TEST);

        // Set matrices
        gl.uniformMatrix4fv(program.uniforms.uViewMatrix, false, camera.viewMatrix);
        gl.uniformMatrix4fv(program.uniforms.uProjectionMatrix, false, camera.projectionMatrix);

        // Model matrix: translate to entity position, scale for consistent screen size
        const model = this._tmpMat;
        mat4.identity(model);
        mat4.translate(model, model, entity.transform.position);
        const s = this.getGizmoScale(entity);
        mat4.scale(model, model, vec3.create(s, s, s));
        gl.uniformMatrix4fv(program.uniforms.uModelMatrix, false, model);

        // Draw. On desktop a single pass; on mobile a small grid of offset passes
        // to fake thick lines (WebGL2 forces gl.LINES to 1px regardless of lineWidth).
        gl.bindVertexArray(gizmoData.vao);
        const offsetLoc = program.uniforms.uNdcOffset;

        if (this.isMobileViewport()) {
            // 1 drawing-buffer pixel in NDC units. main.js sizes the canvas 1:1
            // with CSS (no DPR scaling), so buffer pixels == CSS pixels here.
            const stepX = 2 / gl.drawingBufferWidth;
            const stepY = 2 / gl.drawingBufferHeight;
            const r = GIZMO_THICKEN_RADIUS;
            for (let iy = -r; iy <= r; iy++) {
                for (let ix = -r; ix <= r; ix++) {
                    gl.uniform2f(offsetLoc, ix * stepX, iy * stepY);
                    gl.drawArrays(gl.LINES, 0, gizmoData.vertexCount);
                }
            }
        } else {
            gl.uniform2f(offsetLoc, 0, 0);
            gl.drawArrays(gl.LINES, 0, gizmoData.vertexCount);
        }
        gl.bindVertexArray(null);

        gl.enable(gl.DEPTH_TEST);
    }

    updateGizmoColors(gl, gizmoData) {
        const highlightAxis = this.isDragging ? this.activeAxis : this.hoveredAxis;
        if (!highlightAxis && !this._lastHighlight) return;
        this._lastHighlight = highlightAxis;

        // Restore base colors
        const verts = gizmoData.baseVertices.slice();

        // Apply highlight
        if (highlightAxis && gizmoData.axisRanges[highlightAxis]) {
            const [start, count] = gizmoData.axisRanges[highlightAxis];
            const hc = AXES[highlightAxis].highlight;
            for (let i = start; i < start + count; i++) {
                verts[i * 6 + 3] = hc[0];
                verts[i * 6 + 4] = hc[1];
                verts[i * 6 + 5] = hc[2];
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, gizmoData.buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(verts));
    }
}
