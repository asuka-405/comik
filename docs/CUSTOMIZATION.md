# Customizing the interface

Comik is drawn with CSS variables, so you can change it at three levels: pick a built-in theme, edit a theme of your own, or write CSS that restyles any element. All of it lives in Settings, Appearance. Nothing here can run code, and everything can be switched off again.

## Built-in themes

Pick one in Settings, Appearance, Theme. The dark themes have rounded corners by default; the light ones are square unless you change the radius.

- **Moss dark** and **Moss light**: the default look.
- **Midnight**, **Pure black**, **Nord**, **Dracula**, **Deep forest**, **Ocean**: calm dark themes.
- **Neon city**, **Arcade cabinet**, **Night carnival**, **Botanical after dark**, **Kinetic rave**, **Synthwave postcard**: louder dark themes with a stronger accent.
- **Sakura** and **Paper**: light themes.
- **System** follows your device and switches between Moss dark and Moss light.

## Make your own theme

Choose New theme. A new theme starts as a copy of whatever is showing, so you never start from a blank page. A theme is four things:

- **Base**: dark or light. This picks the default colors and tells the browser which form controls and scrollbars to draw.
- **Colors**: any of the fourteen colors below. A color you leave alone keeps the base value.
- **Corner radius**: 0 to 24 pixels. 0 is square, 8 to 12 is soft, 24 is pill-like.
- **Font**: Plus Jakarta Sans (the default), System UI, Serif, Rounded or Monospace.

| Color | Variable | What it paints |
|---|---|---|
| Background | `--canvas` | The page behind everything |
| Cards | `--surface` | Panels, inputs, list rows |
| Raised cards | `--surface-2` | Hover states, menus, tags |
| Headings | `--ink` | Titles and the strongest text |
| Body text | `--text` | Paragraphs |
| Quiet text | `--muted` | Hints and secondary labels |
| Accent | `--accent` | Buttons, selection, focus |
| Accent, second tone | `--accent-2` | Gradients and highlights |
| Text on accent | `--on-accent` | Text drawn on top of the accent |
| Teal, Gold, Blue, Green, Pink | `--teal`, `--gold`, `--blue`, `--green`, `--pink` | Series colors, badges and community accents |

Colors must be hex values such as `#ff4d94` or `#f4d`. Anything else is ignored. Borders, the soft accent, the hover accent and the focus ring are worked out from your colors with `color-mix`, so changing the accent recolors all of them together.

## Share a theme

The Copy to share button on an open theme puts it on your clipboard as a small JSON file (or downloads it if the clipboard is blocked). Import file and Paste theme add one to your list. Duplicate makes an editable copy of any theme. If the file carries custom CSS, Comik turns custom CSS on and fills the box with it, so read it first.

```json
{
  "comikTheme": 1,
  "name": "Bubblegum night",
  "base": "dark",
  "colors": { "canvas": "#1a1024", "accent": "#ff4d94", "accent-2": "#ff8cc0" },
  "radius": 16,
  "font": "rounded",
  "css": "body { --gold: #ffd166; }"
}
```

The importer checks every field: unknown colors and non-hex values are dropped, the radius is clamped to 0 to 24, an unknown font becomes the default, the name is cut to 40 characters and the CSS to 60,000.

## Custom CSS

Settings, Appearance, Custom CSS takes any stylesheet. It is added after Comik's own styles, applies live and syncs with your other settings. The switch above the box turns it off without deleting it, which is the quickest way out of a rule that made the app hard to use.

```css
/* Variables go on body, which beats the theme's own values. */
body { --accent: #ff4d94; }

/* Any element can be restyled. Round every card: */
.panel, .cover .art, .list-row { border-radius: 14px; }

/* Hide the 3D backdrop and soften the page: */
.bg { display: none; }
```

### Why variables go on `body`

A theme writes its colors on the root element. Custom CSS loads later, but a variable set on `body` is closer to the elements that use it, so it wins even against a theme. Use `body { --accent: ... }` for colors and `html` or `:root` only when you want the theme to be able to override you.

### Targeting dark or light, or one theme

The root element carries two attributes you can use in selectors:

- `data-theme` is `dark` or `light`: the base of the active theme.
- `data-skin` is the id of the active theme: `dark`, `midnight`, `cyber`, `sakura` and so on, or `user-…` for your own.

```css
/* Only in light themes */
:root[data-theme="light"] .panel { box-shadow: 0 8px 24px rgba(0, 0, 0, .12); }

/* Only in one theme */
:root[data-skin="amoled"] .bg { display: none; }
```

### Classes worth knowing

Open the developer tools (F12 on the web and desktop apps) and inspect anything to find its class. These are the ones that cover most of the interface:

| Class | What it is |
|---|---|
| `.bg` | The animated background layer (`.bg-grid`, `.bg-glow`, `.bg-vignette` inside it) |
| `.rail` | The side navigation on wide screens |
| `.page`, `.topbar` | The page container and its title row |
| `.panel` | The cards used for settings sections, details and forms |
| `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.sm` | Buttons |
| `.input` | Text fields and selects |
| `.chip`, `.chip.on`, `.seg` | Filter chips and segmented controls |
| `.tag` | Small labels such as the media type |
| `.grid` | The cover grid on shelves and Discover |
| `.cover`, `.cover .art`, `.cover .name` | One title: the card, its image and its name |
| `.list-row` | A row in a list of titles or chapters |
| `.sheet` | Side sheets and dialogs |
| `.reader` | The full-screen reader (`.stage` holds the pages) |
| `.community-post` | A post in the community feed |

Class names can change between releases. Variables are the stable part, so prefer them when you can.

### Recipes

```css
/* Pill-shaped buttons and chips */
.btn, .chip, .tag, .seg, .seg button { border-radius: 999px; }

/* Flat look: remove the offset shadows on hover */
.btn:hover, .chip.on, .cover:hover .art { box-shadow: none; }

/* Bigger covers on wide screens */
.grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }

/* A different font for titles only */
.topbar h1, .panel h2 { font-family: Georgia, serif; }

/* Calm the page: no background animation */
.bg-grid, .bg-glow { animation: none; }

/* Use your own image as the backdrop */
body { background: url("https://example.com/backdrop.jpg") center / cover fixed; }
.bg { opacity: .35; }
```

### Safety

CSS cannot run code, but it can load images and fonts from the web, which tells the host that you opened Comik. Only paste CSS from people you trust. Imported theme files can include CSS, and the importer fills the Custom CSS box with it and says so, so read the box after an import.

If a change leaves the app unusable, turn off Use custom CSS in Settings, or clear the box. If you cannot reach Settings, open the web app in a private window, which starts without your saved settings.

## Where the settings live

The theme, your themes and the custom CSS are ordinary settings. They are stored on your device and, if you sync, in your own `users/{uid}` area, which only you can read. Comik never uploads them anywhere public.
