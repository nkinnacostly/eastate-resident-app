import { Composition } from 'remotion';

import { FPS, H, TOTAL, W } from './kit';
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
      {VIDEOS.map((v) => (
        <Composition key={v.id} id={v.id} component={v.component} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
      ))}
    </>
  );
}
