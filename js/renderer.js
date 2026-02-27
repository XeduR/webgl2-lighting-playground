/*
    WebGL2 Renderer - ADDITIVE COLORED LIGHT MODEL

    Key features:
    1. Transmission uses ADDITIVE blending (colored lights ADD together)
    2. Alpha channel tracks coverage for proper edge blending
    3. Areas without translucent objects pass full white light
*/

import { mat4, vec3 } from "./math.js";
import {
    createProgram,
    getUniformLocations,
    getAttributeLocations,
    createDepthFramebuffer,
    createTransmissionFramebuffer,
    getGLCapabilities
} from "./gl-utils.js";
import { GeometryCache, createMeshVAO } from "./geometry.js";
import { LightType } from "./scene.js";
import * as Shaders from "./shaders.js";

export const QualityPresets = {
    low: { shadowMapSize: 512, softShadows: false, transmissionEnabled: true },
    medium: { shadowMapSize: 1024, softShadows: true, transmissionEnabled: true },
    high: { shadowMapSize: 2048, softShadows: true, transmissionEnabled: true },
    ultra: { shadowMapSize: 4096, softShadows: true, transmissionEnabled: true }
};

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2", {
            antialias: true, alpha: false, depth: true, stencil: false
        });

        if (!this.gl) throw new Error("WebGL2 not supported");

        this.contextLost = false;
        canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this.contextLost = true;
            console.warn("WebGL context lost");
        });
        canvas.addEventListener("webglcontextrestored", () => {
            console.log("WebGL context restored, reinitializing");
            this.contextLost = false;
            this.initialize();
        });

        // Activate float texture support (required for R32F point shadow atlas)
        this.gl.getExtension("EXT_color_buffer_float");

        this.capabilities = getGLCapabilities(this.gl);

        this.quality = "high";
        this.softShadows = true;
        this.transmissionEnabled = true;

        this.programs = {};
        this.geometryCache = null;
        this.vaos = new Map();

        // Shadow resources
        this.shadowFramebuffers = [];
        this.transmissionFramebuffers = [];
        this.pointShadowFramebuffers = [];
        this.pointTransmissionFramebuffers = [];
        this.currentShadowMapSize = 1024;

        this.stats = { drawCalls: 0, triangles: 0 };

        // Reusable scratch buffers to avoid per-frame allocations
        this._scratchLightDir = vec3.create();
        this._scratchModel = mat4.create();
        this._scratchProj = mat4.create();
        this._scratchView = mat4.create();
        this._scratchTarget = vec3.create();

        this.toolController = null;

        this.initialize();
    }

    initialize() {
        const gl = this.gl;

        this.programs.main = this.createMainProgram();
        this.programs.shadow = this.createShadowProgram();
        this.programs.transmission = this.createTransmissionProgram();
        this.programs.pointShadow = this.createPointShadowProgram();
        this.programs.pointTransmission = this.createPointTransmissionProgram();
        this.programs.lightVis = this.createLightVisProgram();
        this.programs.gizmo = this.createGizmoProgram();

        this.geometryCache = new GeometryCache(gl);
        this.createVAOs();
        this.createShadowResources(4, 2);
        this.createLightGeometry();

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.clearColor(0.05, 0.05, 0.07, 1.0);
    }

    createMainProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.MAIN_VERTEX_SHADER, Shaders.MAIN_FRAGMENT_SHADER);

        const uniforms = [
            "uModelMatrix", "uViewMatrix", "uProjectionMatrix", "uNormalMatrix",
            "uColor", "uOpacity", "uSpecular", "uRoughness", "uCameraPosition",
            "uAmbientColor", "uAmbientIntensity", "uNumLights",
            "uShadowMatrix0", "uShadowMatrix1", "uShadowMatrix2", "uShadowMatrix3",
            "uNumDirSpotShadows", "uShadowMap0", "uShadowMap1", "uShadowMap2", "uShadowMap3",
            "uTransmissionEnabled", "uTransmissionMap0", "uTransmissionMap1", "uTransmissionMap2", "uTransmissionMap3",
            "uTransmissionDepth0", "uTransmissionDepth1", "uTransmissionDepth2", "uTransmissionDepth3",
            "uNumPointShadows", "uPointShadowMap0", "uPointShadowMap1",
            "uPointTransmissionMap0", "uPointTransmissionMap1",
            "uSoftShadows"
        ];

        for (let i = 0; i < 16; i++) {
            uniforms.push(
                `uLightTypes[${i}]`, `uLightPositions[${i}]`, `uLightDirections[${i}]`,
                `uLightColors[${i}]`, `uLightIntensities[${i}]`, `uLightRanges[${i}]`,
                `uLightInnerAngles[${i}]`, `uLightOuterAngles[${i}]`
            );
        }

        for (let i = 0; i < 4; i++) {
            uniforms.push(`uShadowBias[${i}]`, `uShadowLightIndex[${i}]`);
        }
        for (let i = 0; i < 2; i++) {
            uniforms.push(`uPointFarPlane[${i}]`, `uPointShadowPos[${i}]`, `uPointShadowLightIndex[${i}]`);
        }

        return {
            program,
            uniforms: getUniformLocations(gl, program, uniforms),
            attributes: getAttributeLocations(gl, program, ["aPosition", "aNormal", "aUV"])
        };
    }

    createShadowProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.SHADOW_VERTEX_SHADER, Shaders.SHADOW_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uModelMatrix", "uLightMatrix"]),
            attributes: getAttributeLocations(gl, program, ["aPosition"])
        };
    }

    createTransmissionProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.TRANSMISSION_VERTEX_SHADER, Shaders.TRANSMISSION_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uModelMatrix", "uLightMatrix", "uColor", "uOpacity", "uThickness"]),
            attributes: getAttributeLocations(gl, program, ["aPosition"])
        };
    }

    createPointShadowProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.POINT_SHADOW_VERTEX_SHADER, Shaders.POINT_SHADOW_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uModelMatrix", "uLightViewMatrix", "uLightProjMatrix", "uLightPosition", "uFarPlane"]),
            attributes: getAttributeLocations(gl, program, ["aPosition"])
        };
    }

    createPointTransmissionProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.POINT_TRANSMISSION_VERTEX_SHADER, Shaders.POINT_TRANSMISSION_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uModelMatrix", "uLightViewMatrix", "uLightProjMatrix", "uColor", "uOpacity", "uThickness"]),
            attributes: getAttributeLocations(gl, program, ["aPosition"])
        };
    }

    createLightVisProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.LIGHT_VIS_VERTEX_SHADER, Shaders.LIGHT_VIS_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uViewMatrix", "uProjectionMatrix", "uModelMatrix", "uScale", "uLightColor"]),
            attributes: getAttributeLocations(gl, program, ["aPosition"])
        };
    }

    createGizmoProgram() {
        const gl = this.gl;
        const program = createProgram(gl, Shaders.GIZMO_VERTEX_SHADER, Shaders.GIZMO_FRAGMENT_SHADER);
        return {
            program,
            uniforms: getUniformLocations(gl, program, ["uViewMatrix", "uProjectionMatrix", "uModelMatrix"]),
            attributes: getAttributeLocations(gl, program, ["aPosition", "aColor"])
        };
    }

    createVAOs() {
        const types = ["cube", "sphere", "plane"];
        for (const type of types) {
            const buffers = this.geometryCache.get(type);
            const mainVAO = createMeshVAO(this.gl, buffers, {
                position: this.programs.main.attributes.aPosition,
                normal: this.programs.main.attributes.aNormal,
                uv: this.programs.main.attributes.aUV
            });
            const shadowVAO = createMeshVAO(this.gl, buffers, {
                position: this.programs.shadow.attributes.aPosition,
                normal: -1, uv: -1
            });
            this.vaos.set(type, { main: mainVAO, shadow: shadowVAO, buffers });
        }
    }

    createShadowResources(maxDirSpot, maxPoint) {
        const gl = this.gl;
        const size = QualityPresets[this.quality].shadowMapSize;
        this.currentShadowMapSize = size;

        // Cleanup old
        this.shadowFramebuffers.forEach(fb => {
            gl.deleteFramebuffer(fb.framebuffer);
            gl.deleteTexture(fb.depthTexture);
        });
        this.transmissionFramebuffers.forEach(fb => {
            gl.deleteFramebuffer(fb.framebuffer);
            gl.deleteTexture(fb.transmissionTexture);
            if (fb.depthTexture) gl.deleteTexture(fb.depthTexture);
        });
        this.pointShadowFramebuffers.forEach(fb => {
            gl.deleteFramebuffer(fb.framebuffer);
            gl.deleteTexture(fb.depthTexture);
            if (fb.depthBuffer) gl.deleteRenderbuffer(fb.depthBuffer);
        });
        this.pointTransmissionFramebuffers.forEach(fb => {
            gl.deleteFramebuffer(fb.framebuffer);
            gl.deleteTexture(fb.colorTexture);
            if (fb.depthBuffer) gl.deleteRenderbuffer(fb.depthBuffer);
        });

        this.shadowFramebuffers = [];
        this.transmissionFramebuffers = [];
        this.pointShadowFramebuffers = [];
        this.pointTransmissionFramebuffers = [];

        for (let i = 0; i < maxDirSpot; i++) {
            this.shadowFramebuffers.push(createDepthFramebuffer(gl, size, size));
            this.transmissionFramebuffers.push(createTransmissionFramebuffer(gl, size, size));
        }

        for (let i = 0; i < maxPoint; i++) {
            this.pointShadowFramebuffers.push(this.createPointShadowAtlas(size));
            this.pointTransmissionFramebuffers.push(this.createPointTransmissionAtlas(size));
        }
    }

    createPointShadowAtlas(faceSize) {
        const gl = this.gl;
        const width = faceSize * 3, height = faceSize * 2;

        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        const depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, depthTexture, 0);

        const depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { framebuffer, depthTexture, depthBuffer, width, height, faceSize };
    }

    createPointTransmissionAtlas(faceSize) {
        const gl = this.gl;
        const width = faceSize * 3, height = faceSize * 2;

        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        const colorTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

        const depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { framebuffer, colorTexture, depthBuffer, width, height, faceSize };
    }

    createLightGeometry() {
        const gl = this.gl;

        // Point light sphere
        const sphereVerts = [], sphereIdx = [];
        const segs = 12, rings = 6, r = 0.15;
        for (let ring = 0; ring <= rings; ring++) {
            const theta = ring * Math.PI / rings;
            for (let seg = 0; seg <= segs; seg++) {
                const phi = seg * 2 * Math.PI / segs;
                sphereVerts.push(
                    Math.cos(phi) * Math.sin(theta) * r,
                    Math.cos(theta) * r,
                    Math.sin(phi) * Math.sin(theta) * r
                );
            }
        }
        for (let ring = 0; ring < rings; ring++) {
            for (let seg = 0; seg < segs; seg++) {
                const first = ring * (segs + 1) + seg;
                sphereIdx.push(first, first + segs + 1, first + 1, first + segs + 1, first + segs + 2, first + 1);
            }
        }

        this.lightSphere = this.createSimpleVAO(sphereVerts, sphereIdx);
        this.lightSphereCount = sphereIdx.length;

        // Spotlight cone
        const coneHeight = 0.5, coneRadius = 0.25;
        const coneSegments = 16;
        const coneVerts = [0, 0, 0];
        const coneIdx = [];

        for (let i = 0; i < coneSegments; i++) {
            const angle = (i / coneSegments) * Math.PI * 2;
            coneVerts.push(
                Math.cos(angle) * coneRadius,
                Math.sin(angle) * coneRadius,
                -coneHeight
            );
        }
        const baseCenterIdx = coneSegments + 1;
        coneVerts.push(0, 0, -coneHeight);

        for (let i = 0; i < coneSegments; i++) {
            const next = (i + 1) % coneSegments;
            coneIdx.push(0, i + 1, next + 1);
        }
        for (let i = 0; i < coneSegments; i++) {
            const next = (i + 1) % coneSegments;
            coneIdx.push(baseCenterIdx, next + 1, i + 1);
        }

        this.spot = this.createSimpleVAO(coneVerts, coneIdx);
        this.spotCount = coneIdx.length;

        // Sun star
        const sunVerts = [], sunIdx = [];
        const rays = 8, inner = 0.08, outer = 0.25;
        for (let i = 0; i < rays * 2; i++) {
            const angle = i * Math.PI / rays;
            const rad = i % 2 === 0 ? outer : inner;
            sunVerts.push(Math.cos(angle) * rad, Math.sin(angle) * rad, 0);
        }
        sunVerts.push(0, 0, 0);
        for (let i = 0; i < rays * 2; i++) {
            sunIdx.push(rays * 2, i, (i + 1) % (rays * 2));
        }
        this.sun = this.createSimpleVAO(sunVerts, sunIdx);
        this.sunCount = sunIdx.length;
    }

    createSimpleVAO(verts, indices) {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        const vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.programs.lightVis.attributes.aPosition);
        gl.vertexAttribPointer(this.programs.lightVis.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);

        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        gl.bindVertexArray(null);
        return { vao, vb, ib };
    }

    setQuality(preset) {
        if (this.quality === preset) return;
        this.quality = preset;
        this.transmissionEnabled = QualityPresets[preset].transmissionEnabled;
        if (this.currentShadowMapSize !== QualityPresets[preset].shadowMapSize) {
            this.createShadowResources(4, 2);
        }
    }

    resize(width, height) {
        // Don't modify canvas size here - that's handled in main.js
        // Just update the WebGL viewport
        this.gl.viewport(0, 0, width, height);
    }

    render(scene, camera) {
        if (this.contextLost) return;
        const gl = this.gl;
        this.stats.drawCalls = 0;
        this.stats.triangles = 0;

        scene.updateTransforms();
        camera.update();

        const allLights = scene.getVisibleLights();
        const shadowLights = allLights.filter(l => l.castShadow);
        const dirSpotShadows = shadowLights.filter(l => l.lightType !== LightType.POINT).slice(0, 4);
        const pointShadows = shadowLights.filter(l => l.lightType === LightType.POINT).slice(0, 2);

        scene.calculateBounds();
        const center = scene.getCenter();
        const radius = Math.max(scene.getRadius(), 10);

        dirSpotShadows.forEach(l => l.updateShadowMatrices(center, radius));

        // Render shadow passes
        if (dirSpotShadows.length > 0) {
            this.renderOpaqueShadows(scene, dirSpotShadows);
            if (this.transmissionEnabled) {
                this.renderTransmission(scene, dirSpotShadows);
            }
        }

        if (pointShadows.length > 0) {
            this.renderPointShadows(scene, pointShadows);
            if (this.transmissionEnabled) {
                this.renderPointTransmission(scene, pointShadows);
            }
        }

        // Main pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.renderScene(scene, camera, allLights, dirSpotShadows, pointShadows);
        this.renderLightVis(scene, camera);

        // Render tool gizmos on top
        if (this.toolController) {
            this.toolController.renderGizmo(gl, this.programs.gizmo, camera);
        }
    }

    // Render shadow depth map for OPAQUE objects only (opacity >= 1.0)
    renderOpaqueShadows(scene, lights) {
        const gl = this.gl;
        const prog = this.programs.shadow;
        gl.useProgram(prog.program);
        // Render back faces into shadow map to reduce shadow acne on front faces
        gl.cullFace(gl.FRONT);

        const opaqueShadowCasters = scene.objects.filter(o =>
            o.visible && o.castShadow && o.material.opacity >= 1.0
        );

        for (let i = 0; i < lights.length; i++) {
            const fb = this.shadowFramebuffers[i];
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
            gl.viewport(0, 0, fb.width, fb.height);
            gl.clear(gl.DEPTH_BUFFER_BIT);
            gl.uniformMatrix4fv(prog.uniforms.uLightMatrix, false, lights[i].shadowMatrix);

            for (const obj of opaqueShadowCasters) {
                const vao = this.vaos.get(obj.geometryType);
                gl.bindVertexArray(vao.shadow);
                gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                this.stats.drawCalls++;
            }
        }

        gl.cullFace(gl.BACK);
        gl.bindVertexArray(null);
    }

    /**
     * Render transmission for translucent objects only.
     *
     * Uses separate blend functions:
     * - RGB: additive (colors mix together)
     * - Alpha: multiplicative (transmittances multiply for proper attenuation)
     *
     * Clear color is (0,0,0,1) meaning no color, full light passes.
     * As objects are rendered:
     * - RGB accumulates colored light contributions
     * - Alpha multiplies down (0.5 * 0.5 = 0.25 means only 25% light passes)
     *
     * SEPARATE SHADOW MODEL: Only translucent objects (opacity < 1.0) go through
     * the transmission system. Opaque blocking is handled by the separate depth-only
     * shadow map. The main shader multiplies both factors together.
     */
    renderTransmission(scene, lights) {
        const gl = this.gl;
        const prog = this.programs.transmission;
        gl.useProgram(prog.program);

        // Only include TRANSLUCENT shadow-casting objects in transmission rendering.
        // Opaque blocking is handled separately by the depth-only shadow map.
        const shadowCasters = scene.objects.filter(o =>
            o.visible && o.castShadow && o.material.opacity > 0.001 && o.material.opacity < 1.0
        );

        if (shadowCasters.length === 0) {
            for (let i = 0; i < lights.length; i++) {
                const fb = this.transmissionFramebuffers[i];
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
                gl.viewport(0, 0, fb.width, fb.height);
                // Clear: no color (0,0,0), full transmittance (1.0)
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
            gl.clearColor(0.05, 0.05, 0.07, 1.0);
            return;
        }

        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];
            const fb = this.transmissionFramebuffers[i];

            gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
            gl.viewport(0, 0, fb.width, fb.height);
            // Clear: no color (0,0,0), full transmittance (1.0)
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.uniformMatrix4fv(prog.uniforms.uLightMatrix, false, light.shadowMatrix);

            // PASS 1: Depth only - get closest object depth
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
            gl.depthMask(true);
            gl.colorMask(false, false, false, false);

            for (const obj of shadowCasters) {
                const vao = this.vaos.get(obj.geometryType);
                gl.bindVertexArray(vao.shadow);
                gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                gl.uniform3fv(prog.uniforms.uColor, obj.material.color);
                gl.uniform1f(prog.uniforms.uOpacity, obj.material.opacity);
                gl.uniform1f(prog.uniforms.uThickness, obj.material.thickness);
                gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                this.stats.drawCalls++;
            }

            // PASS 2: Color and transmittance accumulation
            // RGB: additive (ONE, ONE) - colors add together
            // Alpha: multiplicative (DST_ALPHA, ZERO) - transmittances multiply
            gl.colorMask(true, true, true, true);
            gl.depthMask(false);
            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            // Separate blend: RGB adds, Alpha multiplies
            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.DST_ALPHA, gl.ZERO);
            gl.blendEquation(gl.FUNC_ADD);

            for (const obj of shadowCasters) {
                const vao = this.vaos.get(obj.geometryType);
                gl.bindVertexArray(vao.shadow);
                gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                gl.uniform3fv(prog.uniforms.uColor, obj.material.color);
                gl.uniform1f(prog.uniforms.uOpacity, obj.material.opacity);
                gl.uniform1f(prog.uniforms.uThickness, obj.material.thickness);
                gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                this.stats.drawCalls++;
            }

            gl.depthMask(true);
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ZERO); // Reset to default
        }

        gl.clearColor(0.05, 0.05, 0.07, 1.0);
        gl.bindVertexArray(null);
    }

    // Render point light shadows for OPAQUE objects only
    renderPointShadows(scene, lights) {
        const gl = this.gl;
        const prog = this.programs.pointShadow;
        gl.useProgram(prog.program);

        const faces = [
            { dir: [1,0,0], up: [0,-1,0] }, { dir: [-1,0,0], up: [0,-1,0] },
            { dir: [0,1,0], up: [0,0,1] }, { dir: [0,-1,0], up: [0,0,-1] },
            { dir: [0,0,1], up: [0,-1,0] }, { dir: [0,0,-1], up: [0,-1,0] }
        ];

        const shadowCasters = scene.objects.filter(o =>
            o.visible && o.castShadow && o.material.opacity >= 1.0
        );

        const projMat = this._scratchProj;
        const viewMat = this._scratchView;
        const target = this._scratchTarget;

        for (let li = 0; li < lights.length; li++) {
            const light = lights[li];
            const fb = this.pointShadowFramebuffers[li];
            const far = light.range;

            gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
            // R32F atlas: 1.0 = maximum distance (no occluder)
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.uniform3fv(prog.uniforms.uLightPosition, light.transform.position);
            gl.uniform1f(prog.uniforms.uFarPlane, far);

            mat4.perspective(projMat, Math.PI / 2, 1, 0.1, far);
            gl.uniformMatrix4fv(prog.uniforms.uLightProjMatrix, false, projMat);

            for (let f = 0; f < 6; f++) {
                gl.viewport((f % 3) * fb.faceSize, Math.floor(f / 3) * fb.faceSize, fb.faceSize, fb.faceSize);

                vec3.add(target, light.transform.position, faces[f].dir);
                mat4.lookAt(viewMat, light.transform.position, target, faces[f].up);
                gl.uniformMatrix4fv(prog.uniforms.uLightViewMatrix, false, viewMat);

                for (const obj of shadowCasters) {
                    const vao = this.vaos.get(obj.geometryType);
                    gl.bindVertexArray(vao.shadow);
                    gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                    gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                    this.stats.drawCalls++;
                }
            }
        }

        gl.clearColor(0.05, 0.05, 0.07, 1.0);
        gl.bindVertexArray(null);
    }

    /**
     * Render point light transmission for TRANSLUCENT shadow-casting objects only.
     * Uses same model as directional: RGB additive, Alpha multiplicative.
     * Opaque blocking is handled by the separate point shadow depth map.
     */
    renderPointTransmission(scene, lights) {
        const gl = this.gl;
        const prog = this.programs.pointTransmission;
        gl.useProgram(prog.program);

        const faces = [
            { dir: [1,0,0], up: [0,-1,0] }, { dir: [-1,0,0], up: [0,-1,0] },
            { dir: [0,1,0], up: [0,0,1] }, { dir: [0,-1,0], up: [0,0,-1] },
            { dir: [0,0,1], up: [0,-1,0] }, { dir: [0,0,-1], up: [0,-1,0] }
        ];

        // Only include TRANSLUCENT shadow-casting objects.
        // Opaque blocking is handled by the separate point shadow depth map.
        const shadowCasters = scene.objects.filter(o =>
            o.visible && o.castShadow && o.material.opacity > 0.001 && o.material.opacity < 1.0
        );

        const projMat = this._scratchProj;
        const viewMat = this._scratchView;
        const target = this._scratchTarget;

        for (let li = 0; li < lights.length; li++) {
            const light = lights[li];
            const fb = this.pointTransmissionFramebuffers[li];
            const far = light.range;

            gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
            // Clear: no color (0,0,0), full transmittance (1.0)
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            if (shadowCasters.length === 0) continue;

            mat4.perspective(projMat, Math.PI / 2, 1, 0.1, far);
            gl.uniformMatrix4fv(prog.uniforms.uLightProjMatrix, false, projMat);

            for (let f = 0; f < 6; f++) {
                gl.viewport((f % 3) * fb.faceSize, Math.floor(f / 3) * fb.faceSize, fb.faceSize, fb.faceSize);

                vec3.add(target, light.transform.position, faces[f].dir);
                mat4.lookAt(viewMat, light.transform.position, target, faces[f].up);
                gl.uniformMatrix4fv(prog.uniforms.uLightViewMatrix, false, viewMat);

                // PASS 1: Depth only
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LESS);
                gl.depthMask(true);
                gl.colorMask(false, false, false, false);

                for (const obj of shadowCasters) {
                    const vao = this.vaos.get(obj.geometryType);
                    gl.bindVertexArray(vao.shadow);
                    gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                    gl.uniform3fv(prog.uniforms.uColor, obj.material.color);
                    gl.uniform1f(prog.uniforms.uOpacity, obj.material.opacity);
                    gl.uniform1f(prog.uniforms.uThickness, obj.material.thickness);
                    gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                    this.stats.drawCalls++;
                }

                // PASS 2: Color and transmittance accumulation
                gl.colorMask(true, true, true, true);
                gl.depthMask(false);
                gl.disable(gl.DEPTH_TEST);
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.DST_ALPHA, gl.ZERO);
                gl.blendEquation(gl.FUNC_ADD);

                for (const obj of shadowCasters) {
                    const vao = this.vaos.get(obj.geometryType);
                    gl.bindVertexArray(vao.shadow);
                    gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
                    gl.uniform3fv(prog.uniforms.uColor, obj.material.color);
                    gl.uniform1f(prog.uniforms.uOpacity, obj.material.opacity);
                    gl.uniform1f(prog.uniforms.uThickness, obj.material.thickness);
                    gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
                    this.stats.drawCalls++;
                }

                gl.depthMask(true);
                gl.enable(gl.DEPTH_TEST);
                gl.disable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ZERO);
            }
        }

        gl.clearColor(0.05, 0.05, 0.07, 1.0);
        gl.bindVertexArray(null);
    }

    renderScene(scene, camera, allLights, dirSpotShadows, pointShadows) {
        const gl = this.gl;
        const prog = this.programs.main;
        gl.useProgram(prog.program);

        gl.uniformMatrix4fv(prog.uniforms.uViewMatrix, false, camera.viewMatrix);
        gl.uniformMatrix4fv(prog.uniforms.uProjectionMatrix, false, camera.projectionMatrix);
        gl.uniform3fv(prog.uniforms.uCameraPosition, camera.position);

        gl.uniform3fv(prog.uniforms.uAmbientColor, scene.ambientColor);
        gl.uniform1f(prog.uniforms.uAmbientIntensity, scene.ambientIntensity);

        const numLights = Math.min(allLights.length, 16);
        gl.uniform1i(prog.uniforms.uNumLights, numLights);

        const lightDir = this._scratchLightDir;
        for (let i = 0; i < numLights; i++) {
            const l = allLights[i];
            const t = l.lightType === LightType.DIRECTIONAL ? 0 : l.lightType === LightType.POINT ? 1 : 2;

            gl.uniform1i(prog.uniforms[`uLightTypes[${i}]`], t);
            gl.uniform3fv(prog.uniforms[`uLightPositions[${i}]`], l.transform.position);
            l.getDirection(lightDir);
            gl.uniform3fv(prog.uniforms[`uLightDirections[${i}]`], lightDir);
            gl.uniform3fv(prog.uniforms[`uLightColors[${i}]`], l.color);
            gl.uniform1f(prog.uniforms[`uLightIntensities[${i}]`], l.intensity);
            gl.uniform1f(prog.uniforms[`uLightRanges[${i}]`], l.range);
            gl.uniform1f(prog.uniforms[`uLightInnerAngles[${i}]`], l.innerAngle);
            gl.uniform1f(prog.uniforms[`uLightOuterAngles[${i}]`], l.outerAngle);
        }

        // Shadow setup
        gl.uniform1i(prog.uniforms.uNumDirSpotShadows, dirSpotShadows.length);
        gl.uniform1i(prog.uniforms.uSoftShadows, this.softShadows ? 1 : 0);
        gl.uniform1i(prog.uniforms.uTransmissionEnabled, this.transmissionEnabled ? 1 : 0);

        const shadowMaps = ["uShadowMap0", "uShadowMap1", "uShadowMap2", "uShadowMap3"];
        const transMaps = ["uTransmissionMap0", "uTransmissionMap1", "uTransmissionMap2", "uTransmissionMap3"];
        const transDepths = ["uTransmissionDepth0", "uTransmissionDepth1", "uTransmissionDepth2", "uTransmissionDepth3"];
        const shadowMats = ["uShadowMatrix0", "uShadowMatrix1", "uShadowMatrix2", "uShadowMatrix3"];

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.shadowFramebuffers[i]?.depthTexture || null);
            gl.uniform1i(prog.uniforms[shadowMaps[i]], i);

            gl.activeTexture(gl.TEXTURE4 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.transmissionFramebuffers[i]?.transmissionTexture || null);
            gl.uniform1i(prog.uniforms[transMaps[i]], 4 + i);

            // Bind transmission depth textures (texture units 12-15)
            gl.activeTexture(gl.TEXTURE12 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.transmissionFramebuffers[i]?.depthTexture || null);
            gl.uniform1i(prog.uniforms[transDepths[i]], 12 + i);

            if (i < dirSpotShadows.length) {
                gl.uniformMatrix4fv(prog.uniforms[shadowMats[i]], false, dirSpotShadows[i].shadowMatrix);
                gl.uniform1f(prog.uniforms[`uShadowBias[${i}]`], dirSpotShadows[i].shadowBias);
                gl.uniform1i(prog.uniforms[`uShadowLightIndex[${i}]`], allLights.indexOf(dirSpotShadows[i]));
            } else {
                gl.uniformMatrix4fv(prog.uniforms[shadowMats[i]], false, mat4.create());
                gl.uniform1f(prog.uniforms[`uShadowBias[${i}]`], 0.002);
                gl.uniform1i(prog.uniforms[`uShadowLightIndex[${i}]`], -1);
            }
        }

        // Point shadows and transmission
        gl.uniform1i(prog.uniforms.uNumPointShadows, pointShadows.length);

        gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D, this.pointShadowFramebuffers[0]?.depthTexture || null);
        gl.uniform1i(prog.uniforms.uPointShadowMap0, 8);

        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_2D, this.pointShadowFramebuffers[1]?.depthTexture || null);
        gl.uniform1i(prog.uniforms.uPointShadowMap1, 9);

        gl.activeTexture(gl.TEXTURE10);
        gl.bindTexture(gl.TEXTURE_2D, this.pointTransmissionFramebuffers[0]?.colorTexture || null);
        gl.uniform1i(prog.uniforms.uPointTransmissionMap0, 10);

        gl.activeTexture(gl.TEXTURE11);
        gl.bindTexture(gl.TEXTURE_2D, this.pointTransmissionFramebuffers[1]?.colorTexture || null);
        gl.uniform1i(prog.uniforms.uPointTransmissionMap1, 11);

        for (let i = 0; i < 2; i++) {
            if (i < pointShadows.length) {
                gl.uniform1f(prog.uniforms[`uPointFarPlane[${i}]`], pointShadows[i].range);
                gl.uniform3fv(prog.uniforms[`uPointShadowPos[${i}]`], pointShadows[i].transform.position);
                gl.uniform1i(prog.uniforms[`uPointShadowLightIndex[${i}]`], allLights.indexOf(pointShadows[i]));
            } else {
                gl.uniform1f(prog.uniforms[`uPointFarPlane[${i}]`], 100);
                gl.uniform3fv(prog.uniforms[`uPointShadowPos[${i}]`], [0, 0, 0]);
                gl.uniform1i(prog.uniforms[`uPointShadowLightIndex[${i}]`], -1);
            }
        }

        // Render objects
        const opaque = scene.objects.filter(o => o.visible && o.material.opacity >= 1.0);
        const translucent = scene.objects.filter(o => o.visible && o.material.opacity < 1.0 && o.material.opacity > 0);

        for (const obj of opaque) {
            this.drawObject(obj, prog);
        }

        if (translucent.length > 0) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);

            translucent.sort((a, b) => {
                const da = vec3.distance(camera.position, a.transform.position);
                const db = vec3.distance(camera.position, b.transform.position);
                return db - da;
            });

            for (const obj of translucent) {
                this.drawObject(obj, prog);
            }

            gl.depthMask(true);
            gl.disable(gl.BLEND);
        }

        gl.bindVertexArray(null);
    }

    drawObject(obj, prog) {
        const gl = this.gl;
        const vao = this.vaos.get(obj.geometryType);
        gl.bindVertexArray(vao.main);

        gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, obj.transform.modelMatrix);
        gl.uniformMatrix3fv(prog.uniforms.uNormalMatrix, false, obj.transform.normalMatrix);
        gl.uniform3fv(prog.uniforms.uColor, obj.material.color);
        gl.uniform1f(prog.uniforms.uOpacity, obj.material.opacity);
        gl.uniform1f(prog.uniforms.uSpecular, obj.material.specular);
        gl.uniform1f(prog.uniforms.uRoughness, obj.material.roughness);

        gl.drawElements(gl.TRIANGLES, vao.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
        this.stats.drawCalls++;
        this.stats.triangles += vao.buffers.vertexCount / 3;
    }

    renderLightVis(scene, camera) {
        const gl = this.gl;
        const prog = this.programs.lightVis;
        gl.useProgram(prog.program);

        gl.uniformMatrix4fv(prog.uniforms.uViewMatrix, false, camera.viewMatrix);
        gl.uniformMatrix4fv(prog.uniforms.uProjectionMatrix, false, camera.projectionMatrix);
        gl.uniform1f(prog.uniforms.uScale, 1.0);

        for (const light of scene.lights) {
            if (!light.visible) continue;
            if (light.lightType === LightType.DIRECTIONAL) continue;

            const model = this._scratchModel;
            mat4.identity(model);
            mat4.translate(model, model, light.transform.position);

            if (light.lightType === LightType.SPOT) {
                mat4.rotateY(model, model, light.transform.rotation[1]);
                mat4.rotateX(model, model, light.transform.rotation[0]);
                mat4.rotateZ(model, model, light.transform.rotation[2]);
            }

            gl.uniformMatrix4fv(prog.uniforms.uModelMatrix, false, model);
            gl.uniform3fv(prog.uniforms.uLightColor, light.color);

            if (light.lightType === LightType.SPOT) {
                gl.bindVertexArray(this.spot.vao);
                gl.drawElements(gl.TRIANGLES, this.spotCount, gl.UNSIGNED_SHORT, 0);
            } else {
                gl.bindVertexArray(this.lightSphere.vao);
                gl.drawElements(gl.TRIANGLES, this.lightSphereCount, gl.UNSIGNED_SHORT, 0);
            }
            this.stats.drawCalls++;
        }

        gl.bindVertexArray(null);
    }

    disposeSimpleVAO(obj) {
        if (!obj) return;
        const gl = this.gl;
        gl.deleteVertexArray(obj.vao);
        gl.deleteBuffer(obj.vb);
        gl.deleteBuffer(obj.ib);
    }

    dispose() {
        const gl = this.gl;
        Object.values(this.programs).forEach(p => p && gl.deleteProgram(p.program));
        this.vaos.forEach(v => { gl.deleteVertexArray(v.main); gl.deleteVertexArray(v.shadow); });
        this.geometryCache?.dispose();
        this.disposeSimpleVAO(this.lightSphere);
        this.disposeSimpleVAO(this.spot);
        this.disposeSimpleVAO(this.sun);
        this.shadowFramebuffers.forEach(fb => { gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.depthTexture); });
        this.transmissionFramebuffers.forEach(fb => { gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.transmissionTexture); });
        this.pointShadowFramebuffers.forEach(fb => { gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.depthTexture); gl.deleteRenderbuffer(fb.depthBuffer); });
        this.pointTransmissionFramebuffers.forEach(fb => { gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.colorTexture); gl.deleteRenderbuffer(fb.depthBuffer); });
    }
}