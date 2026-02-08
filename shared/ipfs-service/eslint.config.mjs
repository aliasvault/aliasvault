import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import jsdocPlugin from "eslint-plugin-jsdoc";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
    {
        ignores: [
            "dist/**",
            "node_modules/**",
        ]
    },
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        ignores: ["src/__tests__/**"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json",
                tsconfigRootDir: __dirname,
            },
            globals: {
                console: "readonly",
                setTimeout: "readonly",
                Promise: "readonly",
                Uint8Array: "readonly",
                ArrayBuffer: "readonly",
                Blob: "readonly",
                TextEncoder: "readonly",
                File: "readonly",
                NodeJS: true,
            }
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            "import": importPlugin,
            "jsdoc": jsdocPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            "curly": ["error", "all"],
            "brace-style": ["error", "1tbs", { "allowSingleLine": false }],
            "@typescript-eslint/await-thenable": "error",
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
                    "MethodDefinition": false,
                    "ClassDeclaration": true,
                },
                "checkConstructors": false,
            }],
            "jsdoc/require-description": ["error", {
                "contexts": [
                    "FunctionDeclaration",
                    "ClassDeclaration",
                ]
            }],
            "spaced-comment": ["error", "always"],
            "multiline-comment-style": ["error", "starred-block"],
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    "selector": "class",
                    "format": ["PascalCase"]
                }
            ],
        }
    },
];
