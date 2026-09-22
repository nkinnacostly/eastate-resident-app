const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Raise every CocoaPods target to the app's iOS deployment target.
 *
 * Xcode 27 refuses to build anything whose IPHONEOS_DEPLOYMENT_TARGET is below
 * 15.0. React Native's own `react_native_post_install` already raises the pods'
 * main targets, but it does not touch their RESOURCE BUNDLE targets, and four
 * of ours still ship with ancient values:
 *
 *   SDWebImage-SDWebImage                       9.0
 *   ReachabilitySwift-ReachabilitySwift        12.0
 *   RNSVG-RNSVGFilters                         12.4
 *   RNCAsyncStorage-RNCAsyncStorage_resources  13.4
 *
 * Each one fails the build outright, so a local `expo run:ios` on Xcode 27 dies
 * before compiling a single file of ours.
 *
 * WHY A PLUGIN RATHER THAN EDITING ios/Podfile
 *
 * `ios/` is generated and gitignored. Editing the Podfile there fixes the build
 * until the next `expo prebuild`, which overwrites it and brings the failure
 * back with no trace of why it was ever working. A plugin is the only place the
 * fix survives, and the only place the reason is visible to the next person.
 *
 * WHY IT MATTERS EVEN THOUGH EAS BUILDS PASS
 *
 * EAS is on an older Xcode at the time of writing, so cloud builds do not hit
 * this. That is a reprieve, not a difference of opinion — when EAS moves to
 * Xcode 27 the cloud builds fail exactly the same way. Fixing it here means
 * that upgrade is uneventful.
 */
const DEPLOYMENT_TARGET = '15.1';

const PATCH = `
    # Added by plugins/with-pod-deployment-target.js — see that file for why.
    # react_native_post_install raises the pods' main targets but not their
    # resource bundle targets, several of which still declare 9.0-13.4. Xcode 27
    # rejects anything below 15.0, so those targets fail the build outright.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |cfg|
        current = cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || current.to_f < ${DEPLOYMENT_TARGET}
          cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}'
        end
      end
    end
`;

const MARKER = 'plugins/with-pod-deployment-target.js';

module.exports = function withPodDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const src = fs.readFileSync(podfile, 'utf8');

      // Prebuild can run more than once against the same Podfile.
      if (src.includes(MARKER)) return cfg;

      // Anchor on the closing paren of the react_native_post_install call rather
      // than on `post_install do`, so the patch lands AFTER that call has set
      // its own values — otherwise it would overwrite ours.
      const anchor = /(\n\s*\)\n)(\s*end\s*\nend\s*)$/;
      if (!anchor.test(src)) {
        throw new Error(
          'with-pod-deployment-target: could not find the end of post_install in ios/Podfile. ' +
            'The Expo template changed shape — update this plugin rather than deleting it, ' +
            'or Xcode 27 builds will fail on pod resource bundles again.',
        );
      }

      fs.writeFileSync(podfile, src.replace(anchor, `$1${PATCH}$2`), 'utf8');
      return cfg;
    },
  ]);
};
