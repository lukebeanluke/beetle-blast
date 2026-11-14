# Web Hunter

A 3D bug-popping arena game that runs in the browser. Built with plain JavaScript and
[three.js](https://threejs.org/) on a Jekyll site for GitHub Pages.

## Put it online

1. Copy everything in this folder into the root of your repository and commit it.
2. In the repo, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/jekyll-gh-pages.yml` builds the site and
   publishes it at `https://<your-username>.github.io/<repo-name>/`.

If your default branch is not `main`, change `branches: ["main"]` in the workflow file.
If you already have a Jekyll Pages workflow, keep yours and skip the one in this folder.

## Run it locally

```
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000.

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

## Turn on the shared leaderboard

The game works without this. To get a global top 10 that every visitor sees, give it a free
[Firebase Realtime Database](https://firebase.google.com/):

1. In the Firebase console, add a project (you can skip Google Analytics).
2. Open **Build > Realtime Database** and click **Create database**. Pick any location and start in locked mode.
3. On the **Rules** tab, paste the contents of `firebase-rules.json` from this repo and click **Publish**.
4. Copy the database URL shown at the top of the **Data** tab (it looks like `https://your-project-default-rtdb.firebaseio.com`).
5. Paste it between the quotes in `assets/js/config.js`, then commit and push.

Players type a name on the title screen. When a run ends, the score is posted if it would place in the
top 10, and the board shows on the Game Over screen.

The rules let anyone read scores and add a new score, but not edit or delete existing ones, and they cap
each field at sane values. Scores are sent from the browser, so a determined player could still post a made-up
score within those caps. For a casual game that is usually fine; to stop it you would need a server that
verifies runs.

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
