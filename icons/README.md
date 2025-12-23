# Icons Folder

This folder contains SVG icons that need to be converted to PNG for Chrome.

## Required PNG Files

- `icon16.png` - 16x16 pixels (toolbar icon)
- `icon48.png` - 48x48 pixels (extensions page)
- `icon128.png` - 128x128 pixels (Chrome Web Store, installation dialog)

## Converting SVG to PNG

The SVG source files are provided. Convert them using one of these methods:

### Option 1: Online Converter
Visit https://svgtopng.com/ and upload each SVG file.

### Option 2: Command Line (requires Inkscape or ImageMagick)
```bash
# Using Inkscape
inkscape icon16.svg -w 16 -h 16 -o icon16.png
inkscape icon48.svg -w 48 -h 48 -o icon48.png
inkscape icon128.svg -w 128 -h 128 -o icon128.png

# Using ImageMagick
convert -background none icon16.svg -resize 16x16 icon16.png
convert -background none icon48.svg -resize 48x48 icon48.png
convert -background none icon128.svg -resize 128x128 icon128.png
```

### Option 3: Quick Development Placeholders
Create simple colored PNG squares for testing until final icons are ready.

## Icon Design

The included SVGs feature:
- Dark blue background (#1a1a2e)
- Blue skip/forward icon (#4a9eff)
- Rounded corners for modern look
