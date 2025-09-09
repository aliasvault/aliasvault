import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import jsdocPlugin from "eslint-plugin-jsdoc";
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
    {
        ignores: [
            "metro.config.js",
            "**/dist/**",
            "node_modules/**",
            "src/utils/dist/**",
            "coverage/**",
        ]
    },
    {
        files: ["app/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
        },
    },
    {
        files: ["app/**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            "react": reactPlugin,
            "react-hooks": reactHooksPlugin,
            "import": importPlugin,
            "jsdoc": jsdocPlugin,
            "@stylistic": stylistic,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            ...reactPlugin.configs.recommended.rules,
            ...reactHooksPlugin.configs.recommended.rules,
            "curly": ["error", "all"],
            "brace-style": ["error", "1tbs", { "allowSingleLine": false }],
            "@typescript-eslint/await-thenable": "error",
            "react/react-in-jsx-scope": "off",
            "react/no-unused-prop-types": "error",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-unused-vars": ["error", {
                "vars": "all",
                "args": "after-used",
                "ignoreRestSiblings": true,
                "varsIgnorePattern": "^_",
                "argsIgnorePattern": "^_"
            }],
            "@stylistic/indent": ["error", 2],
            "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 1, "maxBOF": 0 }],
            "no-console": ["error", { allow: ["warn", "error", "info", "debug"] }],
            "jsdoc/require-jsdoc": ["error", {
                "require": {
                    "FunctionDeclaration": true,
                    "MethodDefinition": true,
                    "ClassDeclaration": true,
                    "ArrowFunctionExpression": true,
                    "FunctionExpression": true
                }
            }],
            "jsdoc/require-description": ["error", {
                "contexts": [
                    "FunctionDeclaration",
                    "MethodDefinition",
                    "ClassDeclaration",
                    "ArrowFunctionExpression",
                    "FunctionExpression"
                ]
            }],
            "spaced-comment": ["error", "always"],
            "multiline-comment-style": ["error", "starred-block"],
            "@typescript-eslint/explicit-member-accessibility": ["error"],
            "@typescript-eslint/explicit-function-return-type": ["error"],
            "@typescript-eslint/typedef": ["error"],
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    "selector": "interface",
                    "format": ["PascalCase"],
                    "prefix": ["I"]
                },
                {
                    "selector": "class",
                    "format": ["PascalCase"]
                }
            ],
            "react-hooks/exhaustive-deps": "warn",
            "react/jsx-no-constructed-context-values": "error",
            "import/no-unresolved": [
                "error",
                {
                  ignore: ['^#imports$'] // Ignore virtual imports from WXT which are not resolved by the typescript compiler
                }
              ],
            "import/order": [
                "error",
                {
                    "groups": [
                    "builtin",    // Node "fs", "path", etc.
                    "external",   // "react", "lodash", etc.
                    "internal",   // Aliased paths like "@/utils"
                    "parent",     // "../"
                    "sibling",    // "./"
                    "index",      // "./index"
                    "object",     // import 'foo'
                    "type"        // import type ...
                    ],
                    "pathGroups": [
                    {
                        pattern: "@/entrypoints/**",
                        group: "internal",
                        position: "before"
                    },
                    {
                        pattern: "@/utils/**",
                        group: "internal",
                        position: "before"
                    },
                    {
                        pattern: "@/hooks/**",
                        group: "internal",
                        position: "before"
                    }
                    ],
                    "pathGroupsExcludedImportTypes": ["builtin"],
                    "newlines-between": "always",
                    "alphabetize": {
                    order: "asc",
                    caseInsensitive: true
                    }
                }
              ],
            },
        settings: {
            'import/resolver': {
                typescript: {
                project: './tsconfig.json',
                },
            },
            react: {
                version: "detect",
            },
        },
    },
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                NodeJS: true,
                chrome: 'readonly',
            }
        }
    }
];
