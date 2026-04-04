/*
    UI Controls - scene hierarchy, property editor, toolbar
*/

import { vec3, hexToRgb, rgbToHex, degToRad, radToDeg } from './math.js';
import { SceneObject, Light, LightType } from './scene.js';

// Escape HTML entities to prevent injection via innerHTML
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// UI Controller
export class UIController {
    constructor(scene, renderer, controls = null) {
        this.scene = scene;
        this.renderer = renderer;
        this.controls = controls;

        // Undo/Redo
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 20;

        // Current tool
        this.currentTool = 'select';

        // DOM elements
        this.sceneList = document.getElementById('scene-list');
        this.propertiesContent = document.getElementById('properties-content');
        this.addMenu = document.getElementById('add-menu');

        this.setupEventListeners();
        this.setupSceneCallbacks();
        this.refreshSceneList();
        this.updateUndoRedoState();

        // Sync UI controls with renderer state (quality may differ from HTML defaults on mobile)
        const qualitySelect = document.getElementById('quality-preset');
        qualitySelect.value = this.renderer.quality;
        document.getElementById('soft-shadows').checked = this.renderer.softShadows;

        // Disable quality presets that exceed this device's GPU capabilities
        const available = this.renderer.availablePresets;
        for (const option of qualitySelect.options) {
            if (!available[option.value]) {
                option.disabled = true;
            }
        }
    }

    setupEventListeners() {
        // Add object menu
        document.getElementById('add-object-btn').addEventListener('click', () => {
            this.addMenu.classList.toggle('active');
        });

        // Add menu items
        this.addMenu.querySelectorAll('.add-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                this.addEntity(type);
                this.addMenu.classList.remove('active');
            });
        });

        // Close add menu on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#add-menu') && !e.target.closest('#add-object-btn')) {
                this.addMenu.classList.remove('active');
            }
        });

        // Tool buttons
        document.getElementById('tool-select').addEventListener('click', () => this.setTool('select'));
        document.getElementById('tool-move').addEventListener('click', () => this.setTool('move'));
        document.getElementById('tool-rotate').addEventListener('click', () => this.setTool('rotate'));
        document.getElementById('tool-scale').addEventListener('click', () => this.setTool('scale'));

        // Action buttons
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());
        document.getElementById('redo-btn').addEventListener('click', () => this.redo());
        document.getElementById('delete-btn').addEventListener('click', () => this.deleteSelected());
        document.getElementById('duplicate-btn').addEventListener('click', () => this.duplicateSelected());
        document.getElementById('reset-scene').addEventListener('click', () => this.resetScene());
        document.getElementById('reset-camera-btn').addEventListener('click', () => {
            if (this.controls && this.controls.reset) {
                this.controls.reset();
            }
        });

        // Quality preset
        document.getElementById('quality-preset').addEventListener('change', (e) => {
            this.renderer.setQuality(e.target.value);
        });

        // Shadow toggles
        document.getElementById('soft-shadows').addEventListener('change', (e) => {
            this.renderer.softShadows = e.target.checked;
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            const disabled = this.getDisabledControls(this.scene.selectedEntity);

            switch (e.key.toLowerCase()) {
                case 'q': this.setTool('select'); break;
                case 'w': if (!disabled.move) this.setTool('move'); break;
                case 'e': if (!disabled.rotate) this.setTool('rotate'); break;
                case 'r': if (!disabled.scale) this.setTool('scale'); break;
                case 'delete':
                case 'backspace':
                    e.preventDefault();
                    this.deleteSelected();
                    break;
                case 'd':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.duplicateSelected();
                    }
                    break;
                case 'z':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) this.redo();
                        else this.undo();
                    }
                    break;
                case 'y':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.redo();
                    }
                    break;
            }
        });
    }

    setupSceneCallbacks() {
        this.scene.onEntityAdded = () => this.refreshSceneList();
        this.scene.onEntityRemoved = () => this.refreshSceneList();
        this.scene.onSelectionChanged = (entity) => {
            this.refreshSceneList(); // Update selection highlight in list
            this.updateProperties(entity);
            this.updateToolbarState(entity);
        };
    }

    // Determine which toolbar controls should be disabled for a given entity
    getDisabledControls(entity) {
        const none = { move: false, rotate: false, scale: false, delete: false, duplicate: false };
        if (!entity) return none;

        // Ground plane: no transform, no delete, no duplicate
        if (entity.name === 'Ground') {
            return { move: true, rotate: true, scale: true, delete: true, duplicate: true };
        }

        if (entity.type === 'light') {
            // Directional light: no transform tools, no delete, no duplicate
            if (entity.lightType === LightType.DIRECTIONAL) {
                return { move: true, rotate: true, scale: true, delete: true, duplicate: true };
            }
            // Point light: no rotate, no scale
            if (entity.lightType === LightType.POINT) {
                return { move: false, rotate: true, scale: true, delete: false, duplicate: false };
            }
            // Spotlight: no scale
            if (entity.lightType === LightType.SPOT) {
                return { move: false, rotate: false, scale: true, delete: false, duplicate: false };
            }
        }

        return none;
    }

    // Update toolbar button disabled states based on selected entity
    updateToolbarState(entity) {
        const disabled = this.getDisabledControls(entity);

        const btnMap = {
            move: document.getElementById('tool-move'),
            rotate: document.getElementById('tool-rotate'),
            scale: document.getElementById('tool-scale'),
            delete: document.getElementById('delete-btn'),
            duplicate: document.getElementById('duplicate-btn')
        };

        for (const [key, btn] of Object.entries(btnMap)) {
            if (disabled[key]) {
                btn.classList.add('tool-disabled');
                btn.disabled = true;
            } else {
                btn.classList.remove('tool-disabled');
                btn.disabled = false;
            }
        }

        // If the current tool is now disabled, switch back to select
        const toolToControl = { move: 'move', rotate: 'rotate', scale: 'scale' };
        if (toolToControl[this.currentTool] && disabled[toolToControl[this.currentTool]]) {
            this.setTool('select');
        }
    }

    setTool(tool) {
        // Don't allow switching to a disabled tool
        const disabled = this.getDisabledControls(this.scene.selectedEntity);
        if (disabled[tool]) return;

        this.currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`tool-${tool}`).classList.add('active');
        if (this.onToolChanged) this.onToolChanged(tool);
    }

    addEntity(type) {
        let entity;

        switch (type) {
            case 'cube':
                entity = new SceneObject('New Cube', 'cube');
                entity.transform.setPosition(0, 0.5, 0);
                entity.castShadow = true;
                entity.receiveShadow = true;
                this.scene.addObject(entity);
                break;
            case 'sphere':
                entity = new SceneObject('New Sphere', 'sphere');
                entity.transform.setPosition(0, 0.5, 0);
                entity.castShadow = true;
                entity.receiveShadow = true;
                this.scene.addObject(entity);
                break;
            case 'plane':
                entity = new SceneObject('New Plane', 'plane');
                entity.transform.setPosition(0, 0, 0);
                entity.castShadow = true;
                entity.receiveShadow = true;
                this.scene.addObject(entity);
                break;
            case 'directional':
                entity = new Light('New Directional Light', LightType.DIRECTIONAL);
                entity.transform.setPosition(5, 10, 5);
                entity.transform.setRotation(degToRad(-45), degToRad(30), degToRad(0));
                this.scene.addLight(entity);
                break;
            case 'point':
                entity = new Light('New Point Light', LightType.POINT);
                entity.transform.setPosition(0, 3, 0);
                entity.range = 10;
                this.scene.addLight(entity);
                break;
            case 'spot':
                entity = new Light('New Spotlight', LightType.SPOT);
                entity.transform.setPosition(0, 5, 0);
                entity.transform.setRotation(-Math.PI / 2, 0, 0);
                entity.range = 15;
                this.scene.addLight(entity);
                break;
        }

        if (entity) {
            this.scene.selectEntity(entity);
            this.pushUndo({ type: 'add', entity });
        }
    }

    getDefaultName(entity) {
        if (entity.type === 'object') {
            const names = { cube: 'New Cube', sphere: 'New Sphere', plane: 'New Plane' };
            return names[entity.geometryType] || 'New Object';
        } else {
            const names = { directional: 'New Directional Light', point: 'New Point Light', spot: 'New Spotlight' };
            return names[entity.lightType] || 'New Light';
        }
    }

    deleteSelected() {
        this.removeEntity(this.scene.selectedEntity);
    }

    removeEntity(entity) {
        if (!entity) return;
        if (this.getDisabledControls(entity).delete) return;

        const allEntities = [...this.scene.objects, ...this.scene.lights];
        const currentIndex = allEntities.indexOf(entity);

        const entityType = entity.type === 'object' ? 'object' : 'light';
        this.pushUndo({ type: 'delete', entity: entity.clone ? entity.clone() : entity, entityType });
        this.scene.removeEntity(entity);

        // Select next item (or previous if at end, or null if empty)
        const remainingEntities = [...this.scene.objects, ...this.scene.lights];
        if (remainingEntities.length > 0) {
            const nextIndex = Math.min(currentIndex, remainingEntities.length - 1);
            this.scene.selectEntity(remainingEntities[nextIndex]);
        }
    }

    duplicateSelected() {
        const entity = this.scene.selectedEntity;
        if (!entity || !entity.clone) return;

        // Check if duplicate is disabled for this entity
        if (this.getDisabledControls(entity).duplicate) return;

        const copy = entity.clone();
        // Offset position slightly
        copy.transform.position[0] += 1;
        copy.transform.dirty = true;

        if (entity.type === 'object') {
            this.scene.addObject(copy);
        } else {
            this.scene.addLight(copy);
        }

        this.scene.selectEntity(copy);
        this.pushUndo({ type: 'add', entity: copy });
    }

    resetScene() {
        // Import createDefaultScene dynamically to avoid circular deps
        import('./scene.js').then(({ createDefaultScene }) => {
            const newScene = createDefaultScene();
            this.scene.clear();

            for (const obj of newScene.objects) {
                this.scene.addObject(obj);
            }
            for (const light of newScene.lights) {
                this.scene.addLight(light);
            }

            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoState();
            this.refreshSceneList();

            // Reset camera if controls are available
            if (this.controls && this.controls.reset) {
                this.controls.reset();
            }

            // Select the Sun (first light) by default
            if (this.scene.lights.length > 0) {
                this.scene.selectEntity(this.scene.lights[0]);
                this.refreshSceneList();
            }
        });
    }

    updateUndoRedoState() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (this.undoStack.length === 0) {
            undoBtn.classList.add('tool-disabled');
            undoBtn.disabled = true;
        } else {
            undoBtn.classList.remove('tool-disabled');
            undoBtn.disabled = false;
        }

        if (this.redoStack.length === 0) {
            redoBtn.classList.add('tool-disabled');
            redoBtn.disabled = true;
        } else {
            redoBtn.classList.remove('tool-disabled');
            redoBtn.disabled = false;
        }
    }

    pushUndo(action) {
        this.undoStack.push(action);
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoState();
    }

    undo() {
        if (this.undoStack.length === 0) return;

        const action = this.undoStack.pop();
        this.redoStack.push(action);

        // Reverse the action
        if (action.type === 'add') {
            const found = this.scene.getEntityById(action.entity.id);
            if (found) this.scene.removeEntity(found);
        } else if (action.type === 'delete') {
            if (action.entityType === 'object') {
                this.scene.addObject(action.entity);
            } else {
                this.scene.addLight(action.entity);
            }
        } else if (action.type === 'transform') {
            vec3.copy(action.entity.transform.position, action.before.position);
            vec3.copy(action.entity.transform.rotation, action.before.rotation);
            vec3.copy(action.entity.transform.scale, action.before.scale);
            action.entity.transform.dirty = true;
            this.scene.selectEntity(action.entity);
        }
        this.updateUndoRedoState();
    }

    redo() {
        if (this.redoStack.length === 0) return;

        const action = this.redoStack.pop();
        this.undoStack.push(action);

        // Redo the action
        if (action.type === 'add') {
            if (action.entity.type === 'object') {
                this.scene.addObject(action.entity);
            } else {
                this.scene.addLight(action.entity);
            }
        } else if (action.type === 'delete') {
            const found = this.scene.getEntityById(action.entity.id);
            if (found) this.scene.removeEntity(found);
        } else if (action.type === 'transform') {
            vec3.copy(action.entity.transform.position, action.after.position);
            vec3.copy(action.entity.transform.rotation, action.after.rotation);
            vec3.copy(action.entity.transform.scale, action.after.scale);
            action.entity.transform.dirty = true;
            this.scene.selectEntity(action.entity);
        }
        this.updateUndoRedoState();
    }

    refreshSceneList() {
        this.sceneList.innerHTML = '';

        // Objects section
        for (const obj of this.scene.objects) {
            const item = this.createSceneItem(obj);
            this.sceneList.appendChild(item);
        }

        // Lights section
        for (const light of this.scene.lights) {
            const item = this.createSceneItem(light);
            this.sceneList.appendChild(item);
        }
    }

    createSceneItem(entity) {
        const item = document.createElement('li');
        item.className = 'scene-item';
        item.dataset.id = entity.id;

        if (entity.type === 'object') {
            item.classList.add('object');
            const icons = { cube: '□', sphere: '○', plane: '▭' };
            item.innerHTML = `
                <span class="icon">${icons[entity.geometryType] || '■'}</span>
                <span class="name">${escHTML(entity.name)}</span>
                <span class="visibility">${entity.visible ? '\u{1F441}\uFE0E' : '○'}</span>
            `;
        } else {
            const typeClass = `light-${entity.lightType}`;
            item.classList.add(typeClass);
            const icons = { directional: '\u2600\uFE0E', point: '●', spot: '◎' };
            item.innerHTML = `
                <span class="icon">${icons[entity.lightType] || '★'}</span>
                <span class="name">${escHTML(entity.name)}</span>
                <span class="visibility">${entity.visible ? '\u{1F441}\uFE0E' : '○'}</span>
            `;
        }

        if (this.scene.selectedEntity === entity) {
            item.classList.add('selected');
        }

        // Click to select
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('visibility')) {
                entity.visible = !entity.visible;
                this.refreshSceneList();
            } else {
                this.scene.selectEntity(entity);
                this.refreshSceneList();
            }
        });

        return item;
    }

    updateProperties(entity) {
        if (!entity) {
            this.propertiesContent.innerHTML = `
                <div class="no-selection">
                    <p>Select an object or light to edit its properties</p>
                </div>
            `;
            return;
        }

        if (entity.type === 'object') {
            this.renderObjectProperties(entity);
        } else {
            this.renderLightProperties(entity);
        }
    }

    renderObjectProperties(obj) {
        const pos = obj.transform.position;
        const rot = obj.transform.rotation;
        const scale = obj.transform.scale;
        const color = rgbToHex(obj.material.color[0], obj.material.color[1], obj.material.color[2]);
        const isGround = obj.name === 'Ground';

        this.propertiesContent.innerHTML = `
            <div class="property-section">
                <div class="property-section-header">
                    <h4>Properties</h4>
                </div>

                <div class="property-row">
                    <label>Name</label>
                    <input type="text" class="name-input" value="${escHTML(obj.name)}" data-prop="name">
                </div>
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Transform</h4>
                </div>

                <div class="property-row">
                    <label>Position</label>
                    <div class="vector-input">
                        <div class="axis-input axis-x"><span class="axis-label">X</span><input type="number" step="0.1" value="${pos[0].toFixed(1)}" data-prop="position" data-axis="0"></div>
                        <div class="axis-input axis-y"><span class="axis-label">Y</span><input type="number" step="0.1" value="${pos[1].toFixed(1)}" data-prop="position" data-axis="1"></div>
                        <div class="axis-input axis-z"><span class="axis-label">Z</span><input type="number" step="0.1" value="${pos[2].toFixed(1)}" data-prop="position" data-axis="2"></div>
                    </div>
                </div>

                <div class="property-row">
                    <label>Rotation</label>
                    <div class="vector-input">
                        <div class="axis-input axis-x"><span class="axis-label">X</span><input type="number" step="5" value="${radToDeg(rot[0]).toFixed(1)}" data-prop="rotation" data-axis="0"></div>
                        <div class="axis-input axis-y"><span class="axis-label">Y</span><input type="number" step="5" value="${radToDeg(rot[1]).toFixed(1)}" data-prop="rotation" data-axis="1"></div>
                        <div class="axis-input axis-z"><span class="axis-label">Z</span><input type="number" step="5" value="${radToDeg(rot[2]).toFixed(1)}" data-prop="rotation" data-axis="2"></div>
                    </div>
                </div>

                <div class="property-row">
                    <label>Scale</label>
                    <div class="vector-input">
                        <div class="axis-input axis-x"><span class="axis-label">X</span><input type="number" step="0.1" min="0.01" value="${scale[0].toFixed(1)}" data-prop="scale" data-axis="0"></div>
                        <div class="axis-input axis-y"><span class="axis-label">Y</span><input type="number" step="0.1" min="0.01" value="${scale[1].toFixed(1)}" data-prop="scale" data-axis="1"></div>
                        <div class="axis-input axis-z"><span class="axis-label">Z</span><input type="number" step="0.1" min="0.01" value="${scale[2].toFixed(1)}" data-prop="scale" data-axis="2"></div>
                    </div>
                </div>
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Material</h4>
                </div>

                <div class="property-row">
                    <label>Color</label>
                    <div class="color-picker-wrapper">
                        <input type="color" value="${color}" data-prop="color">
                        <span class="color-hex">${color}</span>
                    </div>
                </div>

                <div class="property-row">
                    <label>Opacity</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="1" step="0.01" value="${obj.material.opacity}" data-prop="opacity">
                        <span class="value">${obj.material.opacity.toFixed(2)}</span>
                    </div>
                </div>

                <div class="property-row">
                    <label>Specular</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="1" step="0.01" value="${obj.material.specular}" data-prop="specular">
                        <span class="value">${obj.material.specular.toFixed(2)}</span>
                    </div>
                </div>

                <div class="property-row">
                    <label>Roughness</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="1" step="0.01" value="${obj.material.roughness}" data-prop="roughness">
                        <span class="value">${obj.material.roughness.toFixed(2)}</span>
                    </div>
                </div>

                <div class="property-row">
                    <label>Thickness</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="1" step="0.01" value="${obj.material.thickness}" data-prop="thickness">
                        <span class="value">${obj.material.thickness.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Shadows</h4>
                </div>

                ${!isGround ? `
                <div class="property-row">
                    <label>Cast Shadow</label>
                    <input type="checkbox" ${obj.castShadow ? 'checked' : ''} data-prop="castShadow">
                </div>
                ` : ''}
            </div>

            ${!isGround ? `
            <div class="property-section remove-section">
                <div class="property-section-header">
                    <h4>Remove</h4>
                </div>
                <div class="property-row">
                    <span class="remove-link" data-action="remove">Remove object</span>
                </div>
            </div>
            ` : ''}
        `;

        this.bindObjectPropertyEvents(obj);
    }

    renderLightProperties(light) {
        const pos = light.transform.position;
        const rot = light.transform.rotation;
        const color = rgbToHex(light.color[0], light.color[1], light.color[2]);

        let extraProps = '';

        if (light.lightType === LightType.POINT || light.lightType === LightType.SPOT) {
            extraProps += `
                <div class="property-row">
                    <label>Range</label>
                    <div class="slider-row">
                        <input type="range" min="1" max="50" step="0.5" value="${light.range}" data-prop="range">
                        <span class="value">${light.range.toFixed(1)}</span>
                    </div>
                </div>
            `;
        }

        if (light.lightType === LightType.SPOT) {
            const innerDeg = radToDeg(light.innerAngle).toFixed(0);
            const outerDeg = radToDeg(light.outerAngle).toFixed(0);
            // Max outer angle is 85 to prevent shadow issues at extreme angles
            extraProps += `
                <div class="property-row">
                    <label>Inner Angle</label>
                    <div class="slider-row constrained-slider">
                        <input type="range" min="1" max="84" step="1" value="${innerDeg}" data-prop="innerAngle" class="inner-angle-slider">
                        <span class="value">${innerDeg}°</span>
                    </div>
                    <div class="slider-hint">Cannot exceed outer angle</div>
                </div>
                <div class="property-row">
                    <label>Outer Angle</label>
                    <div class="slider-row constrained-slider">
                        <input type="range" min="2" max="85" step="1" value="${outerDeg}" data-prop="outerAngle" class="outer-angle-slider">
                        <span class="value">${outerDeg}°</span>
                    </div>
                    <div class="slider-hint">Cannot be less than inner angle</div>
                </div>
            `;
        }

        this.propertiesContent.innerHTML = `
            <div class="property-section">
                <div class="property-section-header">
                    <h4>Properties</h4>
                </div>

                <div class="property-row">
                    <label>Name</label>
                    <input type="text" class="name-input" value="${escHTML(light.name)}" data-prop="name">
                </div>
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Transform</h4>
                </div>

                ${light.lightType !== LightType.DIRECTIONAL ? `
                <div class="property-row">
                    <label>Position</label>
                    <div class="vector-input">
                        <div class="axis-input axis-x"><span class="axis-label">X</span><input type="number" step="0.1" value="${pos[0].toFixed(1)}" data-prop="position" data-axis="0"></div>
                        <div class="axis-input axis-y"><span class="axis-label">Y</span><input type="number" step="0.1" value="${pos[1].toFixed(1)}" data-prop="position" data-axis="1"></div>
                        <div class="axis-input axis-z"><span class="axis-label">Z</span><input type="number" step="0.1" value="${pos[2].toFixed(1)}" data-prop="position" data-axis="2"></div>
                    </div>
                </div>
                ` : ''}

                ${light.lightType !== LightType.POINT ? `
                <div class="property-row">
                    <label>${light.lightType === LightType.DIRECTIONAL ? 'Direction' : 'Rotation'}</label>
                    <div class="vector-input">
                        <div class="axis-input axis-x"><span class="axis-label">X</span><input type="number" step="5" value="${radToDeg(rot[0]).toFixed(1)}" data-prop="rotation" data-axis="0"></div>
                        <div class="axis-input axis-y"><span class="axis-label">Y</span><input type="number" step="5" value="${radToDeg(rot[1]).toFixed(1)}" data-prop="rotation" data-axis="1"></div>
                        <div class="axis-input axis-z"><span class="axis-label">Z</span><input type="number" step="5" value="${radToDeg(rot[2]).toFixed(1)}" data-prop="rotation" data-axis="2"></div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Light</h4>
                </div>

                <div class="property-row">
                    <label>Color</label>
                    <div class="color-picker-wrapper">
                        <input type="color" value="${color}" data-prop="lightColor">
                        <span class="color-hex">${color}</span>
                    </div>
                </div>

                <div class="property-row">
                    <label>Intensity</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="5" step="0.1" value="${light.intensity}" data-prop="intensity">
                        <span class="value">${light.intensity.toFixed(1)}</span>
                    </div>
                </div>

                ${extraProps}
            </div>

            <div class="property-section">
                <div class="property-section-header">
                    <h4>Shadows</h4>
                </div>

                <div class="property-row">
                    <label>Cast Shadow</label>
                    <input type="checkbox" ${light.castShadow ? 'checked' : ''} data-prop="castShadow">
                </div>

                <div class="property-row">
                    <label>Shadow Bias</label>
                    <div class="slider-row">
                        <input type="range" min="0" max="0.01" step="0.0001" value="${light.shadowBias}" data-prop="shadowBias">
                        <span class="value">${light.shadowBias.toFixed(4)}</span>
                    </div>
                </div>
            </div>

            <div class="property-section remove-section">
                <div class="property-section-header">
                    <h4>Remove</h4>
                </div>
                <div class="property-row">
                    <span class="remove-link" data-action="remove">Remove light</span>
                </div>
            </div>
        `;

        this.bindLightPropertyEvents(light);
    }

    bindObjectPropertyEvents(obj) {
        // Name input
        const nameInput = this.propertiesContent.querySelector('.name-input');
        if (nameInput) {
            const updateName = () => {
                const newName = nameInput.value.trim();
                if (newName.length > 0) {
                    obj.name = newName;
                } else {
                    obj.name = this.getDefaultName(obj);
                    nameInput.value = obj.name;
                }
                this.refreshSceneList();
            };
            nameInput.addEventListener('blur', updateName);
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    updateName();
                    nameInput.blur();
                }
            });
        }

        // Remove link
        const removeLink = this.propertiesContent.querySelector('.remove-link');
        if (removeLink) {
            removeLink.addEventListener('click', () => {
                this.removeEntity(obj);
            });
        }

        // Vector inputs - handle both spinner clicks and manual input
        this.propertiesContent.querySelectorAll('.vector-input input').forEach(input => {
            const prop = input.dataset.prop;
            const axis = parseInt(input.dataset.axis);

            // Update on input (for spinner buttons - continuous)
            input.addEventListener('input', (e) => {
                const rawValue = parseFloat(e.target.value);
                if (isNaN(rawValue)) return;

                // Round to 1 decimal for position/scale, keep as-is for rotation
                const value = prop === 'rotation' ? rawValue : Math.round(rawValue * 10) / 10;

                if (prop === 'position') {
                    obj.transform.position[axis] = value;
                } else if (prop === 'rotation') {
                    obj.transform.rotation[axis] = degToRad(value);
                } else if (prop === 'scale') {
                    obj.transform.scale[axis] = Math.max(0.01, value);
                }
                obj.transform.dirty = true;
            });

            // On blur, format the displayed value to 1 decimal place
            input.addEventListener('blur', (e) => {
                const rawValue = parseFloat(e.target.value);
                if (isNaN(rawValue)) {
                    // Reset to current value if invalid
                    if (prop === 'position') {
                        e.target.value = obj.transform.position[axis].toFixed(1);
                    } else if (prop === 'rotation') {
                        e.target.value = radToDeg(obj.transform.rotation[axis]).toFixed(1);
                    } else if (prop === 'scale') {
                        e.target.value = obj.transform.scale[axis].toFixed(1);
                    }
                    return;
                }

                // Round and format
                const rounded = Math.round(rawValue * 10) / 10;
                e.target.value = rounded.toFixed(1);

                // Apply the rounded value
                if (prop === 'position') {
                    obj.transform.position[axis] = rounded;
                } else if (prop === 'rotation') {
                    obj.transform.rotation[axis] = degToRad(rounded);
                } else if (prop === 'scale') {
                    obj.transform.scale[axis] = Math.max(0.01, rounded);
                }
                obj.transform.dirty = true;
            });

            // Handle Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
        });

        // Color picker
        this.propertiesContent.querySelectorAll('input[data-prop="color"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const rgb = hexToRgb(e.target.value);
                obj.material.setColor(rgb[0], rgb[1], rgb[2]);
                e.target.nextElementSibling.textContent = e.target.value;
            });
        });

        // Sliders
        this.propertiesContent.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                const value = parseFloat(e.target.value);

                if (prop === 'opacity') obj.material.opacity = value;
                else if (prop === 'specular') obj.material.specular = value;
                else if (prop === 'roughness') obj.material.roughness = value;
                else if (prop === 'thickness') obj.material.thickness = value;

                e.target.parentElement.querySelector('.value').textContent = value.toFixed(2);
            });
        });

        // Checkboxes
        this.propertiesContent.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const prop = e.target.dataset.prop;
                obj[prop] = e.target.checked;
            });
        });
    }

    bindLightPropertyEvents(light) {
        // Name input
        const nameInput = this.propertiesContent.querySelector('.name-input');
        if (nameInput) {
            const updateName = () => {
                const newName = nameInput.value.trim();
                if (newName.length > 0) {
                    light.name = newName;
                } else {
                    light.name = this.getDefaultName(light);
                    nameInput.value = light.name;
                }
                this.refreshSceneList();
            };
            nameInput.addEventListener('blur', updateName);
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    updateName();
                    nameInput.blur();
                }
            });
        }

        // Remove link
        const removeLink = this.propertiesContent.querySelector('.remove-link');
        if (removeLink) {
            removeLink.addEventListener('click', () => {
                this.removeEntity(light);
            });
        }

        // Vector inputs - handle both spinner clicks and manual input
        this.propertiesContent.querySelectorAll('.vector-input input').forEach(input => {
            const prop = input.dataset.prop;
            const axis = parseInt(input.dataset.axis);

            // Update on input (for spinner buttons - continuous)
            input.addEventListener('input', (e) => {
                const rawValue = parseFloat(e.target.value);
                if (isNaN(rawValue)) return;

                // Round to 1 decimal for position, keep as-is for rotation
                const value = prop === 'rotation' ? rawValue : Math.round(rawValue * 10) / 10;

                if (prop === 'position') {
                    light.transform.position[axis] = value;
                } else if (prop === 'rotation') {
                    light.transform.rotation[axis] = degToRad(value);
                }
                light.transform.dirty = true;
            });

            // On blur, format the displayed value to 1 decimal place
            input.addEventListener('blur', (e) => {
                const rawValue = parseFloat(e.target.value);
                if (isNaN(rawValue)) {
                    // Reset to current value if invalid
                    if (prop === 'position') {
                        e.target.value = light.transform.position[axis].toFixed(1);
                    } else if (prop === 'rotation') {
                        e.target.value = radToDeg(light.transform.rotation[axis]).toFixed(1);
                    }
                    return;
                }

                // Round and format
                const rounded = Math.round(rawValue * 10) / 10;
                e.target.value = rounded.toFixed(1);

                // Apply the rounded value
                if (prop === 'position') {
                    light.transform.position[axis] = rounded;
                } else if (prop === 'rotation') {
                    light.transform.rotation[axis] = degToRad(rounded);
                }
                light.transform.dirty = true;
            });

            // Handle Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
        });

        // Color picker
        this.propertiesContent.querySelectorAll('input[data-prop="lightColor"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const rgb = hexToRgb(e.target.value);
                light.color[0] = rgb[0];
                light.color[1] = rgb[1];
                light.color[2] = rgb[2];
                e.target.nextElementSibling.textContent = e.target.value;
            });
        });

        // Sliders
        this.propertiesContent.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                let value = parseFloat(e.target.value);

                if (prop === 'intensity') light.intensity = value;
                else if (prop === 'range') light.range = value;
                else if (prop === 'innerAngle') {
                    // Clamp inner angle to not exceed outer angle
                    const maxInner = radToDeg(light.outerAngle) - 1;
                    if (value > maxInner) {
                        value = maxInner;
                        e.target.value = value;
                    }
                    light.innerAngle = degToRad(value);
                    // Update the slider's visual max
                    e.target.max = maxInner;
                }
                else if (prop === 'outerAngle') {
                    // Clamp outer angle to not be less than inner angle
                    const minOuter = radToDeg(light.innerAngle) + 1;
                    if (value < minOuter) {
                        value = minOuter;
                        e.target.value = value;
                    }
                    light.outerAngle = degToRad(value);
                    // Update inner angle slider's max
                    const innerSlider = this.propertiesContent.querySelector('.inner-angle-slider');
                    if (innerSlider) {
                        innerSlider.max = value - 1;
                    }
                }
                else if (prop === 'shadowBias') light.shadowBias = value;

                const valueSpan = e.target.parentElement.querySelector('.value');
                if (prop === 'innerAngle' || prop === 'outerAngle') {
                    valueSpan.textContent = value.toFixed(0) + '°';
                } else if (prop === 'shadowBias') {
                    valueSpan.textContent = value.toFixed(4);
                } else {
                    valueSpan.textContent = value.toFixed(1);
                }
            });
        });

        // Checkboxes
        this.propertiesContent.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const prop = e.target.dataset.prop;
                light[prop] = e.target.checked;
            });
        });
    }

    updateStats(fps, drawCalls) {
        document.getElementById('fps-counter').textContent = `${fps} FPS`;
        document.getElementById('draw-calls').textContent = `${drawCalls} draws`;
    }
}
