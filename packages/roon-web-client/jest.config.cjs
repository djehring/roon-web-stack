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
      branches: 40,
      functions: 60,
      lines: 50,
      statements: 50,
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
