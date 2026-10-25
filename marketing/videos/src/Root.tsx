import { Composition } from 'remotion';

import { FORMATS, FPS, INTRO_TOTAL, TOTAL } from './kit';
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
      {VIDEOS.flatMap((v) =>
        Object.entries(FORMATS).map(([format, size]) => {
          const id = format === '9x16' ? v.id : `${v.id}-${format}`;
          return <Composition key={id} id={id} component={v.component} durationInFrames={v.frames} fps={FPS} {...size} />;
        }),
      )}
    </>
  );
}
