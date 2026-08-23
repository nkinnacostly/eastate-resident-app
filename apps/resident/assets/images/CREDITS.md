# App photography

`splash-gate.jpg` — the launch screen background.

| | |
|---|---|
| Photographer | [Aleksi Partanen](https://unsplash.com/@aleksi_p) |
| Source | [unsplash.com/photos/03JvsYNN068](https://unsplash.com/photos/03JvsYNN068) |
| Licence | [Unsplash License](https://unsplash.com/license) — commercial use, no permission needed, attribution not required |

Checked as a standard free photo (`plus: false`, `premium: false`) before use.
Unsplash+ images look identical in search results but carry a subscription
licence this project does not hold.

A residential gate at dusk with a lit lantern and a house number on the pillar —
the exact moment the product is about, and dark enough that a lime mark sits on
it without a heavy scrim.

    # 1200×2600, tall crop: the splash is full-bleed portrait and `cover`
    # trims the sides on wider handsets, never the vertical.
    #
    # bri/con/sat lift the exposure. The original is a true dusk frame and is
    # genuinely dark — under even a light scrim the gate and lantern
    # disappeared entirely and the splash read as a plain dark screen. The
    # brightening is what makes the photograph legible as a photograph.
    curl -L "https://images.unsplash.com/photo-1747903933761-c1d682eecd1c?fit=crop&w=1200&h=2600&q=62&fm=jpg&bri=22&con=10&sat=-5" \
      -o splash-gate.jpg

Onboarding photography is credited separately in
[`onboarding/CREDITS.md`](onboarding/CREDITS.md).
