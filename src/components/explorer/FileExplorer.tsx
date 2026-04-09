import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import type { Conflict, FileNode } from "../../lib/types";

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

const FALLBACK_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#fbbf24", // amber
  "#a3e635", // lime
  "#4ade80", // green
  "#34d399", // emerald
  "#2dd4bf", // teal
  "#22d3ee", // cyan
  "#38bdf8", // sky
  "#818cf8", // indigo
  "#a78bfa", // violet
  "#c084fc", // purple
  "#e879f9", // fuchsia
  "#f472b6", // pink
  "#fb7185", // rose
];

function getStringColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function getTypeColor(node: FileNode): string | undefined {
  // Los archivos no editables (no markdown) no tienen color (serán grises)
  if (!node.is_dir && !isMarkdownFile(node.name)) {
    return undefined;
  }

  // Zero Gravity: no folder-based type inference — use hash color for untyped nodes
  const stringToHash = node.is_dir ? node.name : (node.path.split("/").slice(-2, -1)[0] || node.name);
  return getStringColor(stringToHash);
}

function defaultOntologyForDirectory(path: string): "source" | "entity" | "concept" | "synthesis" {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("/sources") || normalized.endsWith("/sources")) {
    return "source";
  }
  if (
    normalized.includes("/.ai/skills")
    || normalized.endsWith("/.ai/skills")
    || normalized.includes("/.ai/rules")
    || normalized.endsWith("/.ai/rules")
  ) {
    return "concept";
  }
  return "entity";
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
  const { t } = useTranslation();
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
        title={canDrag ? t("explorer.dragToMove") : undefined}
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
          <span title={t("explorer.protected")}>
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
            title={memoryStatus === "unprocessed" ? t("explorer.unprocessed") : t("explorer.processed")}
          />
        )}

        {isDropTarget && (
          <span className="rounded-full bg-[color:var(--accent)]/14 px-1.5 py-[1px] text-[10px] font-medium text-[color:var(--accent)]">
            {t("explorer.dropToMove")}
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
  "config.yaml",
  "index.yaml",
  "claude.md",
  ".cursorrules",
  ".windsurfrules",
]);

const INBOX_FOLDER_NAMES = new Set(["inbox"]);
const SOURCES_FOLDER_NAMES = new Set(["sources"]);
const AI_SYSTEM_DIR = ".ai";

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
  return node.is_dir && (isInboxNode(node) || isSourcesNode(node) || node.name === AI_SYSTEM_DIR);
}

function isProtectedNode(node: FileNode): boolean {
  // Zero Gravity: only system files and special dirs are protected, not user folders
  if (node.is_dir && (isInboxNode(node) || isSourcesNode(node) || node.name === AI_SYSTEM_DIR)) {
    return true;
  }
  return PROTECTED_FILE_NAMES.has(node.name);
}

function isAiRootNode(node: FileNode): boolean {
  return node.is_dir && node.name === AI_SYSTEM_DIR;
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
  if (isSourcesPath(node.path)) return false;
  if (PROTECTED_FILE_NAMES.has(node.name)) return true;
  if (!isMarkdownFile(node.name)) return true;
  if (node.name.startsWith("_")) return true;
  // Zero Gravity: all .md files are visible by default regardless of folder
  return false;
}

function canStoreMemoryInDirectory(node: FileNode): boolean {
  if (!node.is_dir) return false;
  if (isSourcesNode(node) || isAiRootNode(node)) return false;
  return !isAiSystemSubdir(node);
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
      // Zero Gravity: show directory if it's at root level, is a special node, or has visible children
      const shouldShowDirectory =
        isRootLevel ||
        isSpecialWorkspaceNode(node) ||
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
  const { t } = useTranslation();
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
      setError(t("explorer.errorInvalidName"));
      return;
    }

    try {
      const renamingNode = findNodeByPath(fileTree, renamingTarget.path);
      const isManagedMemory = renamingNode ? isManagedMemoryFile(renamingNode, memoryIds) : false;

      if (isManagedMemory) {
        const newId = normalizeMemoryId(rawValue);
        if (!newId) {
          setError(t("explorer.errorInvalidMemoryName"));
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
      setError(t("explorer.errorCopyPath"));
    }
  };

  const handleDelete = async (node: FileNode) => {
    const confirmMsg = node.is_dir
      ? t("explorer.deleteFolder", { name: node.name })
      : t("explorer.deleteFile", { name: node.name });
    if (!window.confirm(confirmMsg)) return;

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
        "new-folder",
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
    if (!canStoreMemoryInDirectory(node)) {
      setError(t("explorer.errorReserved"));
      return;
    }

    try {
      const nextId = uniqueName("untitled", new Set(memories.map((memory) => memory.id)));
      const created = await createMemoryAtPath(
        {
          id: nextId,
          ontology: defaultOntologyForDirectory(node.path),
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

    if (mode === "folder") {
      // Toolbar folder → always at workspace root
      const rootPath = fileTree.length > 0 ? getParentPath(fileTree[0].path) : null;
      if (!rootPath) {
        setError(t("explorer.errorNoWorkspace"));
        return;
      }
      void (async () => {
        try {
          const existingNames = new Set(fileTree.map((n) => n.name));
          const nextName = uniqueName("new-folder", existingNames);
          const createdPath = await createDirectory(`${rootPath}/${nextName}`);
          await loadFileTree();
          setRenamingTarget({ path: createdPath, name: nextName, isDir: true });
          setRenameValue(nextName);
        } catch (error) {
          setError(String(error));
        }
      })();
    } else {
      // Toolbar file → selected folder or first workspace folder
      const findTargetDir = (): FileNode | null => {
        if (selectedPath) {
          const sel = findNodeByPath(fileTree, selectedPath);
          if (sel?.is_dir && canStoreMemoryInDirectory(sel)) return sel;
          const parent = findNodeByPath(fileTree, getParentPath(selectedPath));
          if (parent?.is_dir && canStoreMemoryInDirectory(parent)) return parent;
        }
        // Zero Gravity: any directory works, prefer inbox as default
        return fileTree.find((n) => n.is_dir && n.name === "inbox")
          ?? fileTree.find((n) => n.is_dir && canStoreMemoryInDirectory(n))
          ?? null;
      };
      const targetDir = findTargetDir();
      if (!targetDir) {
        setError(t("explorer.errorNoFolder"));
        return;
      }
      openDirectory(targetDir.path);
      void handleCreateNote(targetDir);
    }
  }, [pendingCreate]);

  const currentNode = ctxMenu?.node ?? null;
  const currentNodeIsProtected = currentNode ? isProtectedNode(currentNode) : false;
  const currentNodeIsManagedMemory = currentNode ? isManagedMemoryFile(currentNode, memoryIds) : false;
  // Zero Gravity still keeps protected/system folders off-limits for user memories.
  const currentFolderSupportsNotes = currentNode?.is_dir
    ? canStoreMemoryInDirectory(currentNode)
    : false;

  const handleMoveMemory = async (node: FileNode) => {
    if (!currentNodeIsManagedMemory) return;

    const destination = await open({
      directory: true,
      multiple: false,
      defaultPath: getParentPath(node.path),
      title: "Move file to...",
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
              label: t("explorer.newNote"),
              icon: FilePlus,
              onSelect: () => handleCreateNote(currentNode),
              disabled: !currentFolderSupportsNotes || isInboxNode(currentNode),
            },
            {
              label: t("explorer.newFolder"),
              icon: FolderPlus,
              onSelect: () => handleCreateFolder(currentNode),
            },
          ],
          [
            {
              label: t("explorer.copyPath"),
              icon: Clipboard,
              onSelect: () => handleCopyPath(currentNode),
            },
            {
              label: t("explorer.showInFinder"),
              icon: FolderSearch,
              onSelect: () => handleShowInFinder(currentNode),
            },
            {
              label: t("explorer.rename"),
              icon: Pencil,
              onSelect: () => startRename(currentNode),
              disabled: currentNodeIsProtected,
            },
            {
              label: t("explorer.delete"),
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
              label: t("explorer.duplicate"),
              icon: Copy,
              onSelect: () => handleDuplicate(currentNode),
              disabled: currentNodeIsProtected,
            },
            ...(currentNodeIsManagedMemory
              ? [
                  {
                    label: t("explorer.moveTo"),
                    icon: MoveRight,
                    onSelect: () => handleMoveMemory(currentNode),
                    disabled: currentNodeIsProtected,
                  } satisfies MenuAction,
                ]
              : []),
          ],
          [
            {
              label: t("explorer.copyPath"),
              icon: Clipboard,
              onSelect: () => handleCopyPath(currentNode),
            },
            {
              label: t("explorer.showInFinder"),
              icon: FolderSearch,
              onSelect: () => handleShowInFinder(currentNode),
            },
            {
              label: t("explorer.rename"),
              icon: Pencil,
              onSelect: () => startRename(currentNode),
              disabled: currentNodeIsProtected,
            },
            {
              label: t("explorer.delete"),
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
          {showSystemFiles ? "No files yet." : "No visible memories in this view."}
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
          <span>{showSystemFiles ? "Expert mode" : "System files hidden"}</span>
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
            move
          </span>
        </div>
      )}
    </div>
  );
}

// .ai/ subdirectories that are system-managed and should not receive dropped files
const AI_SYSTEM_SUBDIRS = new Set(["tasks", "scratch", "journal"]);

function isAiSystemSubdir(node: FileNode): boolean {
  const segments = pathSegments(node.path);
  const aiIdx = segments.lastIndexOf(AI_SYSTEM_DIR);
  if (aiIdx === -1) return false;
  const subdir = segments[aiIdx + 1];
  return subdir !== undefined && AI_SYSTEM_SUBDIRS.has(subdir);
}

function canDropOnDirectory(draggedItem: DraggedItem | null, target: FileNode): boolean {
  if (!draggedItem || !target.is_dir) return false;
  if (draggedItem.isProtected) return false;
  // Block drops into .ai/ system-managed subdirs
  if (isAiSystemSubdir(target)) return false;

  const currentParent = getParentPath(draggedItem.path);
  if (currentParent === target.path) return false;

  if (draggedItem.isMarkdown) {
    return canStoreMemoryInDirectory(target);
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
