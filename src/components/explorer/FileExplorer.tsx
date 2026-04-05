import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  FolderSearch,
  GripVertical,
  Inbox,
  Lock,
  MoveRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import { useSettingsStore } from "../../lib/settingsStore";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createDirectory,
  createMemoryAtPath,
  deletePath,
  duplicateFile,
  duplicateMemoryFile,
  getConflicts,
  moveMemoryFile,
  renameMemoryFile,
  renamePath,
  showInFileManager,
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

interface DraggedItem {
  path: string;
  name: string;
  isMarkdown: boolean;
  isProtected: boolean;
}

interface PointerDragSession {
  pointerId: number;
  sourcePath: string;
  startX: number;
  startY: number;
  hasDragged: boolean;
  moveHandler: (event: PointerEvent) => void;
  upHandler: (event: PointerEvent) => void;
  cancelHandler: (event: PointerEvent) => void;
  blurHandler: () => void;
}

interface DragPreviewState {
  name: string;
  x: number;
  y: number;
}

interface SelectionLockStyles {
  bodyUserSelect: string;
  bodyWebkitUserSelect: string;
  htmlUserSelect: string;
  htmlWebkitUserSelect: string;
}

interface UndoMoveAction {
  kind: "memory" | "raw";
  currentPath: string;
  previousPath: string;
  memoryId?: string;
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
    sources: "source",
    "01-sources": "source",
    "01-context": "context",
    "02-context": "context",
    "02-daily": "daily",
    "03-daily": "daily",
    "03-intelligence": "intelligence",
    "04-intelligence": "intelligence",
    "04-projects": "project",
    "05-projects": "project",
    "05-resources": "resource",
    "06-resources": "resource",
    "06-skills": "skill",
    "07-skills": "skill",
    "07-tasks": "task",
    "08-tasks": "task",
    "08-rules": "rule",
    "09-rules": "rule",
    "09-scratch": "scratch",
    "10-scratch": "scratch",
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return Boolean(target.closest("[contenteditable='true']"));
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
  dropTargetPath: string | null;
  dragSourcePath: string | null;
  isDragging: boolean;
  getDraggedItem: () => DraggedItem | null;
  canDropPathOnDirectory: (target: FileNode, sourcePath: string | null) => boolean;
  onPointerDragStart: (event: React.PointerEvent<HTMLDivElement>, node: FileNode) => void;
  isClickSuppressed: () => boolean;
  onDragHoverDirectory: (targetPath: string | null) => void;
  onDropOnDirectory: (target: FileNode, sourcePath: string | null) => void;
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
  dropTargetPath,
  dragSourcePath,
  isDragging,
  getDraggedItem,
  canDropPathOnDirectory,
  onPointerDragStart,
  isClickSuppressed,
  onDragHoverDirectory,
  onDropOnDirectory,
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
  const isSpecialFolder = isSpecialWorkspaceNode(node);

  const isMarkdown = isMarkdownFile(node.name);
  const memoryId = isMarkdown ? stripMdExtension(node.name) : "";
  const memoryMeta = isMarkdown ? memories.find((memory) => memory.id === memoryId) : null;
  const hasConflict = conflictIds.has(memoryId);
  const isRawSupported = isRawViewerSupported(node.name);
  const opacity = memoryMeta ? computeDecayOpacity(memoryMeta) : 1;
  const isProtectedMemory = memoryMeta?.protected ?? false;
  const memoryStatus = memoryMeta?.status ?? null;
  const isProtected = isProtectedNode(node) || isProtectedMemory;
  const canDrag = !node.is_dir && !isProtected;
  const isDropTarget = dropTargetPath === node.path;
  const isDragSource = dragSourcePath === node.path;

  const handleClick = () => {
    if (isClickSuppressed()) return;

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

  const handleDirectoryDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const sourcePath = getDraggedPathFromEvent(event, getDraggedItem);
    if (!canDropPathOnDirectory(node, sourcePath)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onDragHoverDirectory(node.path);
  };

  const handleDirectoryDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const sourcePath =
      event.dataTransfer.getData("application/x-ai-context-path") ||
      event.dataTransfer.getData("text/plain") ||
      null;
    onDropOnDirectory(node, sourcePath);
  };

  return (
    <div
      onDragEnter={node.is_dir ? (event) => {
        const sourcePath = getDraggedPathFromEvent(event, getDraggedItem);
        if (canDropPathOnDirectory(node, sourcePath)) onDragHoverDirectory(node.path);
      } : undefined}
      onDragOver={node.is_dir ? handleDirectoryDragOver : undefined}
      onDragLeave={node.is_dir ? (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (dropTargetPath === node.path) onDragHoverDirectory(null);
      } : undefined}
      onDrop={node.is_dir ? handleDirectoryDrop : undefined}
    >
      <div
        className={clsx(
          "group flex items-center gap-1.5 rounded px-2 py-[5px] text-[13px] transition-colors",
          "cursor-default",
          isSelected
            ? "bg-[color:var(--accent-muted)] text-[color:var(--text-0)]"
            : isDragging
              ? "text-[color:var(--text-1)]"
              : "text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
          isDropTarget && "bg-[color:var(--accent-muted)] ring-1 ring-[color:var(--accent)]",
          isDragSource && "bg-[color:var(--bg-2)] ring-1 ring-[color:var(--accent)]/60",
        )}
        style={{
          paddingLeft: `${depth * 12 + 8}px`,
          opacity: isDragSource ? 0.55 : node.is_dir ? 1 : opacity,
        }}
        data-explorer-dir-path={node.is_dir ? node.path : undefined}
        draggable={false}
        title={canDrag ? "Arrastra para mover a otra carpeta" : undefined}
        onClick={handleClick}
        onContextMenu={(event) => onContextMenu(event, node)}
        onPointerDown={(event) => {
          if (canDrag && event.button === 0) {
            event.preventDefault();
          }
          onPointerDragStart(event, node);
        }}
      >
        {node.is_dir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--text-2)]" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--text-2)]" />
            )}
            {isInboxNode(node) ? (
              <Inbox className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
            ) : isSourcesNode(node) ? (
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? "var(--text-2)" }} />
            )}
          </>
        ) : (
          <>
            <span className={clsx(
              "flex w-3 items-center justify-center",
              canDrag && "cursor-grab active:cursor-grabbing",
            )}>
              {canDrag ? (
                <GripVertical className="h-3 w-3 text-[color:var(--text-2)] opacity-70 transition-opacity group-hover:opacity-100" />
              ) : null}
            </span>
            <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? "var(--text-2)" }} />
          </>
        )}

        {renamingPath === node.path ? (
          <input
            autoFocus
            className="flex-1 rounded border border-[color:var(--accent)] bg-[color:var(--bg-0)] px-1 text-[13px] text-[color:var(--text-0)] outline-none"
            value={renameValue}
            onChange={(event) => onRenameChange(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameCommit();
              if (event.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className={clsx(
              "flex-1 truncate",
              isSpecialFolder && "font-semibold text-[color:var(--text-0)]",
            )}
          >
            {node.name}
          </span>
        )}

        {isProtectedMemory && (
          <span title="Archivo protegido">
            <Lock className="h-3 w-3 shrink-0 text-[color:var(--text-2)]" />
          </span>
        )}

        {!node.is_dir && isInboxPath(node.path) && memoryStatus && (
          <span
            className={clsx(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              memoryStatus === "unprocessed"
                ? "bg-[color:var(--warning)]"
                : "bg-[color:var(--success)]",
            )}
            title={memoryStatus === "unprocessed" ? "Sin procesar" : "Procesado"}
          />
        )}

        {isDropTarget && (
          <span className="rounded-full bg-[color:var(--accent)]/14 px-1.5 py-[1px] text-[10px] font-medium text-[color:var(--accent)]">
            Soltar para mover
          </span>
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
              dropTargetPath={dropTargetPath}
              dragSourcePath={dragSourcePath}
              isDragging={isDragging}
              getDraggedItem={getDraggedItem}
              canDropPathOnDirectory={canDropPathOnDirectory}
              onPointerDragStart={onPointerDragStart}
              isClickSuppressed={isClickSuppressed}
              onDragHoverDirectory={onDragHoverDirectory}
              onDropOnDirectory={onDropOnDirectory}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isRawViewerSupported(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".jsonl") ||
    lowerName.endsWith(".yaml") ||
    lowerName.endsWith(".yml")
  );
}

const PROTECTED_FILE_NAMES = new Set([
  "_config.yaml",
  "_index.yaml",
  "claude.md",
  ".cursorrules",
  ".windsurfrules",
]);

const INBOX_FOLDER_NAMES = new Set(["inbox", "00-inbox"]);
const SOURCES_FOLDER_NAMES = new Set(["sources", "01-sources"]);

function pathSegments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function isInboxPath(path: string): boolean {
  return pathSegments(path).some((segment) => INBOX_FOLDER_NAMES.has(segment));
}

function isInboxNode(node: FileNode): boolean {
  return INBOX_FOLDER_NAMES.has(node.name) || isInboxPath(node.path);
}

function isSourcesPath(path: string): boolean {
  return pathSegments(path).some((segment) => SOURCES_FOLDER_NAMES.has(segment));
}

function isSourcesNode(node: FileNode): boolean {
  return SOURCES_FOLDER_NAMES.has(node.name) || isSourcesPath(node.path);
}

function isSpecialWorkspaceNode(node: FileNode): boolean {
  return node.is_dir && (isInboxNode(node) || isSourcesNode(node));
}

function isProtectedNode(node: FileNode): boolean {
  if (node.is_dir && node.memory_type !== null) {
    return true;
  }
  return PROTECTED_FILE_NAMES.has(node.name);
}

function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, "");
}

function isManagedMemoryFile(node: FileNode, memoryIds: Set<string>): boolean {
  return !node.is_dir && isMarkdownFile(node.name) && memoryIds.has(stripMdExtension(node.name));
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

function isAdvancedOnlyFile(node: FileNode): boolean {
  if (node.is_dir) return false;
  if (isInboxPath(node.path)) return false;
  if (PROTECTED_FILE_NAMES.has(node.name)) return true;
  if (!isMarkdownFile(node.name)) return true;
  if (node.name.startsWith("_")) return true;
  return inferFolderTypeFromPath(node.path) === null;
}

function filterExplorerTree(
  nodes: FileNode[],
  showSystemFiles: boolean,
  isRootLevel: boolean = true,
): { nodes: FileNode[]; hiddenCount: number } {
  if (showSystemFiles) {
    return { nodes, hiddenCount: 0 };
  }

  const result: FileNode[] = [];
  let hiddenCount = 0;

  for (const node of nodes) {
    if (node.is_dir) {
      const filteredChildren = filterExplorerTree(node.children, showSystemFiles, false);
      const shouldShowDirectory =
        node.memory_type !== null ||
        isSpecialWorkspaceNode(node) ||
        inferFolderTypeFromPath(node.path) !== null ||
        isRootLevel ||
        filteredChildren.nodes.length > 0;

      hiddenCount += filteredChildren.hiddenCount;

      if (shouldShowDirectory) {
        result.push({
          ...node,
          children: filteredChildren.nodes,
        });
      } else {
        hiddenCount += 1;
      }
      continue;
    }

    if (isAdvancedOnlyFile(node)) {
      hiddenCount += 1;
      continue;
    }

    result.push(node);
  }

  return { nodes: result, hiddenCount };
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
    pendingCreate,
    setPendingCreate,
  } = useAppStore();
  const expertModeEnabled = useSettingsStore((s) => s.expertModeEnabled);
  const showSystemFiles = useSettingsStore((s) => s.showSystemFiles);
  const toggleShowSystemFiles = useSettingsStore((s) => s.toggleShowSystemFiles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const draggedItemRef = useRef<DraggedItem | null>(null);
  const pointerDragRef = useRef<PointerDragSession | null>(null);
  const undoMoveStackRef = useRef<UndoMoveAction[]>([]);
  const selectionLockRef = useRef<SelectionLockStyles | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number | null>(null);
  const isDragging = dragSourcePath !== null;
  const { nodes: visibleTree } = useMemo(
    () => filterExplorerTree(fileTree, showSystemFiles),
    [fileTree, showSystemFiles],
  );
  const advancedItemCount = useMemo(
    () => filterExplorerTree(fileTree, false).hiddenCount,
    [fileTree],
  );
  const memoryIds = useMemo(() => new Set(memories.map((memory) => memory.id)), [memories]);

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
    if (visibleTree.length > 0 && expanded.size === 0) {
      const topLevel = new Set(visibleTree.filter((node) => node.is_dir).map((node) => node.path));
      setExpanded(topLevel);
    }
  }, [visibleTree, expanded.size]);

  useEffect(() => {
    return () => {
      if (suppressClickTimeoutRef.current !== null) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
      restoreTextSelection();
    };
  }, []);

  const pushUndoMove = (action: UndoMoveAction) => {
    undoMoveStackRef.current = [...undoMoveStackRef.current.slice(-19), action];
  };

  const undoLastMove = async () => {
    const action = undoMoveStackRef.current[undoMoveStackRef.current.length - 1];
    if (!action) return;

    undoMoveStackRef.current = undoMoveStackRef.current.slice(0, -1);

    try {
      if (action.kind === "memory") {
        const restored = await moveMemoryFile(action.currentPath, getParentPath(action.previousPath));
        await refreshTreeAndMemories();
        await selectFile(action.memoryId ?? restored.meta.id);
      } else {
        const restoredPath = await renamePath(action.currentPath, action.previousPath);
        await refreshTreeAndMemories();
        if (isRawViewerSupported(restoredPath)) {
          await selectRawFile(restoredPath);
        }
      }
    } catch (error) {
      undoMoveStackRef.current = [...undoMoveStackRef.current, action];
      setError(String(error));
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      if (isEditableTarget(event.target)) return;
      if (undoMoveStackRef.current.length === 0) return;

      event.preventDefault();
      void undoLastMove();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectFile, selectRawFile, setError]);

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

  const clearDragState = () => {
    draggedItemRef.current = null;
    setDropTargetPath(null);
    setDragSourcePath(null);
    setDragPreview(null);
    restoreTextSelection();
  };

  const disableTextSelection = () => {
    if (selectionLockRef.current) return;

    selectionLockRef.current = {
      bodyUserSelect: document.body.style.userSelect,
      bodyWebkitUserSelect: document.body.style.webkitUserSelect,
      htmlUserSelect: document.documentElement.style.userSelect,
      htmlWebkitUserSelect: document.documentElement.style.webkitUserSelect,
    };

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    document.documentElement.style.userSelect = "none";
    document.documentElement.style.webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
  };

  const restoreTextSelection = () => {
    const styles = selectionLockRef.current;
    if (!styles) return;

    document.body.style.userSelect = styles.bodyUserSelect;
    document.body.style.webkitUserSelect = styles.bodyWebkitUserSelect;
    document.documentElement.style.userSelect = styles.htmlUserSelect;
    document.documentElement.style.webkitUserSelect = styles.htmlWebkitUserSelect;
    selectionLockRef.current = null;
  };

  const removePointerDragListeners = () => {
    const session = pointerDragRef.current;
    if (!session) return;

    window.removeEventListener("pointermove", session.moveHandler);
    window.removeEventListener("pointerup", session.upHandler);
    window.removeEventListener("pointercancel", session.cancelHandler);
    window.removeEventListener("blur", session.blurHandler);
    pointerDragRef.current = null;
  };

  const clearSuppressionTimer = () => {
    if (suppressClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressClickTimeoutRef.current);
      suppressClickTimeoutRef.current = null;
    }
  };

  const releaseSuppressedClick = (delay = 0) => {
    clearSuppressionTimer();
    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimeoutRef.current = null;
    }, delay);
  };

  const getDraggedItem = () => draggedItemRef.current;
  const isClickSuppressed = () => suppressClickRef.current || draggedItemRef.current !== null;

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
      const renamingNode = findNodeByPath(fileTree, renamingTarget.path);
      const isManagedMemory = renamingNode ? isManagedMemoryFile(renamingNode, memoryIds) : false;

      if (isManagedMemory) {
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
        const nextName = isMarkdownFile(renamingTarget.name) ? `${rawValue}.md` : rawValue;
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
      if (isManagedMemoryFile(node, memoryIds)) {
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

  const handleShowInFinder = async (node: FileNode) => {
    try {
      await showInFileManager(node.path);
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

  /* ────── Toolbar-triggered inline create ────── */
  useEffect(() => {
    if (!pendingCreate) return;
    const mode = pendingCreate;
    setPendingCreate(null);

    // Derive workspace root from the tree
    const rootPath = fileTree.length > 0 ? getParentPath(fileTree[0].path) : null;

    // Find a target directory from current selection
    const findSelectedDir = (): FileNode | null => {
      if (!selectedPath) return null;
      const selectedNode = findNodeByPath(fileTree, selectedPath);
      if (selectedNode?.is_dir) return selectedNode;
      const parentPath = getParentPath(selectedPath);
      return findNodeByPath(fileTree, parentPath);
    };

    const selectedDir = findSelectedDir();

    if (mode === "folder") {
      // For folders: use selected dir, or workspace root
      if (selectedDir) {
        openDirectory(selectedDir.path);
        void handleCreateFolder(selectedDir);
      } else if (rootPath) {
        // Create at workspace root
        void (async () => {
          try {
            const existingNames = new Set(fileTree.map((n) => n.name));
            const nextName = uniqueName("nueva-carpeta", existingNames);
            const createdPath = await createDirectory(`${rootPath}/${nextName}`);
            await loadFileTree();
            setRenamingTarget({ path: createdPath, name: nextName, isDir: true });
            setRenameValue(nextName);
          } catch (error) {
            setError(String(error));
          }
        })();
      } else {
        setError("No hay un workspace configurado");
      }
    } else {
      // For files: need a typed workspace folder
      const targetDir =
        selectedDir && inferFolderTypeFromPath(selectedDir.path) !== null
          ? selectedDir
          : fileTree.find((n) => n.is_dir && n.memory_type !== null) ?? null;

      if (!targetDir) {
        setError("No hay una carpeta de memoria disponible");
        return;
      }
      openDirectory(targetDir.path);
      void handleCreateNote(targetDir);
    }
  }, [pendingCreate]);

  const currentNode = ctxMenu?.node ?? null;
  const currentNodeIsProtected = currentNode ? isProtectedNode(currentNode) : false;
  const currentNodeIsManagedMemory = currentNode ? isManagedMemoryFile(currentNode, memoryIds) : false;
  const currentFolderSupportsNotes = currentNode?.is_dir
    ? inferFolderTypeFromPath(currentNode.path) !== null
    : false;

  const handleMoveMemory = async (node: FileNode) => {
    if (!currentNodeIsManagedMemory) return;

    const destination = await open({
      directory: true,
      multiple: false,
      defaultPath: getParentPath(node.path),
      title: "Mover archivo a...",
    });
    if (!destination || Array.isArray(destination)) return;

    try {
      const moved = await moveMemoryFile(node.path, destination);
      pushUndoMove({
        kind: "memory",
        currentPath: moved.file_path,
        previousPath: node.path,
        memoryId: moved.meta.id,
      });
      await refreshTreeAndMemories();
      await selectFile(moved.meta.id);
    } catch (error) {
      setError(String(error));
    }
  };

  const canDropPathOnDirectory = (target: FileNode, sourcePath: string | null) => {
    if (!sourcePath) return false;
    const sourceNode = findNodeByPath(fileTree, sourcePath);
    if (!sourceNode) return false;
    return canDropOnDirectory(toDraggedItem(sourceNode), target);
  };

  const resolveDropTargetAtPoint = (clientX: number, clientY: number, sourcePath: string) => {
    const targetPath = getDirectoryPathFromPoint(clientX, clientY);
    if (!targetPath) return null;

    const targetNode = findNodeByPath(fileTree, targetPath);
    if (!targetNode || !canDropPathOnDirectory(targetNode, sourcePath)) {
      return null;
    }

    return targetNode;
  };

  const handleDropOnDirectory = async (target: FileNode, sourcePath: string | null) => {
    const effectiveSourcePath = sourcePath ?? draggedItemRef.current?.path ?? null;
    suppressClickRef.current = true;
    clearDragState();

    if (!effectiveSourcePath) {
      releaseSuppressedClick();
      return;
    }
    const sourceNode = findNodeByPath(fileTree, effectiveSourcePath);
    if (!sourceNode || !canDropOnDirectory(toDraggedItem(sourceNode), target)) {
      releaseSuppressedClick();
      return;
    }

    try {
      openDirectory(target.path);
      if (isManagedMemoryFile(sourceNode, memoryIds)) {
        // moveMemoryFile already regenerates the router internally,
        // so only refresh tree + memories to avoid double work.
        const moved = await moveMemoryFile(sourceNode.path, target.path);
        pushUndoMove({
          kind: "memory",
          currentPath: moved.file_path,
          previousPath: sourceNode.path,
          memoryId: moved.meta.id,
        });
        await refreshTreeAndMemories();
        await selectFile(moved.meta.id);
      } else {
        const nextPath = `${target.path}/${sourceNode.name}`;
        const movedPath = await renamePath(sourceNode.path, nextPath);
        pushUndoMove({
          kind: "raw",
          currentPath: movedPath,
          previousPath: sourceNode.path,
        });
        await refreshTreeAndMemories();
        if (isRawViewerSupported(movedPath)) {
          await selectRawFile(movedPath);
        }
      }
    } catch (error) {
      setError(String(error));
    } finally {
      releaseSuppressedClick(50);
    }
  };

  const handlePointerDragStart = (event: React.PointerEvent<HTMLDivElement>, node: FileNode) => {
    if (event.button !== 0 || node.is_dir || isProtectedNode(node)) return;

    removePointerDragListeners();
    clearSuppressionTimer();

    const sourcePath = node.path;
    const session: PointerDragSession = {
      pointerId: event.pointerId,
      sourcePath,
      startX: event.clientX,
      startY: event.clientY,
      hasDragged: false,
      moveHandler: (moveEvent) => {
        const activeSession = pointerDragRef.current;
        if (!activeSession || moveEvent.pointerId !== activeSession.pointerId) return;

        if (!activeSession.hasDragged) {
          const distance = Math.hypot(
            moveEvent.clientX - activeSession.startX,
            moveEvent.clientY - activeSession.startY,
          );
          if (distance < 5) return;

          const sourceNode = findNodeByPath(fileTree, activeSession.sourcePath);
          if (!sourceNode) {
            removePointerDragListeners();
            clearDragState();
            releaseSuppressedClick();
            return;
          }

          activeSession.hasDragged = true;
          disableTextSelection();
          suppressClickRef.current = true;
          draggedItemRef.current = toDraggedItem(sourceNode);
          setDragSourcePath(sourceNode.path);
        }

        moveEvent.preventDefault();
        const targetNode = resolveDropTargetAtPoint(
          moveEvent.clientX,
          moveEvent.clientY,
          activeSession.sourcePath,
        );
        setDropTargetPath(targetNode?.path ?? null);
        setDragPreview({
          name: draggedItemRef.current?.name ?? node.name,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
      },
      upHandler: (upEvent) => {
        const activeSession = pointerDragRef.current;
        if (!activeSession || upEvent.pointerId !== activeSession.pointerId) return;

        const sourcePath = activeSession.sourcePath;
        const wasDragging = activeSession.hasDragged;
        removePointerDragListeners();

        if (!wasDragging) return;

        upEvent.preventDefault();
        const targetNode = resolveDropTargetAtPoint(upEvent.clientX, upEvent.clientY, sourcePath);
        if (!targetNode) {
          clearDragState();
          releaseSuppressedClick(50);
          return;
        }

        void handleDropOnDirectory(targetNode, sourcePath);
      },
      cancelHandler: (cancelEvent) => {
        const activeSession = pointerDragRef.current;
        if (!activeSession || cancelEvent.pointerId !== activeSession.pointerId) return;
        removePointerDragListeners();
        clearDragState();
        releaseSuppressedClick(50);
      },
      blurHandler: () => {
        removePointerDragListeners();
        clearDragState();
        releaseSuppressedClick(50);
      },
    };

    pointerDragRef.current = session;
    window.addEventListener("pointermove", session.moveHandler);
    window.addEventListener("pointerup", session.upHandler);
    window.addEventListener("pointercancel", session.cancelHandler);
    window.addEventListener("blur", session.blurHandler);
  };

  useEffect(() => () => {
    removePointerDragListeners();
    clearSuppressionTimer();
  }, []);

  const menuGroups: MenuAction[][] = currentNode
    ? currentNode.is_dir
      ? [
          [
            {
              label: "Nueva nota",
              icon: FilePlus,
              onSelect: () => handleCreateNote(currentNode),
              disabled: !currentFolderSupportsNotes || isInboxNode(currentNode),
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
              label: "Mostrar en Finder",
              icon: FolderSearch,
              onSelect: () => handleShowInFinder(currentNode),
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
            ...(currentNodeIsManagedMemory
              ? [
                  {
                    label: "Mover archivo a...",
                    icon: MoveRight,
                    onSelect: () => handleMoveMemory(currentNode),
                    disabled: currentNodeIsProtected,
                  } satisfies MenuAction,
                ]
              : []),
          ],
          [
            {
              label: "Copiar ruta",
              icon: Clipboard,
              onSelect: () => handleCopyPath(currentNode),
            },
            {
              label: "Mostrar en Finder",
              icon: FolderSearch,
              onSelect: () => handleShowInFinder(currentNode),
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
      {visibleTree.map((node, index) => {
        const previousNode = index > 0 ? visibleTree[index - 1] : null;
        const showSpecialDivider =
          !isSpecialWorkspaceNode(node) &&
          previousNode !== null &&
          isSpecialWorkspaceNode(previousNode);

        return (
          <div key={node.path}>
            {showSpecialDivider && (
              <div className="mx-3 my-2 flex items-center gap-2" aria-hidden="true">
                <div className="h-px flex-1 bg-[color:var(--border)]" />
                <div className="text-[10px] text-[color:var(--text-2)]">•</div>
                <div className="h-px flex-1 bg-[color:var(--border)]" />
              </div>
            )}
            <TreeNode
              node={node}
              depth={0}
              expanded={expanded}
              toggleExpand={toggleExpand}
              conflictIds={conflictIds}
              onContextMenu={handleContextMenu}
              dropTargetPath={dropTargetPath}
              dragSourcePath={dragSourcePath}
              isDragging={isDragging}
              getDraggedItem={getDraggedItem}
              canDropPathOnDirectory={canDropPathOnDirectory}
              onPointerDragStart={handlePointerDragStart}
              isClickSuppressed={isClickSuppressed}
              onDragHoverDirectory={setDropTargetPath}
              onDropOnDirectory={(target, sourcePath) => {
                void handleDropOnDirectory(target, sourcePath);
              }}
              renamingPath={renamingTarget?.path ?? null}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameCommit={() => {
                void handleRenameCommit();
              }}
              onRenameCancel={cancelRename}
            />
          </div>
        );
      })}

      {visibleTree.length === 0 && (
        <p className="px-3 py-8 text-center text-xs text-[color:var(--text-2)]">
          {showSystemFiles ? "No hay archivos todavía." : "No hay memorias visibles en esta vista."}
        </p>
      )}

      {expertModeEnabled && advancedItemCount > 0 && (
        <button
          type="button"
          onClick={toggleShowSystemFiles}
          className="mx-2 mt-2 flex w-[calc(100%-1rem)] items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-1)] hover:text-[color:var(--text-1)]"
        >
          {showSystemFiles ? (
            <Eye className="h-3 w-3 shrink-0" />
          ) : (
            <EyeOff className="h-3 w-3 shrink-0" />
          )}
          <span>{showSystemFiles ? "Modo experto" : "Archivos de sistema ocultos"}</span>
        </button>
      )}

      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          groups={menuGroups}
          onClose={closeContextMenu}
        />
      )}

      {dragPreview && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--bg-1)]/95 px-3 py-2 shadow-2xl backdrop-blur"
          style={{
            left: dragPreview.x,
            top: dragPreview.y,
            transform: "translate(14px, 14px)",
          }}
        >
          <GripVertical className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          <span className="max-w-[220px] truncate text-[12px] font-medium text-[color:var(--text-0)]">
            {dragPreview.name}
          </span>
          <span className="rounded-full bg-[color:var(--accent)]/12 px-1.5 py-[1px] text-[10px] uppercase tracking-wide text-[color:var(--accent)]">
            mover
          </span>
        </div>
      )}
    </div>
  );
}

function canDropOnDirectory(draggedItem: DraggedItem | null, target: FileNode): boolean {
  if (!draggedItem || !target.is_dir) return false;
  if (draggedItem.isProtected) return false;

  const currentParent = getParentPath(draggedItem.path);
  if (currentParent === target.path) return false;

  if (draggedItem.isMarkdown) {
    return inferFolderTypeFromPath(target.path) !== null;
  }

  return true;
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children.length > 0) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function toDraggedItem(node: FileNode): DraggedItem {
  return {
    path: node.path,
    name: node.name,
    isMarkdown: isMarkdownFile(node.name),
    isProtected: isProtectedNode(node),
  };
}

function getDraggedPathFromEvent(
  event: Pick<React.DragEvent, "dataTransfer">,
  getDraggedItem: () => DraggedItem | null,
): string | null {
  return (
    event.dataTransfer.getData("application/x-ai-context-path") ||
    event.dataTransfer.getData("text/plain") ||
    getDraggedItem()?.path ||
    null
  );
}

function getDirectoryPathFromPoint(clientX: number, clientY: number): string | null {
  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const directory = target?.closest<HTMLElement>("[data-explorer-dir-path]");
  return directory?.dataset.explorerDirPath ?? null;
}
