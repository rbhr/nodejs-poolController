// ESLint 9 flat config. Replaces the legacy .eslintrc.json.
// Pragmatic ruleset for a large, long-lived TypeScript codebase: it enforces the
// project's house style (single quotes, semicolons) and catches real mistakes,
// while not drowning the existing code in stylistic noise.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'web/bindings/**',
            'scripts/**',
            '**/*.js',
            '**/*.mjs'
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            // House style (warnings so `npm run lint:fix` can tidy without failing CI).
            semi: ['warn', 'always'],
            quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],

            // Relax rules that would flag thousands of pre-existing, intentional patterns.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-namespace': 'off',
            '@typescript-eslint/no-require-imports': 'off', // codebase uses require() for dynamic/conditional loads
            '@typescript-eslint/no-unused-expressions': 'off', // pervasive `cond && fn()` short-circuit style
            '@typescript-eslint/no-unsafe-function-type': 'warn',
            '@typescript-eslint/no-empty-object-type': 'warn',
            '@typescript-eslint/no-wrapper-object-types': 'warn',
            'no-empty': 'off',
            'no-cond-assign': 'off',
            'no-control-regex': 'off',
            'no-case-declarations': 'off',
            'prefer-const': 'off',
            'prefer-spread': 'off',
            'prefer-rest-params': 'off',
            'no-var': 'off',
            'no-useless-escape': 'warn',
            'no-async-promise-executor': 'warn',
            'no-constant-condition': ['warn', { checkLoops: false }],

            // Kept as ERRORS — these flag genuine latent bugs worth fixing, not just style:
            //   no-duplicate-case, no-dupe-else-if, valid-typeof, no-fallthrough,
            //   no-constant-binary-expression, no-unsafe-finally, no-self-assign, no-useless-catch.
            // CI runs lint as a non-blocking step so they stay visible without gating builds.
        }
    }
);
