/*
    Scene management - entities, transforms, and scene graph
*/

import { mat4, vec3, degToRad } from './math.js';

let entityIdCounter = 0;

// Generate unique entity ID
export function generateId() {
    return ++entityIdCounter;
}

// Transform component - handles position, rotation, scale
export class Transform {
    constructor() {
        this.position = vec3.create(0, 0, 0);
        this.rotation = vec3.create(0, 0, 0); // Euler angles in radians
        this.scale = vec3.create(1, 1, 1);
        this.modelMatrix = mat4.create();
        // Initialize normal matrix to identity
        this.normalMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        this.dirty = true;
    }

    setPosition(x, y, z) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
        this.dirty = true;
    }

    setRotation(x, y, z) {
        this.rotation[0] = x;
        this.rotation[1] = y;
        this.rotation[2] = z;
        this.dirty = true;
    }

    setScale(x, y, z) {
        this.scale[0] = x;
        this.scale[1] = y;
        this.scale[2] = z === undefined ? x : z;
        this.dirty = true;
    }

    updateMatrix() {
        if (!this.dirty) return;

        mat4.identity(this.modelMatrix);
        mat4.translate(this.modelMatrix, this.modelMatrix, this.position);
        mat4.rotateY(this.modelMatrix, this.modelMatrix, this.rotation[1]);
        mat4.rotateX(this.modelMatrix, this.modelMatrix, this.rotation[0]);
        mat4.rotateZ(this.modelMatrix, this.modelMatrix, this.rotation[2]);
        mat4.scale(this.modelMatrix, this.modelMatrix, this.scale);

        // Calculate normal matrix
        if (this.ignoreRotationForNormals) {
            // For spheres: normal matrix is inverse of scale only.
            // Rotation shouldn't affect normals on a rotationally symmetric shape.
            this.normalMatrix[0] = 1 / this.scale[0];
            this.normalMatrix[1] = 0;
            this.normalMatrix[2] = 0;
            this.normalMatrix[3] = 0;
            this.normalMatrix[4] = 1 / this.scale[1];
            this.normalMatrix[5] = 0;
            this.normalMatrix[6] = 0;
            this.normalMatrix[7] = 0;
            this.normalMatrix[8] = 1 / this.scale[2];
        } else {
            mat4.normalFromMat4(this.normalMatrix, this.modelMatrix);
        }

        this.dirty = false;
    }
}

// Material properties
export class Material {
    constructor() {
        this.color = vec3.create(1, 1, 1);
        this.opacity = 0.6;
        this.specular = 0.5;
        this.roughness = 0.5;
        this.thickness = 1.0; // For transmission - full color saturation by default
    }

    setColor(r, g, b) {
        this.color[0] = r;
        this.color[1] = g;
        this.color[2] = b;
    }

    clone() {
        const m = new Material();
        vec3.copy(m.color, this.color);
        m.opacity = this.opacity;
        m.specular = this.specular;
        m.roughness = this.roughness;
        m.thickness = this.thickness;
        return m;
    }
}

// Scene object (mesh entity)
export class SceneObject {
    constructor(name, geometryType) {
        this.id = generateId();
        this.name = name;
        this.type = 'object';
        this.geometryType = geometryType;
        this.transform = new Transform();
        this.material = new Material();
        this.visible = true;
        this.castShadow = true;
        this.receiveShadow = true;

        // Sphere normals should ignore rotation (rotationally symmetric)
        if (geometryType === 'sphere') {
            this.transform.ignoreRotationForNormals = true;
        }
    }

    clone() {
        const obj = new SceneObject(this.name + ' Copy', this.geometryType);
        vec3.copy(obj.transform.position, this.transform.position);
        vec3.copy(obj.transform.rotation, this.transform.rotation);
        vec3.copy(obj.transform.scale, this.transform.scale);
        obj.transform.ignoreRotationForNormals = this.transform.ignoreRotationForNormals;
        obj.transform.dirty = true;
        obj.material = this.material.clone();
        obj.visible = this.visible;
        obj.castShadow = this.castShadow;
        obj.receiveShadow = this.receiveShadow;
        return obj;
    }
}

// Light types
export const LightType = {
    DIRECTIONAL: 'directional',
    POINT: 'point',
    SPOT: 'spot'
};

// Light entity
export class Light {
    constructor(name, type) {
        this.id = generateId();
        this.name = name;
        this.type = 'light';  // Entity type for UI
        this.lightType = type; // Light type (directional/point/spot)
        this.transform = new Transform();
        this.color = vec3.create(1, 1, 1);
        this.intensity = 1.0;
        this.visible = true;

        // Directional light: direction is -Z in local space
        // Point/Spot: position from transform

        // Point light properties
        this.range = 10.0;
        this.decay = 2.0; // Quadratic falloff

        // Spot light properties
        this.innerAngle = Math.PI / 6; // 30 degrees
        this.outerAngle = Math.PI / 4; // 45 degrees

        // Shadow properties
        this.castShadow = true;
        this.shadowBias = 0.002;
        this.shadowMapSize = 1024;
        this.shadowNear = 0.1;
        this.shadowFar = 50.0;

        // Cached matrices for shadow mapping
        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();
        this.shadowMatrix = mat4.create();

        // Shadow map resources (set by renderer)
        this.shadowFramebuffer = null;
        this.shadowTexture = null;
        this.transmissionFramebuffer = null;
        this.transmissionTexture = null;
    }

    // Get world-space direction for directional lights
    getDirection(out) {
        // Default direction is -Z
        const dir = vec3.create(0, 0, -1);
        this.transform.updateMatrix();
        vec3.transformDirection(out, dir, this.transform.modelMatrix);
        return out;
    }

    // Get world-space position
    getPosition(out) {
        vec3.copy(out, this.transform.position);
        return out;
    }

    // Update shadow matrices
    updateShadowMatrices(sceneCenter = null, sceneRadius = 20) {
        if (!sceneCenter) {
            sceneCenter = vec3.create(0, 0, 0);
        }
        this.transform.updateMatrix();

        if (this.lightType === LightType.DIRECTIONAL) {
            // Orthographic projection for directional lights
            // Use tighter bounds for better shadow resolution
            // Clamp radius to reasonable size to avoid spreading shadow map too thin
            const effectiveRadius = Math.min(sceneRadius, 15);
            const size = effectiveRadius * 1.2;

            mat4.ortho(
                this.projectionMatrix,
                -size, size, -size, size,
                this.shadowNear, this.shadowFar
            );

            // View matrix: look at scene center from direction
            const dir = vec3.create();
            this.getDirection(dir);
            const eye = vec3.create();
            vec3.scale(eye, dir, -effectiveRadius * 2);
            vec3.add(eye, eye, sceneCenter);

            const up = vec3.create(0, 1, 0);
            // Handle case when light is pointing straight down
            if (Math.abs(dir[1]) > 0.99) {
                up[0] = 0; up[1] = 0; up[2] = 1;
            }
            mat4.lookAt(
                this.viewMatrix,
                eye,
                sceneCenter,
                up
            );
        } else if (this.lightType === LightType.SPOT) {
            // Perspective projection for spotlights
            // Clamp FOV to max ~170 degrees to prevent matrix issues at extreme angles
            const fov = Math.min(this.outerAngle * 2, Math.PI * 0.94);
            mat4.perspective(
                this.projectionMatrix,
                fov,
                1.0,
                this.shadowNear,
                this.range
            );

            // View matrix: look in light direction
            const pos = this.transform.position;
            const dir = vec3.create();
            this.getDirection(dir);
            const target = vec3.create();
            vec3.add(target, pos, dir);

            const up = vec3.create(0, 1, 0);
            // Handle case when light is pointing straight up/down
            if (Math.abs(dir[1]) > 0.99) {
                up[0] = 0; up[1] = 0; up[2] = 1;
            }
            mat4.lookAt(this.viewMatrix, pos, target, up);
        }
        // Point lights use cubemap - handled separately

        // Combined shadow matrix (transforms world -> shadow clip space)
        mat4.multiply(this.shadowMatrix, this.projectionMatrix, this.viewMatrix);
    }

    clone() {
        const light = new Light(this.name + ' Copy', this.lightType);
        vec3.copy(light.transform.position, this.transform.position);
        vec3.copy(light.transform.rotation, this.transform.rotation);
        light.transform.dirty = true;
        vec3.copy(light.color, this.color);
        light.intensity = this.intensity;
        light.range = this.range;
        light.decay = this.decay;
        light.innerAngle = this.innerAngle;
        light.outerAngle = this.outerAngle;
        light.castShadow = this.castShadow;
        light.shadowBias = this.shadowBias;
        light.shadowMapSize = this.shadowMapSize;
        return light;
    }
}

// Scene container
export class Scene {
    constructor() {
        this.objects = [];
        this.lights = [];
        this.selectedEntity = null;
        this.ambientColor = vec3.create(0.1, 0.1, 0.15);
        this.ambientIntensity = 0.3;

        // Scene bounds for shadow calculation
        this.boundsMin = vec3.create(-20, -20, -20);
        this.boundsMax = vec3.create(20, 20, 20);

        // Event callbacks
        this.onEntityAdded = null;
        this.onEntityRemoved = null;
        this.onSelectionChanged = null;
    }

    addObject(obj) {
        this.objects.push(obj);
        if (this.onEntityAdded) this.onEntityAdded(obj);
        return obj;
    }

    addLight(light) {
        this.lights.push(light);
        if (this.onEntityAdded) this.onEntityAdded(light);
        return light;
    }

    removeEntity(entity) {
        let idx = this.objects.indexOf(entity);
        if (idx >= 0) {
            this.objects.splice(idx, 1);
            if (this.selectedEntity === entity) this.selectEntity(null);
            if (this.onEntityRemoved) this.onEntityRemoved(entity);
            return true;
        }

        idx = this.lights.indexOf(entity);
        if (idx >= 0) {
            this.lights.splice(idx, 1);
            if (this.selectedEntity === entity) this.selectEntity(null);
            if (this.onEntityRemoved) this.onEntityRemoved(entity);
            return true;
        }

        return false;
    }

    selectEntity(entity) {
        this.selectedEntity = entity;
        if (this.onSelectionChanged) this.onSelectionChanged(entity);
    }

    getEntityById(id) {
        for (const obj of this.objects) {
            if (obj.id === id) return obj;
        }
        for (const light of this.lights) {
            if (light.id === id) return light;
        }
        return null;
    }

    getAllEntities() {
        return [...this.objects, ...this.lights];
    }

    // Get all opaque objects (sorted by distance to camera for efficiency)
    getOpaqueObjects() {
        return this.objects.filter(obj => obj.visible && obj.material.opacity >= 1.0);
    }

    // Get all translucent objects (sorted back-to-front)
    getTranslucentObjects(cameraPosition) {
        const translucent = this.objects.filter(
            obj => obj.visible && obj.material.opacity < 1.0
        );

        // Sort by distance to camera (back to front)
        translucent.sort((a, b) => {
            const distA = vec3.distance(cameraPosition, a.transform.position);
            const distB = vec3.distance(cameraPosition, b.transform.position);
            return distB - distA;
        });

        return translucent;
    }

    // Get all visible lights
    getVisibleLights() {
        return this.lights.filter(light => light.visible);
    }

    // Get shadow-casting lights
    getShadowCastingLights() {
        return this.lights.filter(light => light.visible && light.castShadow);
    }

    // Update all transforms
    updateTransforms() {
        for (const obj of this.objects) {
            obj.transform.updateMatrix();
        }
        for (const light of this.lights) {
            light.transform.updateMatrix();
        }
    }

    // Clear the scene
    clear() {
        this.objects = [];
        this.lights = [];
        this.selectedEntity = null;
    }

    /**
     * Calculate scene bounds
     * For shadow purposes, we use tighter bounds that exclude very large objects
     * like ground planes to get better shadow resolution on smaller objects
     */
    calculateBounds() {
        if (this.objects.length === 0) {
            this.boundsMin = vec3.create(-10, -10, -10);
            this.boundsMax = vec3.create(10, 10, 10);
            return;
        }

        this.boundsMin = vec3.create(Infinity, Infinity, Infinity);
        this.boundsMax = vec3.create(-Infinity, -Infinity, -Infinity);

        let hasSmallObjects = false;

        // First pass: calculate bounds for "normal" sized objects (not huge ground planes)
        for (const obj of this.objects) {
            const pos = obj.transform.position;
            const scale = obj.transform.scale;
            const maxScale = Math.max(scale[0], scale[1], scale[2]);

            // Skip very large objects (like ground planes) for tighter bounds
            if (maxScale > 10) continue;

            hasSmallObjects = true;
            for (let i = 0; i < 3; i++) {
                const halfSize = scale[i] * 0.5 + 1;
                this.boundsMin[i] = Math.min(this.boundsMin[i], pos[i] - halfSize);
                this.boundsMax[i] = Math.max(this.boundsMax[i], pos[i] + halfSize);
            }
        }

        // If no small objects, use all objects
        if (!hasSmallObjects) {
            for (const obj of this.objects) {
                const pos = obj.transform.position;
                const scale = obj.transform.scale;

                for (let i = 0; i < 3; i++) {
                    const halfSize = scale[i] * 0.5 + 1;
                    this.boundsMin[i] = Math.min(this.boundsMin[i], pos[i] - halfSize);
                    this.boundsMax[i] = Math.max(this.boundsMax[i], pos[i] + halfSize);
                }
            }
        }

        // Ensure minimum bounds size
        for (let i = 0; i < 3; i++) {
            if (this.boundsMax[i] - this.boundsMin[i] < 4) {
                const center = (this.boundsMax[i] + this.boundsMin[i]) / 2;
                this.boundsMin[i] = center - 2;
                this.boundsMax[i] = center + 2;
            }
        }
    }

    getCenter() {
        return vec3.create(
            (this.boundsMin[0] + this.boundsMax[0]) / 2,
            (this.boundsMin[1] + this.boundsMax[1]) / 2,
            (this.boundsMin[2] + this.boundsMax[2]) / 2
        );
    }

    getRadius() {
        return vec3.distance(this.boundsMin, this.boundsMax) / 2;
    }
}

// Create default scene with ground plane and some objects
export function createDefaultScene() {
    const scene = new Scene();

    // Ground plane
    const ground = new SceneObject('Ground', 'plane');
    ground.transform.setPosition(0, -1, 0);
    ground.transform.setScale(20, 1, 20);
    ground.material.setColor(0.3, 0.3, 0.35);
    ground.material.opacity = 1.0; // Ground is opaque
    ground.castShadow = false;
    scene.addObject(ground);

    // Red translucent cube - pure red
    const redCube = new SceneObject('Red Cube', 'cube');
    redCube.transform.setPosition(-2, 0.5, 0);
    redCube.material.setColor(1.0, 0.0, 0.0);
    redCube.material.opacity = 0.6;
    redCube.material.thickness = 1.0;
    scene.addObject(redCube);

    // Green translucent cube - pure green
    const greenCube = new SceneObject('Green Cube', 'cube');
    greenCube.transform.setPosition(0, 0.5, 0);
    greenCube.material.setColor(0.0, 1.0, 0.0);
    greenCube.material.opacity = 0.6;
    greenCube.material.thickness = 1.0;
    scene.addObject(greenCube);

    // Blue translucent cube - pure blue
    const blueCube = new SceneObject('Blue Cube', 'cube');
    blueCube.transform.setPosition(2, 0.5, 0);
    blueCube.material.setColor(0.0, 0.0, 1.0);
    blueCube.material.opacity = 0.6;
    blueCube.material.thickness = 1.0;
    scene.addObject(blueCube);

    // Opaque sphere - almost pure white (250, 250, 250)
    const sphere = new SceneObject('White Sphere', 'sphere');
    sphere.transform.setPosition(0, 1.5, -2);
    sphere.transform.setScale(1.5, 1.5, 1.5);
    sphere.material.setColor(0.98, 0.98, 0.98);
    sphere.material.opacity = 1.0; // Sphere is opaque
    scene.addObject(sphere);

    // Main directional light (sun) - pure white
    const sunLight = new Light('Sun', LightType.DIRECTIONAL);
    sunLight.transform.setRotation(degToRad(-45), degToRad(30), degToRad(0));
    sunLight.color = vec3.create(1.0, 1.0, 1.0);
    sunLight.intensity = 1.2;
    sunLight.shadowMapSize = 2048;
    scene.addLight(sunLight);

    return scene;
}
