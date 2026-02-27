/*
    Math utilities for WebGL - matrices, vectors, and transforms
*/

// Vector3 Operations
export const vec3 = {
    create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),

    copy: (out, a) => {
        out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
        return out;
    },

    clone: (a) => new Float32Array([a[0], a[1], a[2]]),

    set: (out, x, y, z) => {
        out[0] = x; out[1] = y; out[2] = z;
        return out;
    },

    add: (out, a, b) => {
        out[0] = a[0] + b[0];
        out[1] = a[1] + b[1];
        out[2] = a[2] + b[2];
        return out;
    },

    subtract: (out, a, b) => {
        out[0] = a[0] - b[0];
        out[1] = a[1] - b[1];
        out[2] = a[2] - b[2];
        return out;
    },

    multiply: (out, a, b) => {
        out[0] = a[0] * b[0];
        out[1] = a[1] * b[1];
        out[2] = a[2] * b[2];
        return out;
    },

    scale: (out, a, s) => {
        out[0] = a[0] * s;
        out[1] = a[1] * s;
        out[2] = a[2] * s;
        return out;
    },

    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],

    cross: (out, a, b) => {
        const ax = a[0], ay = a[1], az = a[2];
        const bx = b[0], by = b[1], bz = b[2];
        out[0] = ay * bz - az * by;
        out[1] = az * bx - ax * bz;
        out[2] = ax * by - ay * bx;
        return out;
    },

    length: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),

    lengthSquared: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],

    normalize: (out, a) => {
        const len = vec3.length(a);
        if (len > 0.00001) {
            out[0] = a[0] / len;
            out[1] = a[1] / len;
            out[2] = a[2] / len;
        } else {
            out[0] = 0; out[1] = 0; out[2] = 0;
        }
        return out;
    },

    negate: (out, a) => {
        out[0] = -a[0]; out[1] = -a[1]; out[2] = -a[2];
        return out;
    },

    lerp: (out, a, b, t) => {
        out[0] = a[0] + t * (b[0] - a[0]);
        out[1] = a[1] + t * (b[1] - a[1]);
        out[2] = a[2] + t * (b[2] - a[2]);
        return out;
    },

    distance: (a, b) => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    transformMat4: (out, a, m) => {
        const x = a[0], y = a[1], z = a[2];
        // Guard against w=0 to prevent NaN from perspective divide
        const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1.0;
        out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
        out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
        out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
        return out;
    },

    transformDirection: (out, a, m) => {
        const x = a[0], y = a[1], z = a[2];
        out[0] = m[0] * x + m[4] * y + m[8] * z;
        out[1] = m[1] * x + m[5] * y + m[9] * z;
        out[2] = m[2] * x + m[6] * y + m[10] * z;
        return vec3.normalize(out, out);
    }
};

// Vector4 Operations
export const vec4 = {
    create: (x = 0, y = 0, z = 0, w = 1) => new Float32Array([x, y, z, w]),

    set: (out, x, y, z, w) => {
        out[0] = x; out[1] = y; out[2] = z; out[3] = w;
        return out;
    },

    transformMat4: (out, a, m) => {
        const x = a[0], y = a[1], z = a[2], w = a[3];
        out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
        out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
        out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
        out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
        return out;
    }
};

// Matrix 4x4 Operations
export const mat4 = {
    create: () => {
        const out = new Float32Array(16);
        out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
        return out;
    },

    identity: (out) => {
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },

    copy: (out, a) => {
        for (let i = 0; i < 16; i++) out[i] = a[i];
        return out;
    },

    clone: (a) => {
        const out = new Float32Array(16);
        for (let i = 0; i < 16; i++) out[i] = a[i];
        return out;
    },

    multiply: (out, a, b) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        return out;
    },

    translate: (out, a, v) => {
        const x = v[0], y = v[1], z = v[2];
        if (a === out) {
            out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
            out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
            out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
            out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
        } else {
            const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
            const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
            const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
            out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
            out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
            out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;
            out[12] = a00 * x + a10 * y + a20 * z + a[12];
            out[13] = a01 * x + a11 * y + a21 * z + a[13];
            out[14] = a02 * x + a12 * y + a22 * z + a[14];
            out[15] = a03 * x + a13 * y + a23 * z + a[15];
        }
        return out;
    },

    scale: (out, a, v) => {
        const x = v[0], y = v[1], z = v[2];
        out[0] = a[0] * x; out[1] = a[1] * x; out[2] = a[2] * x; out[3] = a[3] * x;
        out[4] = a[4] * y; out[5] = a[5] * y; out[6] = a[6] * y; out[7] = a[7] * y;
        out[8] = a[8] * z; out[9] = a[9] * z; out[10] = a[10] * z; out[11] = a[11] * z;
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        return out;
    },

    rotateX: (out, a, rad) => {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        if (a !== out) {
            out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
            out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        }
        out[4] = a10 * c + a20 * s; out[5] = a11 * c + a21 * s;
        out[6] = a12 * c + a22 * s; out[7] = a13 * c + a23 * s;
        out[8] = a20 * c - a10 * s; out[9] = a21 * c - a11 * s;
        out[10] = a22 * c - a12 * s; out[11] = a23 * c - a13 * s;
        return out;
    },

    rotateY: (out, a, rad) => {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        if (a !== out) {
            out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
            out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        }
        out[0] = a00 * c - a20 * s; out[1] = a01 * c - a21 * s;
        out[2] = a02 * c - a22 * s; out[3] = a03 * c - a23 * s;
        out[8] = a00 * s + a20 * c; out[9] = a01 * s + a21 * c;
        out[10] = a02 * s + a22 * c; out[11] = a03 * s + a23 * c;
        return out;
    },

    rotateZ: (out, a, rad) => {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        if (a !== out) {
            out[8] = a[8]; out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
            out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        }
        out[0] = a00 * c + a10 * s; out[1] = a01 * c + a11 * s;
        out[2] = a02 * c + a12 * s; out[3] = a03 * c + a13 * s;
        out[4] = a10 * c - a00 * s; out[5] = a11 * c - a01 * s;
        out[6] = a12 * c - a02 * s; out[7] = a13 * c - a03 * s;
        return out;
    },

    fromRotationTranslationScale: (out, rotation, translation, scale) => {
        // Euler rotation in radians (XYZ order)
        const rx = rotation[0], ry = rotation[1], rz = rotation[2];
        const sx = scale[0], sy = scale[1], sz = scale[2];
        const tx = translation[0], ty = translation[1], tz = translation[2];

        const cx = Math.cos(rx), sx_ = Math.sin(rx);
        const cy = Math.cos(ry), sy_ = Math.sin(ry);
        const cz = Math.cos(rz), sz_ = Math.sin(rz);

        out[0] = cy * cz * sx;
        out[1] = cy * sz_ * sx;
        out[2] = -sy_ * sx;
        out[3] = 0;

        out[4] = (sx_ * sy_ * cz - cx * sz_) * sy;
        out[5] = (sx_ * sy_ * sz_ + cx * cz) * sy;
        out[6] = sx_ * cy * sy;
        out[7] = 0;

        out[8] = (cx * sy_ * cz + sx_ * sz_) * sz;
        out[9] = (cx * sy_ * sz_ - sx_ * cz) * sz;
        out[10] = cx * cy * sz;
        out[11] = 0;

        out[12] = tx;
        out[13] = ty;
        out[14] = tz;
        out[15] = 1;

        return out;
    },

    invert: (out, a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det) return null;
        det = 1.0 / det;

        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

        return out;
    },

    transpose: (out, a) => {
        if (out === a) {
            const a01 = a[1], a02 = a[2], a03 = a[3];
            const a12 = a[6], a13 = a[7], a23 = a[11];
            out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
            out[4] = a01; out[6] = a[9]; out[7] = a[13];
            out[8] = a02; out[9] = a12; out[11] = a[14];
            out[12] = a03; out[13] = a13; out[14] = a23;
        } else {
            out[0] = a[0]; out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
            out[4] = a[1]; out[5] = a[5]; out[6] = a[9]; out[7] = a[13];
            out[8] = a[2]; out[9] = a[6]; out[10] = a[10]; out[11] = a[14];
            out[12] = a[3]; out[13] = a[7]; out[14] = a[11]; out[15] = a[15];
        }
        return out;
    },

    perspective: (out, fovy, aspect, near, far) => {
        const f = 1.0 / Math.tan(fovy / 2);
        out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[11] = -1;
        out[12] = 0; out[13] = 0; out[15] = 0;
        if (far !== null && far !== Infinity) {
            const nf = 1 / (near - far);
            out[10] = (far + near) * nf;
            out[14] = 2 * far * near * nf;
        } else {
            out[10] = -1;
            out[14] = -2 * near;
        }
        return out;
    },

    ortho: (out, left, right, bottom, top, near, far) => {
        const lr = 1 / (left - right);
        const bt = 1 / (bottom - top);
        const nf = 1 / (near - far);
        out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
        out[12] = (left + right) * lr;
        out[13] = (top + bottom) * bt;
        out[14] = (far + near) * nf;
        out[15] = 1;
        return out;
    },

    lookAt: (out, eye, center, up) => {
        const eyex = eye[0], eyey = eye[1], eyez = eye[2];
        const centerx = center[0], centery = center[1], centerz = center[2];
        const upx = up[0], upy = up[1], upz = up[2];

        let z0 = eyex - centerx, z1 = eyey - centery, z2 = eyez - centerz;
        let len = z0 * z0 + z1 * z1 + z2 * z2;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            z0 *= len; z1 *= len; z2 *= len;
        }

        let x0 = upy * z2 - upz * z1;
        let x1 = upz * z0 - upx * z2;
        let x2 = upx * z1 - upy * z0;
        len = x0 * x0 + x1 * x1 + x2 * x2;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            x0 *= len; x1 *= len; x2 *= len;
        }

        const y0 = z1 * x2 - z2 * x1;
        const y1 = z2 * x0 - z0 * x2;
        const y2 = z0 * x1 - z1 * x0;

        out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
        out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
        out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
        out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
        out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
        out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
        out[15] = 1;

        return out;
    },

    // Extract normal matrix (inverse transpose of upper-left 3x3)
    normalFromMat4: (out, a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2];
        const a10 = a[4], a11 = a[5], a12 = a[6];
        const a20 = a[8], a21 = a[9], a22 = a[10];

        const b00 = a11 * a22 - a12 * a21;
        const b01 = a12 * a20 - a10 * a22;
        const b02 = a10 * a21 - a11 * a20;
        const b10 = a02 * a21 - a01 * a22;
        const b11 = a00 * a22 - a02 * a20;
        const b12 = a01 * a20 - a00 * a21;
        const b20 = a01 * a12 - a02 * a11;
        const b21 = a02 * a10 - a00 * a12;
        const b22 = a00 * a11 - a01 * a10;

        let det = a00 * b00 + a01 * b01 + a02 * b02;
        if (!det) return null;
        det = 1.0 / det;

        out[0] = b00 * det; out[1] = b10 * det; out[2] = b20 * det;
        out[3] = b01 * det; out[4] = b11 * det; out[5] = b21 * det;
        out[6] = b02 * det; out[7] = b12 * det; out[8] = b22 * det;

        return out;
    }
};

// Matrix 3x3 Operations
export const mat3 = {
    create: () => {
        const out = new Float32Array(9);
        out[0] = 1; out[4] = 1; out[8] = 1;
        return out;
    }
};

// Utility Functions
export const degToRad = (deg) => deg * Math.PI / 180;
export const radToDeg = (rad) => rad * 180 / Math.PI;
export const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
export const lerp = (a, b, t) => a + t * (b - a);
export const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};

// Color utilities
export const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
    ] : [1, 1, 1];
};

export const rgbToHex = (r, g, b) => {
    return '#' + [r, g, b].map(x => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
};
