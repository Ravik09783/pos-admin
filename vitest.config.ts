import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: false,
        include: ["tests/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
        exclude: ["node_modules/**", ".next/**"],
        setupFiles: ["./tests/setup.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/lib/**/*.ts", "src/app/api/public/**/*.ts"],
            exclude: ["**/*.test.ts", "**/*.spec.ts"],
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
})
