# The bottom bar

The app's tab bar is native: the remote config's `eitriConfig.dynamicBottomBar` draws it, not Luminus. It is
part of every screen, so it gets the same care as the home: **as close to the store's own mobile tab bar as the
platform allows** — its shape, colors, icons, tab order and labels. What the platform cannot draw is written down
as a gap; it is never a reason to leave the template's bar (white, generic icons, the template's tabs).

Official schema: <https://cdn.83io.com.br/library/eitri-shopping-modules-doc/doc/latest/classes/_internal_.DynamicBottomBar.html>.

## Where the bar comes from (why it shows white in Eitri Play)

| How the app is opened | The bar it shows |
|---|---|
| A published environment (Eitri Play → app → `dev`, a native build) | the environment's config, `eitriConfig.dynamicBottomBar` |
| `eitri app start` (its QR code / Eitri Play dev session) and **snapshots** | the repo's `dynamic-bottom-tab-view-spec.json` (look) + `app-config.yaml` → `bottom-tab-view-simulation` (tabs), which **replace** the environment's bar |
| `eitri app dynamic-bottom-bar -e <env>` | sends the spec file into that environment's `eitriConfig.dynamicBottomBar` (same field as `update_environment_config`). **Do not use it**: the spec has no `initParams`, so the tabs lose their routes (Categories, Wishlist) and open each mini-app's first screen. Write the bar with `update_environment_config`. |

So the config and the two simulation files must always say the same thing. The template ships a white bar in
the spec: a run that styles only the config shows the store's bar on `dev` and a white one in every
`eitri app start` session and snapshot. `bottom-bar.mjs sync` writes both files from the config; run it after
every change to the bar, and `sync --check` before each push and snapshot.

## Steps

1. **Capture** the store's bar (after the home capture, Phase 2):
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/bottom-bar.mjs capture --capture scrape/home --out .eitri/bottom-bar
   ```
   It opens the captured page live at 375 px (the capture's rendered DOM is the fallback), finds the fixed bar
   at the bottom with three or more icon buttons and writes `.eitri/bottom-bar/`: `bar.json` (measurements, the
   tabs with label, link, `kind` and which is active, the closest `layout` and its `warnings`), `store-bar.png`
   and `icons/NN-<kind>.png` — each icon as the bar needs it. Look at `store-bar.png` and the icons.
   Exit 2: the store has no bottom tab bar on phones. Keep the template's tabs, but still give the bar the
   store's colors (header/brand background, its icon color) and say so in the handoff.
2. **Tabs** — the store's tabs, in the store's order, each opening the app's screen for the same thing
   (`kind` from `bar.json`):

   | Store tab kind | App tab |
   |---|---|
   | `home` | home mini-app, `{ tabIndex }` |
   | `categories` (menu, departments, a search tab) | home, `{ tabIndex, route: "Categories" }` (it has the search) |
   | `wishlist` | account, `{ tabIndex, route: "Wishlist" }` |
   | `cart` | cart mini-app, `{ tabIndex }` |
   | `account` | account mini-app, `{ tabIndex }` |
   | `offers` | home, `{ tabIndex, route: "LandingPage" }` |
   | `help`, `notifications`, `stores` | no app screen: left out, a gap line (a tab opens a mini-app, never the browser) |

   `tabIndex` is the tab's position. Titles are the store's labels (its `aria-label`/`title`), even when the
   bar hides labels: screen readers and the classic fallback use them. A store tab the app has no screen for
   is left out and listed as a gap; keep the bar between 3 and 5 tabs. When the store's bar has no
   `categories` tab (it reaches them from its header menu) and the app's header has no menu, add the app's
   `categories` tab after home, or the app has no way to its categories; say so. A raised center button
   (`bar.json` warning) becomes a regular tab in the store's position. When the store marks no open tab, the
   app still should: use the brand color (theme `primary`) as `selectedColor` if it reads on the bar.
3. **Icons** — the bar takes PNGs only: `https`, square (≈96 px), transparent, one flat color (the bar repaints
   them with `selectedColor`/`unselectedColor`). `bottom-bar.mjs capture` already turned the store's own icons
   into exactly that. They need a public https host:
   - **The store's own icons** (best): ask the Eitri team to host `.eitri/bottom-bar/icons/*.png` under
     `https://media-eitri-content.eitri.tech/<app-name>/` (where production apps' brand icons live), or use any
     public https host the user names. Never a private repo's raw URL, never a `data:` URL.
   - **Until then, the closest Material icon** (public, used by production apps), by shape — outlined when the
     store's are outlined, rounded when they are filled:
     `https://raw.githubusercontent.com/google/material-design-icons/master/png/<category>/<name>/materialiconsoutlined/48dp/2x/outline_<name>_black_48dp.png`
     (rounded: `materialiconsround` / `round_`). Known to exist:

     | Store icon | `<category>/<name>` |
     |---|---|
     | house | `action/home` |
     | magnifier | `action/search` |
     | lines + magnifier (search menu) | `search/manage_search` |
     | three lines (menu) | `navigation/menu` |
     | grid / departments | `file/grid_view` |
     | list | `action/list` |
     | heart (outline / filled) | `action/favorite_border` / `action/favorite` |
     | shopping bag | `action/shopping_bag` |
     | cart | `action/shopping_cart` |
     | person (outline / filled) | `social/person_outline` / `social/person` |
     | person in a circle | `action/account_circle` |
     | basket | `action/shopping_basket` |
     | tag / offer | `maps/local_offer` |
     | store front | `places/storefront` |

     Any other name: check it answers 200 before using it (`curl -sI <url>`). The template's
     `media-eitri-content.eitri.tech/default/icon_*_v1.png` is the last resort, only for a tab no closer icon
     exists for.
   Keep the generated store icons in the repo (`.eitri/bottom-bar/icons/`) either way, and list them in the
   handoff as "to host", with the Material stand-ins they replace.
4. **Look** — `bar.json` → `layout` is the store's bar translated to the schema; take it as is unless the
   compare says otherwise:
   - `theme: "floating"` when the store's bar is detached (side or bottom gap, pill/rounded): `bottomMargin`,
     `cornerRadius` (omitted = pill), `elevation` (a shadow), `stroke`, `tabWidth: "equal"` for a bar across the
     screen, `labelVisibility: "unlabeled"` when the store shows no labels, `activeIndicator` when the active
     tab sits on a circle/pill. A bar glued to the bottom edge is `classic`.
   - Height: no field sets it — it is `paddingTop` + `iconSize` (+ label) + `paddingBottom`, per theme node
     (floating defaults 10/24/10 = 44 pt unlabeled; classic 6/24/6). Without labels `capture` sets the paddings
     from the store's bar height and icon size; with labels, match it by eye in the compare.
   - `bottomMargin` (default 16) is measured from the top of Android's navigation bar, and on iOS from the
     screen bottom with the home-indicator area as the floor: on iPhones with a home indicator a value under
     ~34 changes nothing there.
   - `themeCustomizations.classic` is **always** written too: an unknown theme falls back to classic, and native
     builds older than the floating theme read only that node — the app must still look right there
     (`labels` like the store, `topBorder` 0 or in the bar's color for a floating store bar).
   - Colors from the store: `backgroundColor` (the bar), `unselectedColor` (its icons), `badgeBackground` /
     `badgeTextColor` (the cart counter). `selectedColor` must read on `backgroundColor` (contrast ≥ 3): classic
     has no indicator, so a store whose active icon is white on a dark circle gets the circle's color as
     `selectedColor` and the floating indicator becomes a tint of it. `bar.json` → `warnings` says when that
     happened; copy each one into the handoff.
   - What the schema cannot do (a solid indicator with a different icon color, a center "action" button, an
     icon per state, a fixed height, rounded top corners on a bar glued to the bottom): the closest setting, plus a gap line. Do not drop the rest of the look
     because one part is impossible.
5. **Write** the layout and icons into the config, then the simulation files:
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/bottom-bar.mjs apply --config .eitri/remote-config.json --bar .eitri/bottom-bar/bar.json \
       --icon 0=<url> --icon 1=<url> …        # tab index = position in eitriApps; each URL is checked (https, 200, square PNG with alpha)
   node ${CLAUDE_SKILL_DIR}/scripts/bottom-bar.mjs sync --repo . --config .eitri/remote-config.json
   ```
   Edit the tabs (`eitriApps`: order, `slug`, `title`, `initParams`) in the config by hand first (step 2), then
   `apply` and `sync`. Copy the bar into `.eitri/remote-config.example.json` (and the root `remoteConfig.json` when it
   is this app's config — not when it is still the template's sample store) so they never disagree. The config reaches the environments in
   Phase 3 → `update_environment_config` (dev, then prod with `allowProduction`); a bar changed after that is
   written again the same way, `dev` first.
6. **Compare**: open the app with `eitri app start` in Eitri Play (the simulation) and on `dev` (the config), next
   to `.eitri/bottom-bar/store-bar.png`. Note in the handoff each difference that is left and why.
