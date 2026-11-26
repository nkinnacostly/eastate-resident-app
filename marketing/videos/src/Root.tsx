import { Composition } from 'remotion';

import { FORMATS, FPS, INTRO_TOTAL, TOTAL } from './kit';
import { ART, BROCHURE_ESTATE, FRAME } from './trustees/BrochureArt';
import { EstateName } from './trustees/screens';
import { Film, filmFrames } from './trustees/Film';
import { Intro } from './videos/Intro';
import { What } from './videos/What';
import { When } from './videos/When';
import { Where } from './videos/Where';
import { Who } from './videos/Who';
import { Why } from './videos/Why';

/** The 60-second intro, then the series in order at exactly 90 seconds each. */
const VIDEOS = [
  { id: 'Intro', component: Intro, frames: INTRO_TOTAL },
  { id: 'Who', component: Who, frames: TOTAL },
  { id: 'What', component: What, frames: TOTAL },
  { id: 'Why', component: Why, frames: TOTAL },
  { id: 'Where', component: Where, frames: TOTAL },
  { id: 'When', component: When, frames: TOTAL },
];

/** Each video in each format: `Who` is 9:16 (Reels, TikTok), `Who-4x5` the feed cut. */
export function Root() {
  return (
    <>
      {/* The trustees' walkthrough: 16:9, under ten minutes, captions and music. */}
      <Composition id="Trustees" component={Film} durationInFrames={filmFrames()} fps={FPS} width={1920} height={1080} />
      <Composition id="Trustees-9x16" component={Film} durationInFrames={filmFrames()} fps={FPS} width={1080} height={1920} />
      {/* Stills for the image-led brochure: transparent PNGs, rendered at FRAME. */}
      {ART.map((a) => (
        <Composition key={a.id} id={`Art-${a.id}`} component={() => <EstateName.Provider value={BROCHURE_ESTATE}>{a.el}</EstateName.Provider>} durationInFrames={FRAME + 1} fps={FPS} width={a.width} height={a.height} />
      ))}
      {VIDEOS.flatMap((v) =>
        Object.entries(FORMATS).map(([format, size]) => {
          const id = format === '9x16' ? v.id : `${v.id}-${format}`;
          return <Composition key={id} id={id} component={v.component} durationInFrames={v.frames} fps={FPS} {...size} />;
        }),
      )}
    </>
  );
}
