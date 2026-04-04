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

            // Show warning if recovering from a quality-change crash
            if (this.renderer.crashRecovery) {
                this.showWarning(
                    `Your device doesn't have enough GPU memory for "${this.renderer.crashRecovery}" quality. ` +
                    `Reverted to "${this.renderer.quality}".`
                );
            }

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

    createOverlay(type, title, message, hint) {
        const div = document.createElement('div');
        div.className = `overlay-dialog ${type}`;

        const h2 = document.createElement('h2');
        h2.textContent = title;

        const p = document.createElement('p');
        p.textContent = message;

        const small = document.createElement('p');
        small.className = 'hint';
        small.textContent = hint;

        div.append(h2, p, small);
        document.body.appendChild(div);
        return div;
    }

    showError(message) {
        this.createOverlay(
            'error', 'WebGL2 Error', message,
            'Please ensure your browser supports WebGL2 and hardware acceleration is enabled.'
        );
    }

    showWarning(message) {
        const div = this.createOverlay(
            'warning', 'GPU Memory Warning', message,
            'Tap anywhere to dismiss.'
        );
        div.addEventListener('click', () => div.remove());
    }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new Application());
} else {
    new Application();
}
