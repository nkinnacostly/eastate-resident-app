import { Composition } from 'remotion';

import { FPS, H, INTRO_TOTAL, TOTAL, W } from './kit';
import { Intro } from './videos/Intro';
import { What } from './videos/What';
import { When } from './videos/When';
import { Where } from './videos/Where';
import { Who } from './videos/Who';
import { Why } from './videos/Why';

/** The series in order. Each is 1080x1350 (4:5), 30fps, exactly 90 seconds. */
const VIDEOS = [
  { id: 'Who', component: Who },
  { id: 'What', component: What },
  { id: 'Why', component: Why },
  { id: 'Where', component: Where },
  { id: 'When', component: When },
];

export function Root() {
  return (
    <>
      {/* The 60-second introduction that leads into the series. */}
      <Composition id="Intro" component={Intro} durationInFrames={INTRO_TOTAL} fps={FPS} width={W} height={H} />
      {VIDEOS.map((v) => (
        <Composition key={v.id} id={v.id} component={v.component} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
      ))}
    </>
  );
}
