export function migrateSettingsStore(persistedState: unknown, version: number) {
  if (version >= 1 || typeof persistedState !== "object" || persistedState === null) {
    return persistedState;
  }

  return {
    ...persistedState,
    showMarkdownSyntax: false,
  };
}
