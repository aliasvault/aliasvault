const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');
const { transformer, resolver } = require('react-native-svg-transformer');

const config = getDefaultConfig(__dirname);

// The @aliasvault/models and @aliasvault/vault packages are linked as source so let Metro watch them.
const coreRoot = path.resolve(__dirname, '../../core');
config.watchFolders = [...(config.watchFolders ?? []), path.join(coreRoot, 'models'), path.join(coreRoot, 'vault')];

config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...config.resolver,
  assetExts: config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...config.resolver.sourceExts, 'svg'],
  nodeModulesPaths: [...(config.resolver.nodeModulesPaths ?? []), path.join(__dirname, 'node_modules')],
};

module.exports = config;