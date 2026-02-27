/*
    Main Application Entry Point
    WebGL2 Lighting Playground
*/

import { Renderer } from './renderer.js';
import { Camera, OrbitControls } from './camera.js';
import { createDefaultScene } from './scene.js';
import { UIController } from './ui.js';
import { ToolController } from './tools.js';

class Application {
    constructor() {
        this.canvas = document.getElementById('gl-canvas');
        this.renderer = null;
        this.camera = null;
        this.controls = null;
        this.scene = null;
        this.ui = null;

        // FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.fps = 60;

        // Animation
        this.isRunning = false;
        this.lastTime = 0;

        this.init();
    }

    async init() {
        try {
            // Initialize renderer
            this.renderer = new Renderer(this.canvas);

            // Initialize camera
            this.camera = new Camera();
            this.camera.lookAt([8, 6, 12], [0, 0, 0]);

            // Initialize orbit controls
            this.controls = new OrbitControls(this.camera, this.canvas);

            // Create default scene
            this.scene = createDefaultScene();

            // Initialize UI with controls reference for camera reset
            this.ui = new UIController(this.scene, this.renderer, this.controls);

            // Initialize tool system (select, move, rotate, scale)
            this.toolController = new ToolController(this.canvas, this.camera, this.scene, this.controls, this.ui);
            this.renderer.toolController = this.toolController;
            this.ui.onToolChanged = (tool) => this.toolController.setTool(tool);

            // Select the Sun (first light) by default so there's always something in the properties panel
            if (this.scene.lights.length > 0) {
                this.scene.selectEntity(this.scene.lights[0]);
                this.ui.refreshSceneList();
            }

            // Handle window resize
            window.addEventListener('resize', () => this.onResize());
            this.onResize();

            // Start render loop
            this.start();

            console.log('WebGL2 Lighting Playground initialized successfully');

        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showError(error.message);
        }
    }

    onResize() {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        // Set canvas resolution to match display size exactly (no DPR scaling)
        this.canvas.width = width;
        this.canvas.height = height;

        // Update renderer viewport to match canvas size
        this.renderer.resize(width, height);

        // Update camera aspect ratio
        this.camera.setAspect(width, height);
        this.camera.update();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    stop() {
        this.isRunning = false;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        this.lastTime = timestamp;

        // Update controls
        this.controls.update();

        // Render scene
        this.renderer.render(this.scene, this.camera);

        // Update FPS counter
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            this.fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
            this.frameCount = 0;
            this.lastFpsTime = now;

            // Update UI stats
            this.ui.updateStats(this.fps, this.renderer.stats.drawCalls);
        }

        // Continue loop
        requestAnimationFrame((t) => this.loop(t));
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1a1a2e;
            color: #ef4444;
            padding: 24px 32px;
            border-radius: 8px;
            border: 1px solid #ef4444;
            font-family: 'JetBrains Mono', monospace;
            text-align: center;
            z-index: 1000;
            max-width: 500px;
        `;
        const heading = document.createElement('h2');
        heading.style.cssText = 'margin: 0 0 12px 0; font-size: 18px;';
        heading.textContent = 'WebGL2 Error';

        const msg = document.createElement('p');
        msg.style.cssText = 'margin: 0; font-size: 14px; color: #ccc;';
        msg.textContent = message;

        const hint = document.createElement('p');
        hint.style.cssText = 'margin: 16px 0 0 0; font-size: 12px; color: #888;';
        hint.textContent = 'Please ensure your browser supports WebGL2 and hardware acceleration is enabled.';

        errorDiv.appendChild(heading);
        errorDiv.appendChild(msg);
        errorDiv.appendChild(hint);
        document.body.appendChild(errorDiv);
    }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new Application());
} else {
    new Application();
}
