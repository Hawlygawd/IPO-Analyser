#!/usr/bin/env node
/**
 * Turns the generated `android/` project (from `npx expo prebuild`) into a shareable
 * release build. Run this after prebuild and before `./gradlew assembleRelease`.
 *
 *   node scripts/android-release.mjs
 *
 * It does three things, each of which fails loudly instead of silently producing a bad APK:
 *
 *  1. ABIs - the app ships Reanimated/Worklets C++ that Gradle compiles per ABI. The default
 *     four ABIs roughly double the build time and the download size for no benefit on real
 *     phones, so the build is limited to the phone ABIs (override with REACT_NATIVE_ARCHITECTURES).
 *  2. Gradle memory - the template's 2 GB heap is tight for the C++ builds; raise it and turn
 *     on the build cache.
 *  3. Signing - a release APK must be signed. When ANDROID_KEYSTORE_BASE64 is present the APK is
 *     signed with that private key; otherwise it falls back to the debug key that ships with the
 *     Expo template (installs fine when sideloading, but Play Store will reject it, and the app
 *     has to be uninstalled before swapping between the two).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APP_GRADLE = 'android/app/build.gradle';
const GRADLE_PROPS = 'android/gradle.properties';
const KEYSTORE_FILE = 'android/app/release.keystore';

const DEFAULT_ABIS = 'arm64-v8a,armeabi-v7a';

const log = (message) => console.log(`[android-release] ${message}`);

function must(condition, message) {
  if (!condition) {
    console.error(`[android-release] FAILED: ${message}`);
    process.exit(1);
  }
}

/** 1. Only build the ABIs we intend to ship. */
function limitAbis() {
  const abis = (process.env.REACT_NATIVE_ARCHITECTURES ?? DEFAULT_ABIS).trim();
  must(/^[a-z0-9_-]+(,[a-z0-9_-]+)*$/.test(abis), `invalid ABI list: ${abis}`);
  const props = readFileSync(GRADLE_PROPS, 'utf8');
  must(/^reactNativeArchitectures=.*$/m.test(props), `${GRADLE_PROPS} has no reactNativeArchitectures line`);
  writeFileSync(
    GRADLE_PROPS,
    props
      .replace(/^reactNativeArchitectures=.*$/m, `reactNativeArchitectures=${abis}`)
      .replace(/^org\.gradle\.jvmargs=.*$/m, 'org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g')
      .replace(/^(org\.gradle\.parallel=.*)$/m, '$1\norg.gradle.caching=true'),
  );
  log(`building ABIs: ${abis}`);
}

/** 2/3. Sign the release variant, with a private key when one is supplied. */
function configureSigning() {
  const base64 = process.env.ANDROID_KEYSTORE_BASE64?.trim();
  let gradle = readFileSync(APP_GRADLE, 'utf8');
  must(/signingConfigs\s*\{/.test(gradle), `${APP_GRADLE} has no signingConfigs block`);
  must(/buildTypes\s*\{/.test(gradle), `${APP_GRADLE} has no buildTypes block`);

  if (!base64) {
    const debugKey = 'android/app/debug.keystore';
    must(existsSync(debugKey), `${debugKey} is missing - run "npx expo prebuild --platform android"`);
    const hash = createHash('md5').update(readFileSync(debugKey)).digest('hex');
    log('WARNING: no ANDROID_KEYSTORE_BASE64 was provided, so the APK is signed with the key');
    log(`         that ships with the Expo template (${debugKey}, md5 ${hash}).`);
    log('         It installs on any device, but Play Store will reject it and builds signed');
    log('         with a different key cannot update it in place. Set the repository secrets');
    log('         ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS /');
    log('         ANDROID_KEY_PASSWORD (or re-run the workflow with "generate a signing key")');
    log('         to sign with your own key.');
    return;
  }

  if (gradle.includes('release.keystore')) {
    log('release signing config already present, leaving it alone');
  } else {
    const buffer = Buffer.from(base64, 'base64');
    must(buffer.length > 100, 'ANDROID_KEYSTORE_BASE64 does not look like a keystore');
    writeFileSync(KEYSTORE_FILE, buffer);

    // JKS (0xFEEDFEED) and PKCS#12 (0x30 0x82 ...) are the two formats AGP accepts; it cannot
    // guess between them for a .keystore file, so read the magic bytes and state it explicitly.
    const magic = buffer.subarray(0, 4).toString('hex');
    const storeType = magic === 'feedfeed' ? 'JKS' : magic.startsWith('3082') ? 'PKCS12' : null;
    must(storeType, `unrecognised keystore format (magic ${magic})`);

    const releaseBlock = `    signingConfigs {
        release {
            storeFile file('release.keystore')
            storeType '${storeType}'
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
`;
    gradle = gradle.replace(/    signingConfigs \{\n/, releaseBlock);

    // Only the release build type switches over; debug keeps its own key.
    const buildTypesAt = gradle.search(/buildTypes\s*\{/);
    const releaseAt = gradle.indexOf('release {', buildTypesAt);
    must(releaseAt > -1, 'could not find the release build type');
    const before = gradle.slice(0, releaseAt);
    const after = gradle.slice(releaseAt).replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release');
    must(after !== gradle.slice(releaseAt), 'the release build type was not using the debug signing config');
    gradle = before + after;

    must(gradle.includes('storeFile file(\'release.keystore\')'), 'the release signing config did not apply');
    must(
      /buildTypes[\s\S]*release \{[\s\S]*?signingConfig signingConfigs\.release/.test(gradle),
      'the release build type still is not signed with the release key',
    );
    must(
      /buildTypes[\s\S]*debug \{[\s\S]*?signingConfig signingConfigs\.debug/.test(gradle),
      'the debug build type lost its signing config',
    );

    writeFileSync(APP_GRADLE, gradle);
    log(`signing the release APK with ${KEYSTORE_FILE} (${storeType}, ${buffer.length} bytes)`);
    log(`alias: ${process.env.ANDROID_KEY_ALIAS ?? '(unset)'}`);
  }
}

limitAbis();
configureSigning();
log('android project ready for ./gradlew assembleRelease');
