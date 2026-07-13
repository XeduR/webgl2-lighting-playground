/*
    Chrome icon set - inline SVG for deterministic cross-platform rendering.
    Font glyphs were drawn from per-OS system fallback fonts (inconsistent weight,
    tofu risk); these are shipped with the app instead.

    Each icon is a 24x24 viewBox sized to 1em, so the existing font-size rules on
    the host element control its size, and uses currentColor so it inherits the
    host's color (tool-btn text, per-type light colors, etc.).
*/

const svg = (body) =>
    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
    // Toolbar
    select: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),
    move: svg('<path d="M12 4v16M4 12h16"/><path d="M9 7l3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3"/>'),
    rotate: svg('<path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 4v4h-4"/>'),
    scale: svg('<path d="M5 5l14 14"/><path d="M5 11V5h6"/><path d="M19 13v6h-6"/>'),
    delete: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    duplicate: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
    undo: svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a5 5 0 0 1 5 5"/>'),
    redo: svg('<path d="M15 7l5 5-5 5"/><path d="M20 12H10a5 5 0 0 0-5 5"/>'),
    camera: svg('<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/>'),

    // Panel toggles
    chevronLeft: svg('<path d="M15 5L15 19L6 12Z" fill="currentColor" stroke="none"/>'),
    chevronRight: svg('<path d="M9 5L9 19L18 12Z" fill="currentColor" stroke="none"/>'),

    // Objects
    cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
    sphere: svg('<circle cx="12" cy="12" r="8"/><path d="M4.5 10c3.5 2.2 11.5 2.2 15 0"/>'),
    plane: svg('<path d="M2 17l7-10h13l-7 10z"/>'),

    // Lights
    directional: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
    point: svg('<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>'),
    spot: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
    star: svg('<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 17.8 6.4 20l1.4-6.2L3 9.5l6.4-.6z" fill="currentColor" stroke="none"/>'),

    // Visibility
    eye: svg('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
    eyeOff: svg('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/><path d="M3 3l18 18"/>')
};
