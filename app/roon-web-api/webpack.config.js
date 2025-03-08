const path = require("path");
const nodeExternals = require("webpack-node-externals");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");
const NodemonPlugin = require("nodemon-webpack-plugin");
const webpack = require('webpack');
const package = require('./package.json');

const isProduction = process.env.NODE_ENV !== "development";

const config = {
  entry: "./src/app.ts",
  target: "node",
  output: {
    path: path.resolve(__dirname, "bin"),
    filename: "app.js",
    devtoolModuleFilenameTemplate: '[absolute-resource-path]',
  },
  plugins: [
    new ESLintPlugin({
      context: path.resolve(__dirname, "./src"),
      emitError: true,
      emitWarning: true,
      failOnError: true,
      failOnWarning: true,
      extensions: ["ts", "json", "d.ts"],
      fix: false,
      cache: false,
      configType: "flat",
    }),
    new NodemonPlugin({
      nodeArgs: ['--inspect'],
    }),
    new webpack.DefinePlugin({
      'process.env.npm_package_version': JSON.stringify(package.version)
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: require.resolve("ts-loader"),
          options: {
            compilerOptions: {
              sourceMap: true,
            },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts"],
    plugins: [new TsconfigPathsPlugin({})],
  },
  externals: [nodeExternals()],
  externalsPresets: {
    node: true
  },
};

module.exports = () => {
  if (isProduction) {
    config.mode = "production";
    config.devtool = "source-map";
  } else {
    config.mode = "development";
    config.devtool = "source-map";
  }
  return config;
};
