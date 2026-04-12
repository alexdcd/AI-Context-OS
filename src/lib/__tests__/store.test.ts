import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore, wasRecentlyWrittenLocally } from '../store';

// Mock the Tauri API to prevent actual filesystem writes
vi.mock('../tauri', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  saveMemory: vi.fn().mockImplementation(async (memory: any) => ({
    meta: memory.meta,
    file_path: '/mock/path/memory.md',
    l1_content: memory.l1_content,
    l2_content: memory.l2_content
  }))
}));

describe('wasRecentlyWrittenLocally', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should return false for unknown path', () => {
    expect(wasRecentlyWrittenLocally('/unknown/path.md')).toBe(false);
  });

  it('should return true immediately after saving a raw file', async () => {
    const store = useAppStore.getState();
    const testPath = '/test/local/file.md';

    expect(wasRecentlyWrittenLocally(testPath)).toBe(false);

    // Simulate setting the time to a known point
    vi.setSystemTime(10000);

    await store.saveRawFile(testPath, '# Test Content');

    // Immediately after write, it should be true
    expect(wasRecentlyWrittenLocally(testPath)).toBe(true);
  });

  it('should return false after the window expires', async () => {
    const store = useAppStore.getState();
    const testPath = '/test/local/file2.md';

    vi.setSystemTime(10000);

    await store.saveRawFile(testPath, '# Test Content');
    expect(wasRecentlyWrittenLocally(testPath)).toBe(true);

    // Advance time beyond the 2000ms window
    vi.advanceTimersByTime(2001);

    expect(wasRecentlyWrittenLocally(testPath)).toBe(false);
  });

  it('should prune old entries when checking', async () => {
    const store = useAppStore.getState();
    const oldPath = '/test/local/old.md';
    const newPath = '/test/local/new.md';

    vi.setSystemTime(10000);
    await store.saveRawFile(oldPath, '# Old');

    // Advance time beyond the window
    vi.advanceTimersByTime(2001);

    // This will trigger a prune, and add new path
    await store.saveRawFile(newPath, '# New');

    expect(wasRecentlyWrittenLocally(oldPath)).toBe(false);
    expect(wasRecentlyWrittenLocally(newPath)).toBe(true);
  });
});
