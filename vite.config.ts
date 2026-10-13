import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/mbta-board/",
  test: {
    environment: "node",
  },
});
