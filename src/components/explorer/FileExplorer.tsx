import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import {
  createDirectory,
  createMemoryAtPath,
  deletePath,
  duplicateFile,
  duplicateMemoryFile,
  getConflicts,
  renameMemoryFile,
  renamePath,
} from "../../lib/tauri";
import type { Conflict, FileNode, MemoryType } from "../../lib/types";
import { MEMORY_TYPE_COLORS } from "../../lib/types";

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

interface RenameTarget {
  path: string;
  name: string;
  isDir: boolean;
}

interface MenuAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
}

function ContextMenu({
  menu,
  groups,
  onClose,
}: {
  menu: ContextMenuState;
  groups: MenuAction[][];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleWindowChange = () => onClose();

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("blur", handleWindowChange);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("blur", handleWindowChange);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 252);
  const top = Math.min(menu.y, window.innerHeight - 320);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] rounded-xl border border-[color:var(--border-active)] bg-[color:var(--bg-1)] p-1 shadow-2xl backdrop-blur"
      style={{ top: Math.max(8, top), left: Math.max(8, left) }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={`group-${groupIndex}`}
          className={clsx(groupIndex > 0 && "mt-1 border-t border-[color:var(--border)] pt-1")}
        >
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                item.disabled
                  ? "cursor-not-allowed text-[color:var(--text-2)] opacity-50"
                  : item.danger
                    ? "text-[color:var(--danger)] hover:bg-[color:var(--danger)]/10"
                    : "text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
              )}
              onClick={() => {
                void item.onSelect();
                onClose();
              }}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function getTypeColor(node: FileNode): string | undefined {
  if (node.memory_type) {
    return MEMORY_TYPE_COLORS[node.memory_type];
  }
  const folderType = inferFolderTypeFromPath(node.path);
  return folderType ? MEMORY_TYPE_COLORS[folderType] : undefined;
}

function folderToType(folder: string): MemoryType | null {
  const map: Record<string, MemoryType> = {
    "01-context": "context",
    "02-daily": "daily",
    "03-intelligence": "intelligence",
    "04-projects": "project",
    "05-resources": "resource",
    "06-skills": "skill",
    "07-tasks": "task",
    "08-rules": "rule",
    "09-scratch": "scratch",
  };
  return map[folder] ?? null;
}

function inferFolderTypeFromPath(path: string): MemoryType | null {
  const parts = path.split("/");
  for (const part of parts) {
    const folderType = folderToType(part);
    if (folderType) return folderType;
  }
  return null;
}

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function computeDecayOpacity(meta: {
  last_access: string;
  decay_rate: number;
  access_count: number;
}): number {
  const now = Date.now();
  const lastAccess = new Date(meta.last_access).getTime();
  const daysSince = (now - lastAccess) / (1000 * 60 * 60 * 24);
  const effectiveDecay = Math.pow(meta.decay_rate, 1 / (1 + 0.1 * meta.access_count));
  const score = Math.pow(effectiveDecay, daysSince);
  return Math.max(0.35, Math.min(1, score));
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (path: string) => void;
  conflictIds: Set<string>;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function TreeNode({
  node,
  depth,
  expanded,
  toggleExpand,
  conflictIds,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: TreeNodeProps) {
  const { selectedPath, selectFile, selectRawFile, memories } = useAppStore();
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const color = getTypeColor(node);

  const isMarkdown = isMarkdownFile(node.name);
  const memoryId = isMarkdown ? stripMdExtension(node.name) : "";
  const memoryMeta = isMarkdown ? memories.find((memory) => memory.id === memoryId) : null;
  const hasConflict = conflictIds.has(memoryId);
  const isRawSupported = isRawViewerSupported(node.name);
  const opacity = memoryMeta ? computeDecayOpacity(memoryMeta) : 1;

  const handleClick = () => {
    if (node.is_dir) {
      toggleExpand(node.path);
      return;
    }

    if (isMarkdown && memoryMeta) {
      void selectFile(memoryMeta.id);
      return;
    }

    if (isRawSupported) {
      void selectRawFile(node.path);
    }
  };

  return (
    <>
      <div
        className={clsx(
          "flex cursor-pointer items-center gap-1.5 rounded px-2 py-[5px] text-[13px] transition-colors",
          isSelected
            ? "bg-[color:var(--accent-muted)] text-[color:var(--text-0)]"
            : "text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
        )}
        style={{
          paddingLeft: `${depth * 12 + 8}px`,
          opacity: node.is_dir ? 1 : opacity,
        }}
        onClick={handleClick}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        {node.is_dir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--text-2)]" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--text-2)]" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? "var(--text-2)" }} />
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? "var(--text-2)" }} />
          </>
        )}

        {renamingPath === node.path ? (
          <input
            autoFocus
            className="flex-1 rounded border border-[color:var(--accent)] bg-[color:var(--bg-0)] px-1 text-[13px] text-[color:var(--text-0)] outline-none"
            value={renameValue}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameCommit();
              if (event.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}

        {hasConflict && (
          <span title="Conflict detected">
            <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-[color:var(--warning)]" />
          </span>
        )}

        {memoryMeta && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-[color:var(--text-2)]">
            {memoryMeta.importance.toFixed(1)}
          </span>
        )}
      </div>

      {node.is_dir && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              conflictIds={conflictIds}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </>
  );
}

function isRawViewerSupported(name: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith(".jsonl") || lowerName.endsWith(".yaml") || lowerName.endsWith(".yml");
}

function isProtectedNode(node: FileNode): boolean {
  if (node.is_dir && node.memory_type !== null) {
    return true;
  }

  return new Set([
    "_config.yaml",
    "_index.yaml",
    "claude.md",
    ".cursorrules",
    ".windsurfrules",
  ]).has(node.name);
}

function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, "");
}

function getParentPath(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, -1).join("/");
}

function buildSiblingPath(path: string, name: string): string {
  return `${getParentPath(path)}/${name}`;
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;

  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

function normalizeMemoryId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pathMatchesTarget(targetPath: string | null, candidatePath: string): boolean {
  if (!targetPath) return false;
  return targetPath === candidatePath || targetPath.startsWith(`${candidatePath}/`);
}

export function FileExplorer() {
  const {
    fileTree,
    memories,
    selectedPath,
    loadFileTree,
    loadMemories,
    regenerateRouter,
    clearSelection,
    selectFile,
    selectRawFile,
    setError,
  } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    void loadFileTree();
  }, [loadFileTree]);

  useEffect(() => {
    void getConflicts()
      .then((conflicts: Conflict[]) => {
        const ids = new Set<string>();
        for (const conflict of conflicts) {
          ids.add(conflict.memory_a);
          ids.add(conflict.memory_b);
        }
        setConflictIds(ids);
      })
      .catch(() => {});
  }, [fileTree]);

  useEffect(() => {
    if (fileTree.length > 0 && expanded.size === 0) {
      const topLevel = new Set(fileTree.filter((node) => node.is_dir).map((node) => node.path));
      setExpanded(topLevel);
    }
  }, [fileTree, expanded.size]);

  const toggleExpand = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const openDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.add(path);
      return next;
    });
  };

  const refreshTreeAndMemories = async () => {
    await loadFileTree();
    await loadMemories();
  };

  const refreshWorkspace = async () => {
    await regenerateRouter();
  };

  const handleContextMenu = (event: React.MouseEvent, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    setCtxMenu({ x: event.clientX, y: event.clientY, node });
  };

  const closeContextMenu = () => setCtxMenu(null);

  const startRename = (node: FileNode) => {
    setRenamingTarget({
      path: node.path,
      name: node.name,
      isDir: node.is_dir,
    });
    setRenameValue(isMarkdownFile(node.name) ? stripMdExtension(node.name) : node.name);
  };

  const cancelRename = () => {
    setRenamingTarget(null);
    setRenameValue("");
  };

  const handleRenameCommit = async () => {
    if (!renamingTarget) return;

    const rawValue = renameValue.trim();
    if (!rawValue) {
      cancelRename();
      return;
    }
    if (/[\\/]/.test(rawValue)) {
      setError("El nombre no puede contener / ni \\");
      return;
    }

    try {
      if (isMarkdownFile(renamingTarget.name)) {
        const newId = normalizeMemoryId(rawValue);
        if (!newId) {
          setError("El nombre de la memoria no es valido");
          return;
        }
        if (newId === stripMdExtension(renamingTarget.name)) {
          cancelRename();
          return;
        }

        const renamed = await renameMemoryFile(renamingTarget.path, newId);
        await refreshTreeAndMemories();
        await selectFile(renamed.meta.id);
      } else {
        const nextName = rawValue;
        if (nextName === renamingTarget.name) {
          cancelRename();
          return;
        }

        const nextPath = buildSiblingPath(renamingTarget.path, nextName);
        const updatedPath = await renamePath(renamingTarget.path, nextPath);
        await refreshWorkspace();
        if (!renamingTarget.isDir && isRawViewerSupported(updatedPath)) {
          await selectRawFile(updatedPath);
        }
      }
      cancelRename();
    } catch (error) {
      setError(String(error));
    }
  };

  const handleCopyPath = async (node: FileNode) => {
    try {
      await navigator.clipboard.writeText(node.path);
    } catch {
      setError("No se pudo copiar la ruta al portapapeles");
    }
  };

  const handleDelete = async (node: FileNode) => {
    const label = node.is_dir ? `la carpeta "${node.name}"` : `el archivo "${node.name}"`;
    if (!window.confirm(`¿Seguro que quieres borrar ${label}?`)) return;

    try {
      await deletePath(node.path);
      if (pathMatchesTarget(selectedPath, node.path)) {
        clearSelection();
      }
      await refreshWorkspace();
    } catch (error) {
      setError(String(error));
    }
  };

  const handleDuplicate = async (node: FileNode) => {
    if (node.is_dir) return;

    try {
      if (isMarkdownFile(node.name)) {
        const baseId = `${stripMdExtension(node.name)}-copy`;
        const nextId = uniqueName(
          normalizeMemoryId(baseId) || "copy",
          new Set(memories.map((memory) => memory.id)),
        );
        const duplicated = await duplicateMemoryFile(node.path, nextId);
        await refreshTreeAndMemories();
        await selectFile(duplicated.meta.id);
      } else {
        const duplicatedPath = await duplicateFile(node.path);
        await refreshWorkspace();
        if (isRawViewerSupported(duplicatedPath)) {
          await selectRawFile(duplicatedPath);
        }
      }
    } catch (error) {
      setError(String(error));
    }
  };

  const handleCreateFolder = async (node: FileNode) => {
    if (!node.is_dir) return;

    try {
      const nextName = uniqueName(
        "nueva-carpeta",
        new Set(node.children.map((child) => child.name)),
      );
      const createdPath = await createDirectory(`${node.path}/${nextName}`);
      openDirectory(node.path);
      await loadFileTree();
      setRenamingTarget({ path: createdPath, name: nextName, isDir: true });
      setRenameValue(nextName);
    } catch (error) {
      setError(String(error));
    }
  };

  const handleCreateNote = async (node: FileNode) => {
    if (!node.is_dir) return;

    const memoryType = inferFolderTypeFromPath(node.path);
    if (!memoryType) {
      setError("Solo se pueden crear notas dentro de carpetas de memoria");
      return;
    }

    try {
      const nextId = uniqueName("untitled", new Set(memories.map((memory) => memory.id)));
      const created = await createMemoryAtPath(
        {
          id: nextId,
          memory_type: memoryType,
          l0: "Untitled",
          importance: 0.5,
          tags: [],
          l1_content: "",
          l2_content: "",
        },
        node.path,
      );
      openDirectory(node.path);
      await refreshTreeAndMemories();
      await selectFile(created.meta.id);
      setRenamingTarget({
        path: created.file_path,
        name: `${created.meta.id}.md`,
        isDir: false,
      });
      setRenameValue(created.meta.id);
    } catch (error) {
      setError(String(error));
    }
  };

  const currentNode = ctxMenu?.node ?? null;
  const currentNodeIsProtected = currentNode ? isProtectedNode(currentNode) : false;
  const currentFolderSupportsNotes = currentNode?.is_dir
    ? inferFolderTypeFromPath(currentNode.path) !== null
    : false;

  const menuGroups: MenuAction[][] = currentNode
    ? currentNode.is_dir
      ? [
          [
            {
              label: "Nueva nota",
              icon: FilePlus,
              onSelect: () => handleCreateNote(currentNode),
              disabled: !currentFolderSupportsNotes,
            },
            {
              label: "Nueva carpeta",
              icon: FolderPlus,
              onSelect: () => handleCreateFolder(currentNode),
            },
          ],
          [
            {
              label: "Copiar ruta",
              icon: Clipboard,
              onSelect: () => handleCopyPath(currentNode),
            },
            {
              label: "Renombrar",
              icon: Pencil,
              onSelect: () => startRename(currentNode),
              disabled: currentNodeIsProtected,
            },
            {
              label: "Borrar",
              icon: Trash2,
              onSelect: () => handleDelete(currentNode),
              danger: true,
              disabled: currentNodeIsProtected,
            },
          ],
        ]
      : [
          [
            {
              label: "Duplicar",
              icon: Copy,
              onSelect: () => handleDuplicate(currentNode),
              disabled: currentNodeIsProtected,
            },
          ],
          [
            {
              label: "Copiar ruta",
              icon: Clipboard,
              onSelect: () => handleCopyPath(currentNode),
            },
            {
              label: "Renombrar",
              icon: Pencil,
              onSelect: () => startRename(currentNode),
              disabled: currentNodeIsProtected,
            },
            {
              label: "Borrar",
              icon: Trash2,
              onSelect: () => handleDelete(currentNode),
              danger: true,
              disabled: currentNodeIsProtected,
            },
          ],
        ]
    : [];

  return (
    <div className="px-1 py-1">
      {fileTree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          toggleExpand={toggleExpand}
          conflictIds={conflictIds}
          onContextMenu={handleContextMenu}
          renamingPath={renamingTarget?.path ?? null}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameCommit={() => {
            void handleRenameCommit();
          }}
          onRenameCancel={cancelRename}
        />
      ))}

      {fileTree.length === 0 && (
        <p className="px-3 py-8 text-center text-xs text-[color:var(--text-2)]">
          No files yet.
        </p>
      )}

      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          groups={menuGroups}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
