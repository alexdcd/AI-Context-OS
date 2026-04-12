import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore, wasRecentlyWrittenLocally } from './store';
import * as api from './tauri';

// Mock the API so we don't actually hit the filesystem
vi.mock('./tauri', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn(),
  readFile: vi.fn(),
}));

describe('wasRecentlyWrittenLocally', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should return false for a path that was not recently written', () => {
    expect(wasRecentlyWrittenLocally('/some/path.md')).toBe(false);
  });

  it('should return true immediately after saving a file', async () => {
    const path = '/test/recent.md';

    // Call the method that triggers markRecentLocalWrite
    await useAppStore.getState().saveRawFile(path, 'content');

    expect(api.writeFile).toHaveBeenCalledWith(path, 'content');
    expect(wasRecentlyWrittenLocally(path)).toBe(true);
  });

  it('should return false after the RECENT_LOCAL_WRITE_WINDOW_MS has passed', async () => {
    const path = '/test/timeout.md';

    await useAppStore.getState().saveRawFile(path, 'content');
    expect(wasRecentlyWrittenLocally(path)).toBe(true);

    // Advance time by 2000ms (the window)
    vi.advanceTimersByTime(2000);

    expect(wasRecentlyWrittenLocally(path)).toBe(false);
  });

  it('should only return true for the specific path that was written', async () => {
    const path = '/test/path1.md';
    const otherPath = '/test/path2.md';

    await useAppStore.getState().saveRawFile(path, 'content');

    expect(wasRecentlyWrittenLocally(path)).toBe(true);
    expect(wasRecentlyWrittenLocally(otherPath)).toBe(false);
  });
});
