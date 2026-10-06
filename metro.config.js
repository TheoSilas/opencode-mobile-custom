const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_FOSS === '1') {
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'expo-iap') {
      return context.resolveRequest(context, './lib/foss/expo-iap-stub', platform);
    }
    if (moduleName === 'expo-camera') {
      return context.resolveRequest(context, './lib/foss/expo-camera-stub', platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
