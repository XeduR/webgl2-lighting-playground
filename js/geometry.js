/*
    Geometry generators - create vertex data for various primitives
*/

import { createBuffer, createIndexBuffer, createVAO } from './gl-utils.js';

// Generate cube geometry
export function createCubeGeometry() {
    // prettier-ignore
    const positions = new Float32Array([
        // Front face
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
        // Back face
        -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,   0.5, -0.5, -0.5,
        // Top face
        -0.5,  0.5, -0.5,  -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,
        // Bottom face
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
        // Right face
         0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,   0.5, -0.5,  0.5,
        // Left face
        -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5
    ]);

    // prettier-ignore
    const normals = new Float32Array([
        // Front
         0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,
        // Back
         0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,
        // Top
         0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
        // Bottom
         0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
        // Right
         1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,
        // Left
        -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0
    ]);

    // prettier-ignore
    const uvs = new Float32Array([
        // Front
        0, 0,  1, 0,  1, 1,  0, 1,
        // Back
        1, 0,  1, 1,  0, 1,  0, 0,
        // Top
        0, 1,  0, 0,  1, 0,  1, 1,
        // Bottom
        1, 1,  0, 1,  0, 0,  1, 0,
        // Right
        1, 0,  1, 1,  0, 1,  0, 0,
        // Left
        0, 0,  1, 0,  1, 1,  0, 1
    ]);

    // prettier-ignore
    const indices = new Uint16Array([
        0,  1,  2,   0,  2,  3,    // Front
        4,  5,  6,   4,  6,  7,    // Back
        8,  9,  10,  8,  10, 11,   // Top
        12, 13, 14,  12, 14, 15,   // Bottom
        16, 17, 18,  16, 18, 19,   // Right
        20, 21, 22,  20, 22, 23    // Left
    ]);

    return {
        positions,
        normals,
        uvs,
        indices,
        vertexCount: indices.length,
        bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }
    };
}

// Generate sphere geometry using UV mapping
export function createSphereGeometry(segments = 32, rings = 24) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // Generate vertices
    for (let ring = 0; ring <= rings; ring++) {
        const theta = ring * Math.PI / rings;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let seg = 0; seg <= segments; seg++) {
            const phi = seg * 2 * Math.PI / segments;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;

            const u = 1 - seg / segments;
            const v = 1 - ring / rings;

            positions.push(x * 0.5, y * 0.5, z * 0.5);
            normals.push(x, y, z);
            uvs.push(u, v);
        }
    }

    // Generate indices - CCW winding for front faces (viewed from outside)
    for (let ring = 0; ring < rings; ring++) {
        for (let seg = 0; seg < segments; seg++) {
            const first = ring * (segments + 1) + seg;
            const second = first + segments + 1;

            // Two triangles per quad: first-first+1-second, second-first+1-second+1
            indices.push(first, first + 1, second);
            indices.push(second, first + 1, second + 1);
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices),
        vertexCount: indices.length,
        bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }
    };
}

// Generate plane geometry
export function createPlaneGeometry(width = 10, height = 10, segmentsX = 1, segmentsY = 1) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Generate vertices
    for (let y = 0; y <= segmentsY; y++) {
        for (let x = 0; x <= segmentsX; x++) {
            const px = (x / segmentsX - 0.5) * width;
            const py = 0;
            const pz = (y / segmentsY - 0.5) * height;

            positions.push(px, py, pz);
            normals.push(0, 1, 0);
            uvs.push(x / segmentsX, y / segmentsY);
        }
    }

    // Generate indices
    for (let y = 0; y < segmentsY; y++) {
        for (let x = 0; x < segmentsX; x++) {
            const a = x + (segmentsX + 1) * y;
            const b = x + (segmentsX + 1) * (y + 1);
            const c = (x + 1) + (segmentsX + 1) * (y + 1);
            const d = (x + 1) + (segmentsX + 1) * y;

            indices.push(a, b, d);
            indices.push(b, c, d);
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices),
        vertexCount: indices.length,
        bounds: { min: [-halfWidth, 0, -halfHeight], max: [halfWidth, 0, halfHeight] }
    };
}

// Create GPU buffers from geometry data
export function createMeshBuffers(gl, geometry) {
    const positionBuffer = createBuffer(gl, geometry.positions);
    const normalBuffer = createBuffer(gl, geometry.normals);
    const uvBuffer = createBuffer(gl, geometry.uvs);
    const indexBuffer = createIndexBuffer(gl, geometry.indices);

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        indexBuffer,
        vertexCount: geometry.vertexCount,
        bounds: geometry.bounds
    };
}

// Create a VAO for a mesh
export function createMeshVAO(gl, buffers, attributeLocations) {
    const attributes = [];

    if (attributeLocations.position >= 0) {
        attributes.push({
            buffer: buffers.positionBuffer,
            location: attributeLocations.position,
            size: 3
        });
    }

    if (attributeLocations.normal >= 0) {
        attributes.push({
            buffer: buffers.normalBuffer,
            location: attributeLocations.normal,
            size: 3
        });
    }

    if (attributeLocations.uv >= 0) {
        attributes.push({
            buffer: buffers.uvBuffer,
            location: attributeLocations.uv,
            size: 2
        });
    }

    return createVAO(gl, attributes, buffers.indexBuffer);
}

// Geometry cache to avoid recreating the same geometry
export class GeometryCache {
    constructor(gl) {
        this.gl = gl;
        this.cache = new Map();
    }

    get(type) {
        if (this.cache.has(type)) {
            return this.cache.get(type);
        }

        let geometry;
        switch (type) {
            case 'cube':
                geometry = createCubeGeometry();
                break;
            case 'sphere':
                geometry = createSphereGeometry(32, 24);
                break;
            case 'plane':
                geometry = createPlaneGeometry(10, 10, 1, 1);
                break;
            default:
                throw new Error(`Unknown geometry type: ${type}`);
        }

        const buffers = createMeshBuffers(this.gl, geometry);
        this.cache.set(type, buffers);
        return buffers;
    }

    dispose() {
        const gl = this.gl;
        for (const buffers of this.cache.values()) {
            gl.deleteBuffer(buffers.positionBuffer);
            gl.deleteBuffer(buffers.normalBuffer);
            gl.deleteBuffer(buffers.uvBuffer);
            gl.deleteBuffer(buffers.indexBuffer);
        }
        this.cache.clear();
    }
}
