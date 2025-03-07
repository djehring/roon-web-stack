module.exports = {
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [
    ".*\\.(mock)|d\\.ts",
    ".*index(\\.mock)?\\.ts",
    "app.ts",
    "src/roon-kit/.",
    "src/infrastructure/logger.ts",
    "src/infrastructure/host-info.ts",
    // FIXME: Coverage!
    "src/route/.",
    "src/service/register-graceful-shutdown.ts",
  ],
  coverageReporters: ["html", "text", "text-summary", "cobertura", "lcov"],
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
  moduleNameMapper: {
    "@data": "<rootDir>/src/data/index.ts",
    "@infrastructure": "<rootDir>/src/infrastructure/index.ts",
    "@mock": "<rootDir>/src/mock/index.ts",
    "@service": "<rootDir>/src/service/index.ts",
    "@model": "<rootDir>/../../packages/roon-cqrs-model/src/index.ts",
    "@roon-kit": "<rootDir>/src/roon-kit/index.ts",
  },
  transform: {
    "^.+\\.ts?$": ["ts-jest", {}],
  },
};
