import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import jsdocPlugin from "eslint-plugin-jsdoc";
import globals from 'globals';

export default [
    {
        ignores: [
            "dist/**",
            "node_modules/**",
        ]
    },
    js.configs.recommended,
    {
        files: ["src/**/*.{ts,tsx}"],
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
            "indent": ["error", 2, {
                "SwitchCase": 1,
                "VariableDeclarator": 1,
                "outerIIFEBody": 1,
                "MemberExpression": 1,
                "FunctionDeclaration": { "parameters": 1, "body": 1 },
                "FunctionExpression": { "parameters": 1, "body": 1 },
                "CallExpression": { "arguments": 1 },
                "ArrayExpression": 1,
                "ObjectExpression": 1,
                "ImportDeclaration": 1,
                "flatTernaryExpressions": false,
                "ignoreComments": false
            }],
            "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 1, "maxBOF": 0 }],
            // Log through the Diagnostics utility helper instead of raw console.error.
            "no-console": ["error", { allow: ["warn", "info", "debug"] }],
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
        // Brand style enforcement.
        files: ["src/**/*.{ts,tsx}"],
        ignores: ["src/entrypoints/popup/components/Icons/Icon.tsx", "src/entrypoints/popup/components/Logo.tsx", "src/utils/constants/logo.ts", "src/**/__tests__/**"],
        rules: {
            "no-restricted-syntax": ["error",
                { selector: "JSXOpeningElement[name.name='svg']", message: "Use the Icon component with an icon from core/assets/icons instead of inline SVG." },
                { selector: "TemplateElement[value.raw=/<svg/]", message: "Use uiIconSvg() from @aliasvault/models/icons instead of inline SVG markup." },
                { selector: "Literal[value=/<svg/]", message: "Use uiIconSvg() from @aliasvault/models/icons instead of inline SVG markup." },
                { selector: "Literal[value=/(orange|indigo)-[0-9]/]", message: "Use the primary-* brand colors (core/assets/colors) instead of Tailwind orange or indigo; use amber for warnings." },
                { selector: "TemplateElement[value.raw=/(orange|indigo)-[0-9]/]", message: "Use the primary-* brand colors (core/assets/colors) instead of Tailwind orange or indigo; use amber for warnings." },
            ],
        },
    },
    {
        // Content scripts have no storage.local access (setAccessLevel in ContentSettingsHandler), these calls need to go through the background.
        files: ["src/entrypoints/content.ts", "src/entrypoints/contentScript/**/*.ts", "src/utils/TotpClipboard.ts"],
        ignores: ["src/**/__tests__/**"],
        rules: {
            "no-restricted-imports": ["error", {
                paths: [
                    { name: "#imports", importNames: ["storage"], message: "Content scripts cannot use storage.local; add a background message (see ContentSettingsHandler)." },
                    { name: "@/utils/LocalPreferencesService", message: "Content scripts cannot use storage.local; use GET_CONTENT_SETTINGS or add a background message." },
                ],
            }],
        },
    },
    {
        // The dev-only trace channel is the only module allowed to reach the console directly.
        files: ["src/utils/devLogger/DevLogger.ts"],
        rules: {
            "no-console": "off",
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
