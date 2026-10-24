module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json", "./electron/tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "airbnb-base",
    "plugin:@typescript-eslint/recommended-type-checked",
    "prettier",
  ],
  settings: {
    "import/resolver": {
      typescript: { project: ["./tsconfig.json", "./electron/tsconfig.json"] },
    },
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "electron/dist/",
    "**/__tests__/**",
    "electron/scripts/",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "no-use-before-define": "off",
    "@typescript-eslint/no-use-before-define": [
      "error",
      { functions: false, variables: false, ignoreTypeReferences: true },
    ],
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-void": ["error", { allowAsStatement: true }],
    "no-underscore-dangle": ["error", { allow: ["__filename", "__dirname"] }],
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: [
          "electron/main.ts",
          "electron/preload.cts",
          "electron/mcp/server.ts",
          "electron/mcp/stdio.ts",
          "electron/graphics/**",
        ],
      },
    ],
    "@typescript-eslint/no-misused-promises": [
      "error",
      { checksVoidReturn: { attributes: false } },
    ],
    "@typescript-eslint/no-empty-function": [
      "error",
      { allow: ["arrowFunctions", "methods"] },
    ],
    "no-continue": "off",
    "default-param-last": "off",
    "@typescript-eslint/default-param-last": "error",
    "no-empty-function": "off",
    "no-shadow": "off",
    "@typescript-eslint/no-shadow": "error",
    "no-useless-constructor": "off",
    "@typescript-eslint/no-useless-constructor": "error",
    "import/extensions": [
      "error",
      "ignorePackages",
      { ts: "never", tsx: "never", js: "always", cts: "never" },
    ],
    "import/prefer-default-export": "off",
    "no-restricted-syntax": [
      "error",
      "ForInStatement",
      "LabeledStatement",
      "WithStatement",
    ],
    "no-param-reassign": ["error", { props: false }],
    camelcase: "off",
    "no-await-in-loop": "off",
    "no-console": ["error", { allow: ["warn", "error"] }],
  },
};
