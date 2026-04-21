import test from "node:test";
import assert from "node:assert/strict";
import { migrateSettingsStore } from "../src/lib/settingsMigration.ts";

test("legacy settings migration re-enables preview mode after live preview restoration", () => {
  assert.deepEqual(
    migrateSettingsStore(
      {
        theme: "system",
        showMarkdownSyntax: true,
      },
      0,
    ),
    {
      theme: "system",
      showMarkdownSyntax: false,
    },
  );
});

test("current settings migration preserves explicit markdown syntax preference", () => {
  assert.deepEqual(
    migrateSettingsStore(
      {
        theme: "system",
        showMarkdownSyntax: true,
      },
      1,
    ),
    {
      theme: "system",
      showMarkdownSyntax: true,
    },
  );
});
