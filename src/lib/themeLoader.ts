import { getFileTree, readFile, createDirectory } from "./tauri";
import type { FileNode } from "./types";

const STYLE_ELEMENT_ID = "user-theme";
const THEME_DIR = "themes";

export interface VaultTheme {
  id: string;
  name: string;
  path: string;
}

function toTheme(node: FileNode): VaultTheme | null {
  if (node.is_dir) return null;
  if (!node.name.toLowerCase().endsWith(".css")) return null;
  const id = node.name.replace(/\.css$/i, "");
  const name = id.replace(/[_-]+/g, " ").trim();
  return { id, name, path: node.path };
}

export async function listVaultThemes(): Promise<VaultTheme[]> {
  let tree: FileNode[];
  try {
    tree = await getFileTree();
  } catch {
    return [];
  }

  const themesDir = tree.find(
    (node) => node.is_dir && node.name === THEME_DIR,
  );
  if (!themesDir) return [];

  return themesDir.children
    .map(toTheme)
    .filter((t): t is VaultTheme => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function ensureThemesDirectory(): Promise<void> {
  try {
    await createDirectory(THEME_DIR);
  } catch {
    // Directory already exists or cannot be created — non-fatal.
  }
}

function sanitizeCss(source: string): string {
  return source
    .replace(/@import\s+url\([^)]*\);?/gi, "")
    .replace(/@import\s+["'][^"']*["'];?/gi, "")
    .replace(/<\/style>/gi, "");
}

function ensureStyleElement(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  return el;
}

export function clearCustomTheme(): void {
  const el = document.getElementById(STYLE_ELEMENT_ID);
  if (el) el.remove();
}

export function applyCustomThemeCss(id: string, rawCss: string): void {
  const el = ensureStyleElement();
  el.dataset.themeId = id;
  el.textContent = sanitizeCss(rawCss);
}

export async function loadCustomTheme(theme: VaultTheme): Promise<string> {
  return readFile(theme.path);
}

export async function loadCustomThemeById(id: string): Promise<{ ok: true; css: string } | { ok: false }> {
  const themes = await listVaultThemes();
  const theme = themes.find((t) => t.id === id);
  if (!theme) {
    return { ok: false };
  }
  const css = await loadCustomTheme(theme);
  return { ok: true, css };
}

export async function applyCustomTheme(theme: VaultTheme): Promise<void> {
  const raw = await loadCustomTheme(theme);
  applyCustomThemeCss(theme.id, raw);
}

export async function applyCustomThemeById(id: string): Promise<boolean> {
  const loaded = await loadCustomThemeById(id);
  if (!loaded.ok) {
    clearCustomTheme();
    return false;
  }
  applyCustomThemeCss(id, loaded.css);
  return true;
}
