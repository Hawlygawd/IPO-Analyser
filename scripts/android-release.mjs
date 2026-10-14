#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const appGradlePath = 'android/app/build.gradle';
const gradlePropertiesPath = 'android/gradle.properties';
const releaseKeystorePath = 'android/app/release.keystore';
const requiredAbis = process.env.REACT_NATIVE_ARCHITECTURES ?? 'arm64-v8a,armeabi-v7a';

function fail(message) {
  console.error(`[android-release] ${message}`);
  process.exit(1);
}

if (!/^[a-z0-9_-]+(,[a-z0-9_-]+)*$/.test(requiredAbis)) {
  fail(`Invalid Android ABI list: ${requiredAbis}`);
}

const gradleProperties = readFileSync(gradlePropertiesPath, 'utf8');
if (!/^reactNativeArchitectures=.*$/m.test(gradleProperties)) {
  fail(`${gradlePropertiesPath} has no reactNativeArchitectures setting`);
}
writeFileSync(
  gradlePropertiesPath,
  gradleProperties
    .replace(/^reactNativeArchitectures=.*$/m, `reactNativeArchitectures=${requiredAbis}`)
    .replace(/^org\.gradle\.jvmargs=.*$/m, 'org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g')
    .replace(/^(org\.gradle\.parallel=.*)$/m, '$1\norg.gradle.caching=true'),
);

const encodedKeystore = process.env.ANDROID_KEYSTORE_BASE64?.trim();
let appGradle = readFileSync(appGradlePath, 'utf8');
if (!/signingConfigs\s*\{/.test(appGradle) || !/buildTypes\s*\{/.test(appGradle)) {
  fail(`${appGradlePath} is missing signing or build-type configuration`);
}

if (!encodedKeystore) {
  const debugKeystore = 'android/app/debug.keystore';
  if (!existsSync(debugKeystore)) {
    fail(`${debugKeystore} is missing; run Expo prebuild before this script`);
  }
  const fingerprint = createHash('sha256').update(readFileSync(debugKeystore)).digest('hex');
  console.warn('[android-release] No repository release key is configured; using Expo\'s test/debug key.');
  console.warn(`[android-release] Debug keystore SHA-256: ${fingerprint}`);
  console.warn('[android-release] This APK is for sideload testing, not Play Store distribution.');
} else {
  const buffer = Buffer.from(encodedKeystore, 'base64');
  if (buffer.length < 100) fail('ANDROID_KEYSTORE_BASE64 does not look like a keystore');
  writeFileSync(releaseKeystorePath, buffer);

  const magic = buffer.subarray(0, 4).toString('hex');
  const storeType = magic === 'feedfeed' ? 'JKS' : magic.startsWith('3082') ? 'PKCS12' : null;
  if (!storeType) fail(`Unrecognized keystore format (magic ${magic})`);

  const signingConfig = `    signingConfigs {
        release {
            storeFile file('release.keystore')
            storeType '${storeType}'
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
`;
  if (appGradle.includes("storeFile file('release.keystore')")) {
    fail('Unexpected pre-existing release.keystore signing configuration');
  }
  appGradle = appGradle.replace(/    signingConfigs \{\n/, signingConfig);

  const buildTypesIndex = appGradle.search(/buildTypes\s*\{/);
  const releaseIndex = appGradle.indexOf('release {', buildTypesIndex);
  if (buildTypesIndex < 0 || releaseIndex < 0) fail('Could not locate the release build type');
  const beforeRelease = appGradle.slice(0, releaseIndex);
  const afterRelease = appGradle.slice(releaseIndex).replace(
    'signingConfig signingConfigs.debug',
    'signingConfig signingConfigs.release',
  );
  if (afterRelease === appGradle.slice(releaseIndex)) {
    fail('The release build type was not using the expected debug signing config');
  }
  appGradle = beforeRelease + afterRelease;
  writeFileSync(appGradlePath, appGradle);
  console.log(`[android-release] Configured ${storeType} release signing with the repository key.`);
}

console.log(`[android-release] Building ABIs: ${requiredAbis}`);
