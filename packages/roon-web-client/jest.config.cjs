module.exports = {
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [".*\\.(mock)|d\\.ts", ".*index(\\.mock)?\\.ts"],
  coverageProvider: "v8",
  coverageReporters: ["html", "text", "text-summary", "cobertura"],
  // coverageReporters: [
  //   "json",
  //   "text",
  //   "lcov",
  //   "clover"
  // ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 90,
      lines: 85,
      statements: 85,
    },
  },
  globals: {
    window: {},
  },
  moduleNameMapper: {
    "@model": "<rootDir>/../roon-cqrs-model/src/index.ts",
    "@mock": "<rootDir>/src/mock/index.ts",
  },
  transform: {
    "^.+\\.ts?$": ["ts-jest", {}],
  },
};
