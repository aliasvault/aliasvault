import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json",
                tsconfigRootDir: ".",
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            "curly": ["error", "all"],
            "brace-style": ["error", "1tbs", { "allowSingleLine": false }],
            "@typescript-eslint/no-unused-vars": ["error", {
                "vars": "all",
                "args": "after-used",
                "ignoreRestSiblings": true,
                "varsIgnorePattern": "^_",
                "argsIgnorePattern": "^_"
            }],
            "indent": ["error", 2],
            "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 1, "maxBOF": 0 }],
            "spaced-comment": ["error", "always"],
            "multiline-comment-style": ["error", "starred-block"],
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    "selector": "interface",
                    "format": ["PascalCase"],
                    "prefix": ["I"]
                },
                {
                    "selector": "typeAlias",
                    "format": ["PascalCase"]
                }
            ],
        }
    }
];
