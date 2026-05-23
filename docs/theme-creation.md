# Theme Creation – P3 Portal

<!-- p3portal.org -->

Custom themes can be uploaded by **P3 Plus** users via the settings page (Admin → Settings → Appearance → Themes).

---

## Format

A theme file is a plain JSON file with the `.json` extension.

```json
{
  "name": "My Theme",
  "author": "Jane Doe",
  "version": "1.0",
  "variables": {
    "--sidebar":     "#16181e",
    "--bg":          "#1e2028",
    "--bg2":         "#23262f",
    "--bg3":         "#2a2d38",
    "--border":      "#2e3140",
    "--border2":     "#3a3d4d",
    "--text":        "#c9cdd8",
    "--text2":       "#8b909f",
    "--text3":       "#5c6070",
    "--white":       "#e8eaf0",
    "--accent":      "#e07b39",
    "--green":       "#4caf50",
    "--orange":      "#e07b39",
    "--blue":        "#3b82f6",
    "--purple":      "#7c5cbf",
    "--red":         "#c0392b",
    "--font":        "'Inter', sans-serif",
    "--radius-card": "6px",
    "--radius-btn":  "4px"
  }
}
```

---

## Required variables (in `variables`)

All 16 variables must be present — if any is missing, the upload is rejected.

| Variable | Meaning | Example (Dark) |
|---|---|---|
| `--sidebar` | Sidebar & status bar background | `#18181b` |
| `--bg` | Main page background | `#09090b` |
| `--bg2` | Card & modal background | `#27272a` |
| `--bg3` | Hover, active & input background | `#3f3f46` |
| `--border` | Primary border line | `#3f3f46` |
| `--border2` | Secondary border line (lighter) | `#52525b` |
| `--text` | Primary text | `#d4d4d8` |
| `--text2` | Secondary text (dimmed) | `#a1a1aa` |
| `--text3` | Tertiary text (heavily dimmed) | `#71717a` |
| `--white` | Bright contrast text (on dark bg) | `#f4f4f5` |
| `--accent` | Accent colour (buttons, active links) | `#f97316` |
| `--green` | Success / online colour | `#22c55e` |
| `--orange` | Warning / in-progress colour | `#f97316` |
| `--blue` | Info / link colour | `#3b82f6` |
| `--purple` | Alternate accent | `#7c5cbf` |
| `--red` | Error / offline colour | `#ef4444` |

### Optional variables

These variables are not required, but the UI honours them when set:

| Variable | Meaning | Default |
|---|---|---|
| `--font` | CSS font family | `'Inter', sans-serif` |
| `--radius-card` | Corner radius for cards, panels, modals, dropdowns | `6px` |
| `--radius-btn` | Corner radius for buttons, inputs, badges, tags | `4px` |
| `--divider-color` | Colour of horizontal dividers (`<hr>`) | value of `--border` |
| `--divider-accent` | Colour of accent dividers (`.theme-divider-accent`) | value of `--accent` |

#### Radii

`--radius-card` and `--radius-btn` control all rounded UI elements:

| Value | Effect |
|---|---|
| `0px` | Fully squared (technical look) |
| `4px` | Minimally rounded (compact) |
| `6px` | Default |
| `12px` | Strongly rounded (modern look) |
| `9999px` | Fully round (pill shape — only sensible on buttons) |

#### Horizontal dividers

The portal places `<hr>` elements at several spots. Their colour follows `--border` by default, but can be overridden via `--divider-color`:

```json
"--divider-color": "#ff0000"
```

Elements with the class `.theme-divider-accent` (not used in the standard UI today, reserved for future extensions) get a 2px coloured top border:

```json
"--divider-accent": "#ffff00"
```

---

## Dark vs. Light mode

Internally the portal distinguishes Dark and Light themes via a hard-coded ID list. Custom themes are always treated as **Dark** (`html.dark` is set). To make the theme look light, the background variables need to be bright:

```json
"--sidebar": "#f1f5f9",
"--bg":      "#f8fafc",
"--bg2":     "#ffffff",
"--white":   "#0f172a"
```

> **Note:** the built-in themes `dark`, `p3orange` and `hc` are Dark themes; `light` is the only built-in Light theme.

---

## Upload

1. Admin → Settings → Appearance → tab **Themes**
2. Button **Upload theme** (only visible with a P3 Plus licence)
3. Select the `.json` file — it is activated immediately and shown as a preview
4. Optional: **Set as default** — all new users will start with this theme

---

## Example: red high-contrast theme

```json
{
  "name": "Red Alert",
  "author": "admin",
  "version": "1.0",
  "variables": {
    "--sidebar":     "#0d0000",
    "--bg":          "#120000",
    "--bg2":         "#1a0000",
    "--bg3":         "#2a0000",
    "--border":      "#8b0000",
    "--border2":     "#cc0000",
    "--text":        "#ffcccc",
    "--text2":       "#ff9999",
    "--text3":       "#cc6666",
    "--white":       "#ffffff",
    "--accent":      "#ff0000",
    "--green":       "#00ff7f",
    "--orange":      "#ff8c00",
    "--blue":        "#00bfff",
    "--purple":      "#da70d6",
    "--red":         "#ff4444",
    "--font":        "'Inter', sans-serif",
    "--radius-card":    "0px",
    "--radius-btn":     "0px",
    "--divider-color":  "#8b0000",
    "--divider-accent": "#ff0000"
  }
}
```

---

## Tips

- **Check contrast:** `--text` against `--bg2` should meet at least WCAG AA (4.5:1).
- **Accent colour:** `--accent` is used for buttons, active navigation and focus rings — keep it visible.
- **Error tone:** `--red` is used for error badges and error states — pick something different from `--accent`.
- Use `backend/assets/themes/dark.json` as a starting template.
