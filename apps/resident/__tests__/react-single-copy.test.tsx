import { render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

function Hook() {
  const [n] = useState(7);
  return <Text>value {n}</Text>;
}

/**
 * Canary for the monorepo's React duplication problem.
 *
 * react-test-renderer hoists to the repo root while Expo pins React 19.1.0 in
 * the app workspace. If a second React reappears at root, every hook-using test
 * fails with "Invalid hook call" — this one fails first and says why.
 * Guarded by `overrides` in the root package.json and jest moduleNameMapper.
 */
it('renders a component with hooks against exactly one React', () => {
  render(<Hook />);
  expect(screen.getByText('value 7')).toBeTruthy();
});
