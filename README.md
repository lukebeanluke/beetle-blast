# beetle blast

A 3D bug-popping arena game that runs in the browser. Built with plain JavaScript and
[three.js](https://threejs.org/) on a Jekyll site for GitHub Pages.

# play it now!

https://lukebeanluke.github.io/beetle-blast/

## Controls

| Action | Desktop | Phone or tablet |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Aim | Mouse | Drag the right side |
| Shoot | Click | Fire button |
| Jump over bugs | Space | Jump button |
| Sprint | Shift | |
| Slide | C | Slide button |
| Switch gun | 1-6, Q or mouse wheel | Gun buttons |
| Pause | Esc or P | Pause button |
| Mute | M | Sound toggle on the title screen |


## Make it yours

Everything tunable sits at the top of `assets/js/game.js` (island size, speed, fire rate, how many bugs
at once) and in the `BUG_TYPES` table (health, speed, size, color, score). Colors and fonts for the
menus and HUD are variables at the top of `assets/css/style.css`.

three.js loads from cdnjs. To host it yourself, download `three.min.js` (r128) into `assets/js/` and
point the script tag in `index.html` at it.

Your best score is saved in the browser with `localStorage`.

## Guns, bugs and bosses

Press **C** (or tap **Slide** on a phone/tablet) for a short forward burst. Sliding lowers the camera, briefly increases movement speed, and has a short cooldown. Jumping cancels a slide.

Six guns: Blaster, Scatter, Rail, Needler (fast, loose spread), Arc (lightning jumps to nearby bugs) and Boomer (explosive shell with splash damage, also blows up on the ground). Twelve bug types appear over the waves, and bosses show up on wave 10 (Titan Beetle) and wave 15 (Hive Queen). Edit `WEAPONS`, `BUG_TYPES` and `BOSS_WAVES` in `assets/js/game.js` to tune them.
