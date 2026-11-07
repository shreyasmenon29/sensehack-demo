# Sensehack – cockpit view with real Earth

Three.js Earth with a scroll-driven descent: orbit view, dive toward Earth, fly through a 3D cloud layer, then track cards rise into view. Edit TRACKS in main.js.

## Run
Browsers block textures and modules on file://, so serve the folder:
- Windows: double-click `run.bat` (needs Python), then open http://localhost:8000
- Mac/Linux: `sh run.sh`, then open http://localhost:8000
- Or: `npx serve` in this folder.

## Tweak (main.js)
- Earth position/size in frame: `group.position`, `camera.position`
- Sun angle and brightness: `sun`
- Facing region: `earth.rotation.y` (currently India)
- Atmosphere strength: `atmOpacity`, `atmMultiplier`

## Credits
Earth technique: Franky Hung, "Make Your Own Earth in Three.js" (github.com/franky-adl/threejs-earth).
Textures from NASA Visible Earth / SVS and ESA Gaia (check their licences for attribution): Blue Marble albedo, topography, clouds, city lights, ocean mask, Gaia EDR3 sky.
Three.js r160 (MIT) bundled in lib/.
