# Black Challet Villa — Backyard scan viewer

Interactive 3D viewer for a photogrammetry scan of the Black Challet Villa backyard & pool, built from 30 Sony A7R V survey photos with COLMAP and OpenMVS.

**Live:** https://mohab-collab.github.io/black-challet-villa-viewer/

## Controls

- **Orbit** — left-drag rotate, right-drag pan, wheel zoom, double-click to set the pivot.
- **Fly / walk** (press **F**) — drag to look, **W A S D** move, **Q / E** down / up, **Shift** fast, wheel changes speed.
- **Jump to photo** — move to any of the 30 original photo positions.
- **Lighting** — sun direction, height, intensity and colour temperature with shadows; ambient sky/ground colours; physical sky; exposure; presets.
- **Shading** — *Photo (unlit)* shows the captured texture; *Relit* lights the scan with the controls above (the photo's own sunlight is baked into the texture).

## Notes

- Scale is approximate (assumes a ~1.6 m camera height); use the Scale slider to adjust.
- The pool water and the matte black walls are not reconstructed (reflective / textureless surfaces).
- Meshes are Draco-compressed glTF; three.js r170 is vendored under `vendor/three` (MIT licence).
