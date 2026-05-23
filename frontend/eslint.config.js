// p3portal.org
import js from '@eslint/js'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  // PROJ-60: Plus-submodule files may import each other freely
  {
    files: ['src/plus/**/*.{js,jsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // PROJ-60: Block direct plus/ submodule imports outside src/plus/
      // Use PlusComponents registry (import { PlusComponents } from '../../plus') instead.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/plus/*/*'],
          message: 'Direct plus/ submodule imports are forbidden. Use PlusComponents from the registry (import { PlusComponents } from "../../plus").',
        }],
      }],
    },
    settings: {
      react: { version: 'detect' },
    },
  },
]
