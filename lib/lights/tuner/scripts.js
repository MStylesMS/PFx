"use strict";

const BACKENDS = {
    hue: {
        label: "Hue",
        powerKey: "on",
        brightnessKey: "brightness",
        defaults: {
            normal: { on: true, kelvin: 4000, r: 255, g: 255, b: 255, brightness: 80 },
            dim: { on: true, brightness: 35 },
            red: { on: true, r: 255, g: 0, b: 0, brightness: 80 },
            blue: { on: true, r: 0, g: 0, b: 255, brightness: 75 },
            green: { on: true, r: 0, g: 255, b: 0, brightness: 75 },
            yellow: { on: true, r: 255, g: 220, b: 0, brightness: 80 },
            orange: { on: true, r: 255, g: 110, b: 0, brightness: 80 },
            purple: { on: true, r: 170, g: 60, b: 255, brightness: 75 },
            pink: { on: true, r: 255, g: 105, b: 180, brightness: 75 },
            cyan: { on: true, r: 0, g: 220, b: 255, brightness: 75 },
            magenta: { on: true, r: 255, g: 0, b: 200, brightness: 75 },
            white: { on: true, kelvin: 4000, brightness: 75 },
            softWhite: { on: true, kelvin: 2700, brightness: 70 },
            brightWhite: { on: true, kelvin: 6500, brightness: 100 },
            warmWhite: { on: true, kelvin: 2200, brightness: 80 },
            coolWhite: { on: true, kelvin: 6000, brightness: 85 },
            off: { on: false }
        },
        fields: [
            { key: "on", type: "boolean" },
            { key: "brightness", type: "number", min: 0, max: 100, step: 1 },
            { key: "kelvin", type: "number", min: 2000, max: 6500, step: 10 },
            { key: "r", type: "number", min: 0, max: 255, step: 1 },
            { key: "g", type: "number", min: 0, max: 255, step: 1 },
            { key: "b", type: "number", min: 0, max: 255, step: 1 }
        ],
        template: { on: true, brightness: 80, kelvin: 4000, r: 255, g: 255, b: 255 }
    },
    lifx: {
        label: "LIFX",
        powerKey: "on",
        brightnessKey: "brightness",
        defaults: {
            normal: { on: true, kelvin: 4000, brightness: 80 },
            dim: { on: true, kelvin: 4000, brightness: 35 },
            red: { on: true, r: 255, g: 0, b: 0, brightness: 80 },
            blue: { on: true, r: 0, g: 70, b: 255, brightness: 75 },
            green: { on: true, r: 0, g: 255, b: 90, brightness: 75 },
            yellow: { on: true, r: 255, g: 220, b: 0, brightness: 80 },
            orange: { on: true, r: 255, g: 110, b: 0, brightness: 80 },
            purple: { on: true, r: 170, g: 60, b: 255, brightness: 75 },
            pink: { on: true, r: 255, g: 105, b: 180, brightness: 75 },
            cyan: { on: true, r: 0, g: 220, b: 255, brightness: 75 },
            magenta: { on: true, r: 255, g: 0, b: 200, brightness: 75 },
            white: { on: true, kelvin: 4000, brightness: 75 },
            softWhite: { on: true, kelvin: 2700, brightness: 70 },
            brightWhite: { on: true, kelvin: 6500, brightness: 100 },
            warmWhite: { on: true, kelvin: 2200, brightness: 80 },
            coolWhite: { on: true, kelvin: 6000, brightness: 85 },
            off: { on: false }
        },
        fields: [
            { key: "on", type: "boolean" },
            { key: "brightness", type: "number", min: 0, max: 100, step: 1 },
            { key: "kelvin", type: "number", min: 1500, max: 9000, step: 10 },
            { key: "r", type: "number", min: 0, max: 255, step: 1 },
            { key: "g", type: "number", min: 0, max: 255, step: 1 },
            { key: "b", type: "number", min: 0, max: 255, step: 1 }
        ],
        template: { on: true, brightness: 80, kelvin: 4000, r: 255, g: 255, b: 255 }
    },
    shelly: {
        label: "Shelly",
        powerKey: "on",
        brightnessKey: "brightness",
        defaults: {
            normal: { on: true, brightness: 80 },
            dim: { on: true, brightness: 35 },
            red: { on: true, brightness: 80, r: 255, g: 0, b: 0, w: 0 },
            blue: { on: true, brightness: 75, r: 0, g: 70, b: 255, w: 0 },
            green: { on: true, brightness: 75, r: 0, g: 255, b: 90, w: 0 },
            yellow: { on: true, brightness: 80, r: 255, g: 220, b: 0, w: 0 },
            orange: { on: true, brightness: 80, r: 255, g: 110, b: 0, w: 0 },
            purple: { on: true, brightness: 75, r: 170, g: 60, b: 255, w: 0 },
            pink: { on: true, brightness: 75, r: 255, g: 105, b: 180, w: 0 },
            cyan: { on: true, brightness: 75, r: 0, g: 220, b: 255, w: 0 },
            magenta: { on: true, brightness: 75, r: 255, g: 0, b: 200, w: 0 },
            white: { on: true, brightness: 80, r: 255, g: 255, b: 255, w: 255 },
            softWhite: { on: true, brightness: 70, r: 255, g: 214, b: 170, w: 180 },
            brightWhite: { on: true, brightness: 100, r: 255, g: 255, b: 255, w: 255 },
            warmWhite: { on: true, brightness: 80, r: 255, g: 200, b: 140, w: 200 },
            coolWhite: { on: true, brightness: 85, r: 225, g: 240, b: 255, w: 220 },
            off: { on: false }
        },
        fields: [
            { key: "on", type: "boolean" },
            { key: "brightness", type: "number", min: 0, max: 100, step: 1 },
            { key: "r", type: "number", min: 0, max: 255, step: 1 },
            { key: "g", type: "number", min: 0, max: 255, step: 1 },
            { key: "b", type: "number", min: 0, max: 255, step: 1 },
            { key: "w", type: "number", min: 0, max: 255, step: 1 }
        ],
        template: { on: true, brightness: 80, r: 255, g: 255, b: 255, w: 0 }
    },
    wiz: {
        label: "WiZ",
        powerKey: "state",
        brightnessKey: "dimming",
        defaults: {
            normal: { state: true, temp: 4000, dimming: 80 },
            dim: { state: true, temp: 4000, dimming: 35 },
            red: { state: true, r: 255, g: 0, b: 0, dimming: 80 },
            blue: { state: true, r: 0, g: 0, b: 255, dimming: 75 },
            green: { state: true, r: 0, g: 255, b: 0, dimming: 75 },
            yellow: { state: true, r: 255, g: 220, b: 0, dimming: 80 },
            orange: { state: true, r: 255, g: 90, b: 0, dimming: 80 },
            purple: { state: true, r: 170, g: 60, b: 255, dimming: 75 },
            pink: { state: true, r: 255, g: 105, b: 180, dimming: 75 },
            cyan: { state: true, r: 0, g: 220, b: 255, dimming: 75 },
            magenta: { state: true, r: 255, g: 0, b: 200, dimming: 75 },
            white: { state: true, temp: 4000, dimming: 75 },
            softWhite: { state: true, temp: 2700, dimming: 70 },
            brightWhite: { state: true, temp: 6500, dimming: 100 },
            warmWhite: { state: true, temp: 2200, dimming: 80 },
            coolWhite: { state: true, temp: 6000, dimming: 85 },
            off: { state: false }
        },
        fields: [
            { key: "state", type: "boolean" },
            { key: "dimming", type: "number", min: 0, max: 100, step: 1 },
            { key: "temp", type: "number", min: 2200, max: 6500, step: 10 },
            { key: "r", type: "number", min: 0, max: 255, step: 1 },
            { key: "g", type: "number", min: 0, max: 255, step: 1 },
            { key: "b", type: "number", min: 0, max: 255, step: 1 }
        ],
        template: { state: true, dimming: 80, temp: 4000, r: 255, g: 255, b: 255 }
    }
};

const state = {
    selectedA: "hue",
    selectedB: "lifx",
    sceneName: "normal",
    exportFormat: "json",
    maps: buildInitialMaps()
};

const el = {
    bulbA: document.getElementById("bulbA"),
    bulbB: document.getElementById("bulbB"),
    sceneName: document.getElementById("sceneName"),
    newSceneName: document.getElementById("newSceneName"),
    exportFormat: document.getElementById("exportFormat"),
    panelA: document.getElementById("panelA"),
    panelB: document.getElementById("panelB"),
    createSceneBtn: document.getElementById("createSceneBtn"),
    resetSceneBtn: document.getElementById("resetSceneBtn"),
    exportBtn: document.getElementById("exportBtn"),
    copyBtn: document.getElementById("copyBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    compareText: document.getElementById("compareText"),
    exportText: document.getElementById("exportText")
};

init();

function init() {
    fillBulbSelectors();
    fillSceneSelector();
    attachEvents();
    renderAll();
}

function buildInitialMaps() {
    const maps = {};
    Object.keys(BACKENDS).forEach((name) => {
        maps[name] = deepClone(BACKENDS[name].defaults);
    });
    return maps;
}

function fillBulbSelectors() {
    const options = Object.entries(BACKENDS)
        .map(([key, cfg]) => `<option value="${key}">${cfg.label}</option>`)
        .join("");

    el.bulbA.innerHTML = options;
    el.bulbB.innerHTML = options;
    el.bulbA.value = state.selectedA;
    el.bulbB.value = state.selectedB;
}

function fillSceneSelector() {
    const names = getSceneNames();
    el.sceneName.innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join("");
    if (!names.includes(state.sceneName)) {
        state.sceneName = names[0] || "normal";
    }
    el.sceneName.value = state.sceneName;
    el.exportFormat.value = state.exportFormat;
}

function attachEvents() {
    el.bulbA.addEventListener("change", () => {
        state.selectedA = el.bulbA.value;
        if (state.selectedA === state.selectedB) {
            state.selectedB = pickAlternativeBulb(state.selectedA);
            el.bulbB.value = state.selectedB;
        }
        renderAll();
    });

    el.bulbB.addEventListener("change", () => {
        state.selectedB = el.bulbB.value;
        if (state.selectedA === state.selectedB) {
            state.selectedA = pickAlternativeBulb(state.selectedB);
            el.bulbA.value = state.selectedA;
        }
        renderAll();
    });

    el.sceneName.addEventListener("change", () => {
        state.sceneName = el.sceneName.value;
        ensureSceneExists(state.selectedA, state.sceneName);
        ensureSceneExists(state.selectedB, state.sceneName);
        renderAll();
    });

    el.exportFormat.addEventListener("change", () => {
        state.exportFormat = el.exportFormat.value;
        updateExportText();
    });

    el.createSceneBtn.addEventListener("click", () => {
        const requested = (el.newSceneName.value || "").trim();
        if (!requested) {
            alert("Enter a scene name first.");
            return;
        }
        Object.keys(BACKENDS).forEach((backend) => {
            ensureSceneExists(backend, requested);
        });
        state.sceneName = requested;
        el.newSceneName.value = "";
        fillSceneSelector();
        renderAll();
    });

    el.resetSceneBtn.addEventListener("click", () => {
        [state.selectedA, state.selectedB].forEach((backend) => {
            const defaults = BACKENDS[backend].defaults[state.sceneName];
            state.maps[backend][state.sceneName] = defaults
                ? deepClone(defaults)
                : deepClone(BACKENDS[backend].template);
        });
        renderAll();
    });

    el.exportBtn.addEventListener("click", () => {
        updateExportText();
    });

    el.copyBtn.addEventListener("click", async () => {
        updateExportText();
        try {
            await navigator.clipboard.writeText(el.exportText.value);
            alert("Export copied to clipboard.");
        } catch (err) {
            alert(`Clipboard failed: ${err.message}`);
        }
    });

    el.downloadBtn.addEventListener("click", () => {
        updateExportText();
        const isJs = state.exportFormat === "js";
        const blob = new Blob([el.exportText.value], { type: isJs ? "text/javascript" : "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = isJs ? "pfx-scene-tuning-export.js" : "pfx-scene-tuning-export.json";
        link.click();
        URL.revokeObjectURL(url);
    });
}

function renderAll() {
    ensureSceneExists(state.selectedA, state.sceneName);
    ensureSceneExists(state.selectedB, state.sceneName);

    renderPanel("A", state.selectedA, el.panelA);
    renderPanel("B", state.selectedB, el.panelB);
    renderCompare();
    updateExportText();
}

function renderPanel(slot, backendName, container) {
    const cfg = BACKENDS[backendName];
    const scene = state.maps[backendName][state.sceneName];

    const controls = cfg.fields.map((field) => renderFieldControl(slot, backendName, scene, field)).join("");

    container.innerHTML = `
        <h2>${cfg.label} (${backendName})</h2>
        <div class="note">Editing scene: <strong>${state.sceneName}</strong></div>
        ${controls}
        <div class="control">
            <label>Current Scene Payload</label>
            <pre>${escapeHtml(JSON.stringify(scene, null, 2))}</pre>
        </div>
    `;

    cfg.fields.forEach((field) => bindFieldEvents(slot, backendName, scene, field));
}

function renderFieldControl(slot, backendName, scene, field) {
    const key = field.key;
    const idBase = `${slot}-${backendName}-${key}`;
    const value = scene[key] !== undefined ? scene[key] : getFieldDefault(backendName, key);

    if (field.type === "boolean") {
        const checked = value ? "checked" : "";
        return `
            <div class="control">
                <label>${key}</label>
                <div class="bool-row">
                    <input id="${idBase}-bool" type="checkbox" ${checked}>
                    <span>${value ? "true" : "false"}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="control">
            <label for="${idBase}-range">${key}</label>
            <div class="range-row">
                <input
                    id="${idBase}-range"
                    type="range"
                    min="${field.min}"
                    max="${field.max}"
                    step="${field.step}"
                    value="${value}"
                >
                <input
                    id="${idBase}-number"
                    type="number"
                    min="${field.min}"
                    max="${field.max}"
                    step="${field.step}"
                    value="${value}"
                >
            </div>
        </div>
    `;
}

function bindFieldEvents(slot, backendName, scene, field) {
    const key = field.key;
    const idBase = `${slot}-${backendName}-${key}`;

    if (field.type === "boolean") {
        const checkbox = document.getElementById(`${idBase}-bool`);
        checkbox.addEventListener("change", () => {
            scene[key] = checkbox.checked;
            renderAll();
        });
        return;
    }

    const range = document.getElementById(`${idBase}-range`);
    const number = document.getElementById(`${idBase}-number`);

    const apply = (rawValue) => {
        const parsed = Number.parseInt(rawValue, 10);
        const value = clamp(parsed, field.min, field.max);
        scene[key] = value;
        range.value = String(value);
        number.value = String(value);
        renderCompare();
        updateExportText();
    };

    range.addEventListener("input", () => apply(range.value));
    number.addEventListener("input", () => apply(number.value));
}

function renderCompare() {
    const a = normalizeForCompare(state.selectedA, state.maps[state.selectedA][state.sceneName]);
    const b = normalizeForCompare(state.selectedB, state.maps[state.selectedB][state.sceneName]);

    const out = {
        scene: state.sceneName,
        left: { backend: state.selectedA, ...a },
        right: { backend: state.selectedB, ...b }
    };

    el.compareText.textContent = JSON.stringify(out, null, 2);
}

function updateExportText() {
    if (state.exportFormat === "js") {
        el.exportText.value = buildJsConstantsExport([state.selectedA, state.selectedB]);
        return;
    }

    const exportObject = {
        generatedAt: new Date().toISOString(),
        selectedBulbs: [state.selectedA, state.selectedB],
        export: {
            [state.selectedA]: buildSceneMapForExport(state.selectedA),
            [state.selectedB]: buildSceneMapForExport(state.selectedB)
        },
        copyPasteHints: {
            hue: "Use as HUE_DEFAULT_SCENES",
            lifx: "Use as LIFX_DEFAULT_SCENES",
            shelly: "Use as SHELLY_DEFAULT_SCENES",
            wiz: "Use as WIZ_DEFAULT_SCENES"
        }
    };

    el.exportText.value = JSON.stringify(exportObject, null, 2);
}

function buildJsConstantsExport(backendNames) {
    const nameMap = {
        hue: "HUE_DEFAULT_SCENES",
        lifx: "LIFX_DEFAULT_SCENES",
        shelly: "SHELLY_DEFAULT_SCENES",
        wiz: "WIZ_DEFAULT_SCENES"
    };

    const blocks = backendNames.map((backendName) => {
        const constName = nameMap[backendName] || `${backendName.toUpperCase()}_DEFAULT_SCENES`;
        const sceneMap = buildSceneMapForExport(backendName);
        return `const ${constName} = ${JSON.stringify(sceneMap, null, 4)};`;
    });

    return [
        "// Generated by PFx Scene Tuner",
        `// ${new Date().toISOString()}`,
        "",
        ...blocks
    ].join("\n\n");
}

function buildSceneMapForExport(backendName) {
    const scenes = state.maps[backendName];
    const out = {};
    Object.keys(scenes).forEach((sceneName) => {
        out[sceneName] = deepClone(scenes[sceneName]);
    });
    return out;
}

function normalizeForCompare(backendName, scene) {
    const cfg = BACKENDS[backendName];
    const powerKey = cfg.powerKey;
    const brightnessKey = cfg.brightnessKey;

    return {
        power: Boolean(scene[powerKey]),
        brightnessPercent: scene[brightnessKey] !== undefined ? scene[brightnessKey] : null,
        rgb: {
            r: scene.r !== undefined ? scene.r : null,
            g: scene.g !== undefined ? scene.g : null,
            b: scene.b !== undefined ? scene.b : null
        },
        kelvin: scene.kelvin !== undefined ? scene.kelvin : (scene.temp !== undefined ? scene.temp : null),
        nativePayload: deepClone(scene)
    };
}

function ensureSceneExists(backendName, sceneName) {
    const scenes = state.maps[backendName];
    if (!scenes[sceneName]) {
        const defaults = BACKENDS[backendName].defaults[sceneName];
        scenes[sceneName] = defaults ? deepClone(defaults) : deepClone(BACKENDS[backendName].template);
    }
}

function getSceneNames() {
    const all = new Set();
    Object.keys(state.maps).forEach((backend) => {
        Object.keys(state.maps[backend]).forEach((scene) => all.add(scene));
    });
    return Array.from(all).sort((a, b) => a.localeCompare(b));
}

function getFieldDefault(backendName, fieldKey) {
    const template = BACKENDS[backendName].template;
    if (template[fieldKey] !== undefined) return template[fieldKey];
    const field = BACKENDS[backendName].fields.find((f) => f.key === fieldKey);
    if (!field) return 0;
    if (field.type === "boolean") return false;
    return field.min;
}

function pickAlternativeBulb(selected) {
    return Object.keys(BACKENDS).find((name) => name !== selected) || selected;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
    const safe = Number.isNaN(value) ? min : value;
    return Math.max(min, Math.min(max, safe));
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
