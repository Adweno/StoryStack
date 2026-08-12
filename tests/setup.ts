import "@testing-library/jest-dom/vitest";

// Test-only credentials keep fixtures deterministic without shipping defaults.
process.env.STORY_STACK_ADMIN_EMAIL = "admin@example.com";
process.env.STORY_STACK_ADMIN_PASSWORD = "admin";
process.env.STORY_STACK_USER_PASSWORD = "user";
