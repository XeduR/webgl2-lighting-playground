/*
    Camera and orbit controls
*/

import { mat4, vec3, degToRad, clamp } from './math.js';

// Perspective camera
export class Camera {
    constructor() {
        this.position = vec3.create(5, 5, 10);
        this.target = vec3.create(0, 0, 0);
        this.up = vec3.create(0, 1, 0);

        this.fov = degToRad(60);
        this.aspect = 1;
        this.near = 0.1;
        this.far = 1000;

        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();
        this.viewProjectionMatrix = mat4.create();
        this.inverseViewMatrix = mat4.create();

        this.dirty = true;
    }

    setAspect(width, height) {
        this.aspect = width / height;
        this.dirty = true;
    }

    lookAt(eye, target, up = [0, 1, 0]) {
        vec3.copy(this.position, eye);
        vec3.copy(this.target, target);
        vec3.copy(this.up, up);
        this.dirty = true;
    }

    update() {
        if (!this.dirty) return;

        mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
        mat4.perspective(this.projectionMatrix, this.fov, this.aspect, this.near, this.far);
        mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
        mat4.invert(this.inverseViewMatrix, this.viewMatrix);

        this.dirty = false;
    }

    // Get camera forward direction
    getForward(out) {
        out[0] = -this.viewMatrix[2];
        out[1] = -this.viewMatrix[6];
        out[2] = -this.viewMatrix[10];
        return vec3.normalize(out, out);
    }

    // Get camera right direction
    getRight(out) {
        out[0] = this.viewMatrix[0];
        out[1] = this.viewMatrix[4];
        out[2] = this.viewMatrix[8];
        return vec3.normalize(out, out);
    }
}

// Orbit controls for camera manipulation
export class OrbitControls {
    constructor(camera, canvas) {
        this.camera = camera;
        this.canvas = canvas;

        // Orbit parameters
        this.distance = 15;
        this.theta = Math.PI / 4; // Horizontal angle
        this.phi = Math.PI / 3;   // Vertical angle (from top)
        this.target = vec3.create(0, 0, 0);

        // Store initial values for reset
        this.initialDistance = this.distance;
        this.initialTheta = this.theta;
        this.initialPhi = this.phi;
        this.initialTarget = vec3.clone(this.target);

        // Limits
        this.minDistance = 2;
        this.maxDistance = 100;
        this.minPhi = 0.1;
        this.maxPhi = Math.PI - 0.1;

        // Input sensitivity
        this.rotateSpeed = 0.005;
        this.panSpeed = 0.01;
        this.zoomSpeed = 0.1;

        // Input state
        this.isDragging = false;
        this.isPanning = false;
        this.lastX = 0;
        this.lastY = 0;

        // Damping
        this.enableDamping = true;
        this.dampingFactor = 0.1;
        this.targetTheta = this.theta;
        this.targetPhi = this.phi;
        this.targetDistance = this.distance;
        this.targetTarget = vec3.clone(this.target);

        // Tool system can disable orbit to allow gizmo drags
        this.enabled = true;

        this.setupEventListeners();
        this.updateCameraPosition();
    }

    reset() {
        this.distance = this.initialDistance;
        this.theta = this.initialTheta;
        this.phi = this.initialPhi;
        vec3.copy(this.target, this.initialTarget);

        this.targetTheta = this.theta;
        this.targetPhi = this.phi;
        this.targetDistance = this.distance;
        vec3.copy(this.targetTarget, this.target);

        this.updateCameraPosition();
    }

    setupEventListeners() {
        this._handlers = {
            mousedown: this.onMouseDown.bind(this),
            mousemove: this.onMouseMove.bind(this),
            mouseup: this.onMouseUp.bind(this),
            wheel: this.onWheel.bind(this),
            contextmenu: (e) => e.preventDefault(),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this)
        };

        this.canvas.addEventListener('mousedown', this._handlers.mousedown);
        this.canvas.addEventListener('mousemove', this._handlers.mousemove);
        this.canvas.addEventListener('mouseup', this._handlers.mouseup);
        this.canvas.addEventListener('mouseleave', this._handlers.mouseup);
        this.canvas.addEventListener('wheel', this._handlers.wheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this._handlers.contextmenu);

        this.canvas.addEventListener('touchstart', this._handlers.touchstart, { passive: false });
        this.canvas.addEventListener('touchmove', this._handlers.touchmove, { passive: false });
        this.canvas.addEventListener('touchend', this._handlers.touchend);
    }

    dispose() {
        this.canvas.removeEventListener('mousedown', this._handlers.mousedown);
        this.canvas.removeEventListener('mousemove', this._handlers.mousemove);
        this.canvas.removeEventListener('mouseup', this._handlers.mouseup);
        this.canvas.removeEventListener('mouseleave', this._handlers.mouseup);
        this.canvas.removeEventListener('wheel', this._handlers.wheel);
        this.canvas.removeEventListener('contextmenu', this._handlers.contextmenu);
        this.canvas.removeEventListener('touchstart', this._handlers.touchstart);
        this.canvas.removeEventListener('touchmove', this._handlers.touchmove);
        this.canvas.removeEventListener('touchend', this._handlers.touchend);
    }

    onMouseDown(e) {
        if (!this.enabled) return;
        e.preventDefault();
        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (e.button === 0) {
            // Left click: rotate
            this.isDragging = true;
        } else if (e.button === 2 || e.button === 1) {
            // Right click or middle: pan
            this.isPanning = true;
        }
    }

    onMouseMove(e) {
        if (!this.enabled) return;
        if (!this.isDragging && !this.isPanning) return;

        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (this.isDragging) {
            this.targetTheta -= dx * this.rotateSpeed;
            this.targetPhi = clamp(
                this.targetPhi + dy * this.rotateSpeed,
                this.minPhi,
                this.maxPhi
            );
        } else if (this.isPanning) {
            this.pan(-dx, -dy);
        }
    }

    onMouseUp(e) {
        this.isDragging = false;
        this.isPanning = false;
    }

    onWheel(e) {
        e.preventDefault();
        if (!this.enabled) return;
        const delta = e.deltaY > 0 ? 1 : -1;
        this.targetDistance = clamp(
            this.targetDistance * (1 + delta * this.zoomSpeed),
            this.minDistance,
            this.maxDistance
        );
    }

    // Touch support
    touchStartDist = 0;
    touchStartDistance = 0;

    onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            this.isDragging = false;
            this.touchStartDist = this.getTouchDistance(e.touches);
            this.touchStartDistance = this.targetDistance;
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            const dx = e.touches[0].clientX - this.lastX;
            const dy = e.touches[0].clientY - this.lastY;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;

            this.targetTheta -= dx * this.rotateSpeed;
            this.targetPhi = clamp(
                this.targetPhi + dy * this.rotateSpeed,
                this.minPhi,
                this.maxPhi
            );
        } else if (e.touches.length === 2) {
            const dist = this.getTouchDistance(e.touches);
            const scale = this.touchStartDist / dist;
            this.targetDistance = clamp(
                this.touchStartDistance * scale,
                this.minDistance,
                this.maxDistance
            );
        }
    }

    onTouchEnd(e) {
        this.isDragging = false;
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    pan(dx, dy) {
        const panScale = this.distance * this.panSpeed;

        // Get camera right and up vectors
        const right = vec3.create();
        const up = vec3.create();

        right[0] = this.camera.viewMatrix[0];
        right[1] = this.camera.viewMatrix[4];
        right[2] = this.camera.viewMatrix[8];

        up[0] = this.camera.viewMatrix[1];
        up[1] = this.camera.viewMatrix[5];
        up[2] = this.camera.viewMatrix[9];

        // Apply pan
        vec3.scale(right, right, -dx * panScale);
        vec3.scale(up, up, dy * panScale);

        vec3.add(this.targetTarget, this.targetTarget, right);
        vec3.add(this.targetTarget, this.targetTarget, up);
    }

    update() {
        // Apply damping
        if (this.enableDamping) {
            this.theta += (this.targetTheta - this.theta) * this.dampingFactor;
            this.phi += (this.targetPhi - this.phi) * this.dampingFactor;
            this.distance += (this.targetDistance - this.distance) * this.dampingFactor;
            vec3.lerp(this.target, this.target, this.targetTarget, this.dampingFactor);
        } else {
            this.theta = this.targetTheta;
            this.phi = this.targetPhi;
            this.distance = this.targetDistance;
            vec3.copy(this.target, this.targetTarget);
        }

        this.updateCameraPosition();
    }

    updateCameraPosition() {
        // Convert spherical to cartesian
        const x = this.distance * Math.sin(this.phi) * Math.cos(this.theta);
        const y = this.distance * Math.cos(this.phi);
        const z = this.distance * Math.sin(this.phi) * Math.sin(this.theta);

        this.camera.position[0] = this.target[0] + x;
        this.camera.position[1] = this.target[1] + y;
        this.camera.position[2] = this.target[2] + z;

        vec3.copy(this.camera.target, this.target);
        this.camera.dirty = true;
    }

    // Focus on a point
    focusOn(point, distance = null) {
        vec3.copy(this.targetTarget, point);
        if (distance !== null) {
            this.targetDistance = distance;
        }
    }

}
