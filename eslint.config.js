// 4.5 · typescript-eslint recommended + react-hooks. `npm run lint` is part of
// the Step 4 gate: lint, test, tsc --noEmit and vite build all clean.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "test/fixtures/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}", "scripts/**/*.{js,ts}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The API layer types the wire as `any` at exactly one point (parse) and
      // narrows from there; the socket payloads are typed at the handler.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
