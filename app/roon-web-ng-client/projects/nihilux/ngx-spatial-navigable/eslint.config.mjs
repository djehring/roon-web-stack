// @ts-check
import rootConfig from "../../../eslint.config.mjs";

export default [...rootConfig, {
    files: ["src/**/*.ts"],
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "ngx",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "ngx",
          style: "kebab-case",
        },
      ],
    },
  }
];
