// Expo SDK 52+ auto-configures monorepo resolution (watchFolders /
// nodeModulesPaths), so this file deliberately sets NONE of that — it only
// layers NativeWind on top of the default config.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
