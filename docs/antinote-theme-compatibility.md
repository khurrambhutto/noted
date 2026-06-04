# Antinote Theme Compatibility Notes

This document tracks Antinote theme fields found in `johnsonfung/antinote-extensions` and how `noted` currently maps or plans to support them.

Source scanned:

- `vendor/antinote-extensions/themes-community/**/*.json`
- `vendor/antinote-extensions/themes-official/**/*.json`

Total theme JSON files scanned: 33.

## Theme schema found

All official and community themes use the same fields:

```json
{
  "name": "Theme Name",
  "isDarkTheme": true,
  "background": "#000000",
  "backgroundFade": "#111111",
  "typeMain": "#ffffff",
  "typeSubtle": "#aaaaaa",
  "typeSubtlePlus": "#bbbbbb",
  "typeHighlight": "#333333",
  "typeLight": "#777777",
  "typeSuperlight": "#444444",
  "typeHyperLight": "#222222",
  "typeReverse": "#000000",
  "accent1Main": "#color",
  "accent1Secondary": "#color",
  "accent1Tertiary": "#color",
  "accent2Main": "#color",
  "accent2Secondary": "#color",
  "accent3Main": "#color",
  "accent3Secondary": "#color",
  "accent4Main": "#color",
  "accent4Secondary": "#color",
  "accent5Main": "#color",
  "accent5Secondary": "#color",
  "gridSuperlight": "#color",
  "gridClear": "#color",
  "gridBold": "#color"
}
```

Both 6-digit hex (`#RRGGBB`) and 8-digit hex with alpha (`#RRGGBBAA`) appear in themes.

## Current support in noted

| Antinote field | Current use in noted |
| --- | --- |
| `name` | Theme display name and saved JSON filename |
| `isDarkTheme` | Sets `data-theme="dark/light"`; used for contrast decisions |
| `background` | Main app/window background |
| `backgroundFade` | Settings panel secondary surface / future code block surface |
| `typeMain` | Main textarea text color |
| `typeSubtle` | Labels / secondary settings text and normal editor links |
| `typeSubtlePlus` | UI accent text and shortened editor links |
| `typeHighlight` | Text selection highlight and scrollbar thumb |
| `typeLight` | Placeholder text, quiet UI text, and checked checklist text |
| `typeSuperlight` | Stored as CSS var for future use |
| `typeHyperLight` | Hover/surface stub for future UI states |
| `typeReverse` | Reverse text color, but currently adjusted for button contrast |
| `accent1Main` | Caret, active note dot, primary settings button, and list keyword color |
| `accent1Secondary` | Stored as CSS var |
| `accent1Tertiary` | Stored as CSS var |
| `accent2Main` | Checklist checkbox hover |
| `accent2Secondary` | Checked checklist checkbox |
| `accent3Main` | Stored as future stub |
| `accent3Secondary` | Stored as future stub |
| `accent4Main` | Stored as future stub |
| `accent4Secondary` | Stored as future stub |
| `accent5Main` | Close/danger color |
| `accent5Secondary` | Stored as future stub |
| `gridSuperlight` | Optional vertical grid line |
| `gridClear` | Optional horizontal grid line |
| `gridBold` | Theme preview swatch / future bold grid line |

## Compatibility behavior added

- Imported Antinote themes are saved as real JSON files in the app data folder under `themes/`.
- Built-in themes are only `Noted Light`, `Noted Paper`, and `Noted Dark`.
- Imported theme colors are validated.
- Alpha hex colors are accepted.
- Themes with alpha backgrounds are treated as translucent and get a glass/blur window style where possible.
- Grid is optional and auto-enabled only when visible grid colors are present.

## Future work / skipped features

These need a richer editor than native `<textarea>`.

### Inline syntax highlighting

Native textarea cannot color individual words. To support this, use one of:

- CodeMirror
- a custom `contenteditable` editor
- textarea + mirrored highlighted overlay

Future token mapping:

| Feature | Suggested token |
| --- | --- |
| Links | `typeSubtle` |
| Shortened links | `typeSubtlePlus` |
| Highlighted text background | `typeHighlight` |
| Checked/strikethrough text | `typeLight` |
| H1 / main keyword / caret | `accent1Main` |
| H2 / variable assignment | `accent1Secondary` |
| H3 / variable use | `accent1Tertiary` |
| List keyword / caret | `accent1Main` |
| Checkbox hover | `accent2Main` |
| Checked checkbox | `accent2Secondary` |
| Sum/math total/pinned state | `accent3Main` |
| Sum secondary/pinned hover | `accent3Secondary` |
| Warning/code/timer keyword | `accent4Main` |
| Average total | `accent4Secondary` |
| Error/count keyword | `accent5Main` |
| Count total | `accent5Secondary` |

### Code blocks

Suggested mapping:

| Code block piece | Suggested token |
| --- | --- |
| Code block background | `backgroundFade` |
| Code text | `typeMain` |
| Inline code background | `backgroundFade` |
| Inline code border/highlight | `typeHighlight` |

### Grid improvements

Current grid uses `gridSuperlight` and `gridClear`. Future improvements:

- Use `gridBold` every N grid cells.
- Add setting to toggle grid per theme.
- Better baseline alignment after custom font/size settings are added.

### Translucency / glass themes

Themes with alpha colors, e.g. North Star, need more native support:

- Native window blur/transparency per platform.
- User-adjustable background opacity.
- Softer grid intensity in translucent mode.
- Different behavior on Windows vs Linux compositors.

## Known visual limitations

- Textarea cannot render per-token colors.
- Textarea cannot style individual checkboxes, links, headings, code blocks, or math results.
- Linux transparency/blur support depends on compositor/window manager.
- Windows transparency/blur may need extra Tauri/window APIs later.
