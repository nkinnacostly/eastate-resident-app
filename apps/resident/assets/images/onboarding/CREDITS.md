# Onboarding photography

Both images are from [Unsplash](https://unsplash.com) under the
[Unsplash License](https://unsplash.com/license): free for commercial use, no
permission needed, **attribution not required**. They are credited here anyway
because the marketing site credits its photographers in the footer, and the two
sets should not drift apart.

Neither is an Unsplash+ / premium photo — both were checked (`plus: false`,
`premium: false`) before use. That matters: Unsplash+ images look identical in
search results but carry a subscription licence that this project does not hold.

| file | photographer | source |
|---|---|---|
| `sending-a-code.jpg` | [Ruan Richard Rodrigues](https://unsplash.com/@ricdeoliveira) | [unsplash.com/photos/pK3ozoRgQGc](https://unsplash.com/photos/pK3ozoRgQGc) |
| `estate-gate.jpg` | [Long Chung](https://unsplash.com/@chungj07) | [unsplash.com/photos/BtLoUZ6Ic7I](https://unsplash.com/photos/BtLoUZ6Ic7I) |

`estate-gate.jpg` is the same photograph the marketing site uses on its home
page, so the first screen of the app and the page that sold it show the same
gate.

## Deriving the files again

Both are cropped to 4:3 to match the hero frame, sized for a 3× screen at the
hero's maximum width (~453 pt), and encoded at `q=55` — checked at full size
against `q=62` and `q=72` with no visible difference, which saved ~90 KB.

    # sending-a-code.jpg — 1200×900, 113 KB
    curl -L "https://images.unsplash.com/photo-1689799514696-b16af9b53753?fit=crop&w=1200&h=900&q=55&fm=jpg" \
      -o sending-a-code.jpg

    # estate-gate.jpg — 1200×900, 212 KB
    # The default centre crop leaves the boom and guard house small in frame;
    # the focal point pulls them up to fill it.
    curl -L "https://images.unsplash.com/photo-1775112077888-8fa36e9bbc51?fit=crop&crop=focalpoint&fp-x=0.62&fp-y=0.58&fp-z=1.7&w=1200&h=900&q=55&fm=jpg" \
      -o estate-gate.jpg

JPEG, not WebP: at this quality Unsplash's WebP encoder produced *larger* files
than its JPEG one (214 KB vs 157 KB on the phone photo), so the usual reason to
reach for WebP does not apply here.
