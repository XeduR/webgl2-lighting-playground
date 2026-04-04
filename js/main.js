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

            // Wire up collapsible side panels (desktop toggle + mobile overlay drawers)
            this.setupPanelToggles();

            // Mobile "use a desktop" banner with dismiss persistence
            this.setupViewportBanner();

            // Swap camera hints to touch instructions on touch-only devices
            this.setupCameraHints();

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

    // Mobile overlay drawers auto-collapse both panels; desktop restores per-side state.
    setupPanelToggles() {
        const app = document.getElementById('app');
        const leftPanel = document.getElementById('left-panel');
        const rightPanel = document.getElementById('right-panel');
        const btnLeft = document.getElementById('btn-toggle-left');
        const btnRight = document.getElementById('btn-toggle-right');
        const backdrop = document.getElementById('panel-backdrop');
        if (!app || !leftPanel || !rightPanel || !btnLeft || !btnRight) return;

        const MOBILE_BP = window.matchMedia('(max-width: 900px)');

        const getDesktopState = (side) =>
            sessionStorage.getItem(`panel-${side}-desktop`) || 'open';

        const setDesktopState = (side, value) => {
            sessionStorage.setItem(`panel-${side}-desktop`, value);
        };

        const updateToggleIcon = (side) => {
            const btn = side === 'left' ? btnLeft : btnRight;
            const collapsed = app.classList.contains(`${side}-collapsed`);
            if (side === 'left') {
                btn.textContent = collapsed ? '\u25B6\uFE0E' : '\u25C0\uFE0E';
                btn.title = collapsed ? 'Show left panel' : 'Hide left panel';
            } else {
                btn.textContent = collapsed ? '\u25C0\uFE0E' : '\u25B6\uFE0E';
                btn.title = collapsed ? 'Show right panel' : 'Hide right panel';
            }
        };

        const updateBackdrop = () => {
            if (!MOBILE_BP.matches) {
                backdrop.classList.remove('visible');
                return;
            }
            const anyOpen =
                !app.classList.contains('left-collapsed') ||
                !app.classList.contains('right-collapsed');
            backdrop.classList.toggle('visible', anyOpen);
        };

        // onResize dispatched after layout changes so WebGL canvas picks up new size.
        const applyState = () => {
            if (MOBILE_BP.matches) {
                app.classList.add('left-collapsed');
                app.classList.add('right-collapsed');
            } else {
                app.classList.toggle('left-collapsed', getDesktopState('left') === 'closed');
                app.classList.toggle('right-collapsed', getDesktopState('right') === 'closed');
            }
            updateToggleIcon('left');
            updateToggleIcon('right');
            updateBackdrop();
            this.onResize();
        };

        const togglePanel = (side) => {
            const willOpen = app.classList.contains(`${side}-collapsed`);
            app.classList.toggle(`${side}-collapsed`, !willOpen);
            // Only persist desktop state; mobile toggles are transient.
            if (!MOBILE_BP.matches) {
                setDesktopState(side, willOpen ? 'open' : 'closed');
            }
            updateToggleIcon(side);
            updateBackdrop();
            this.onResize();
        };

        btnLeft.addEventListener('click', () => togglePanel('left'));
        btnRight.addEventListener('click', () => togglePanel('right'));

        if (backdrop) {
            backdrop.addEventListener('click', () => {
                app.classList.add('left-collapsed');
                app.classList.add('right-collapsed');
                updateToggleIcon('left');
                updateToggleIcon('right');
                updateBackdrop();
                this.onResize();
            });
        }

        MOBILE_BP.addEventListener('change', applyState);
        applyState();
    }

    // Touch-only devices have no left/right drag or scroll - swap to finger gestures.
    setupCameraHints() {
        if (!window.mobileCheck || !window.mobileCheck()) return;
        const hints = document.getElementById('camera-controls-hint');
        if (!hints) return;
        hints.innerHTML = '<span>1 finger: Orbit</span><span>2 fingers: Pan / Zoom</span>';
    }

    // Mobile-only warning that the site is not optimised for phones.
    // Dismissal is persisted in localStorage so returning users aren't nagged.
    setupViewportBanner() {
        const app = document.getElementById('app');
        const banner = document.getElementById('small-viewport-banner');
        const btn = document.getElementById('dismiss-viewport-banner');
        if (!app || !banner || !btn) return;

        if (localStorage.getItem('viewport-banner-dismissed')) {
            app.classList.add('banner-dismissed');
        }

        btn.addEventListener('click', () => {
            app.classList.add('banner-dismissed');
            localStorage.setItem('viewport-banner-dismissed', '1');
            // Banner row collapses to 0, content row grows; refresh canvas buffer.
            this.onResize();
        });
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
