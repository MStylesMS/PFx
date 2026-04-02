# PFx Lights Backends Notes

This folder contains light-control backends and practical notes for scene tuning across Hue, LIFX, Shelly, and WiZ.

## Why "RGB 255/255/255" is often dimmer than built-in white modes

Many smart bulbs have dedicated white LEDs (warm/cool) in addition to RGB LEDs.

- RGB white is created by mixing three color channels.
- Built-in white modes usually drive dedicated white emitters more efficiently.
- At the same nominal brightness percentage, dedicated white channels can appear brighter.

## Power and thermal constraints

All supported bulb families enforce their own internal limits.

- You can request high values, but bulb firmware is the final arbiter.
- Devices may scale channels down to remain within power and thermal budgets.
- PFx should treat percentages as requested targets, not guaranteed lumens.

Practical guidance:

- Prefer native white/color-temperature controls for white scenes.
- Use RGB when you need hue/saturation control.
- Avoid assuming linear or additive brightness between color and white channels.

## Hue-specific notes

- Hue color temperature uses mirek: `mirek = 1,000,000 / kelvin`.
- Lower mirek means cooler white; higher mirek means warmer white.
- Typical Hue v2 range is clamped to 153-500 mirek (roughly 6500K-2000K).
- In PFx, profile drives payload behavior:
  - `color` profile uses XY color.
  - `ct` profile uses `color_temperature.mirek`.
  - `dim` profile applies brightness only.

## Backend capabilities in this folder

- Hue backend:
  - Supports scene, on/off, brightness, color, color temperature.
  - Uses XY conversion and gamut clamping for RGB paths.
- LIFX backend:
  - Supports scene, on/off, brightness, color, color temperature.
  - Uses native HSBK; fade duration is passed to SetColor.
- Shelly backend:
  - Supports scene, on/off, brightness, color, color temperature.
  - RGBW fields are effective on RGBW profiles; switch/dimmer ignore color channels.
- WiZ native backend:
  - Supports scene, on/off, brightness, color, color temperature.
  - Uses native `temp` (kelvin) for white scenes.

## Scene tuning helper page

A plain tuner page is provided at:

- `lib/lights/tuner/index.html`
- `lib/lights/tuner/scripts.js`

What it does:

- Select any two bulb types at once.
- Pick and edit a scene for each type with native fields.
- Adjust values with sliders and numeric inputs.
- Compare both scene payloads side by side.
- Export tuned scene maps as JSON snippets for copy/paste into backend constants.

How to use quickly:

1. Open `index.html` in a browser.
2. Choose two bulb types and a scene name.
3. Adjust sliders/inputs until they visually match.
4. Apply scene changes and repeat for other scenes.
5. Use export/copy/download to move results into code.
