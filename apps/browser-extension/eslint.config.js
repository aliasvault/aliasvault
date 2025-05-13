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
            "src/utils/shared/**",
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
                tsconfigRootDir: ".",
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
        },
        settings: {
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
