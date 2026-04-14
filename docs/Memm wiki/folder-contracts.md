# Folder Contracts — `.folder.yaml`

## Qué son

Un folder contract es un archivo `.folder.yaml` que se coloca en la raíz de una carpeta del sistema para declarar explícitamente su propósito, sus restricciones y el contrato que deben cumplir las memorias que viven en ella.

Solo las carpetas con comportamiento especial en el sistema tienen contrato. Las carpetas normales del usuario (`ideas/`, `projects/`, cualquier carpeta que cree el usuario) no necesitan ni tienen `.folder.yaml` — el sistema las trata con total libertad.

## Carpetas del sistema con contrato

| Carpeta | Rol | Lifecycle |
|---|---|---|
| `inbox/` | `inbox` | `transient` |
| `sources/` | `source` | `immutable` |
| `.ai/skills/` | `skill` | `permanent` |
| `.ai/rules/` | `rule` | `permanent` |

Estos archivos se crean automáticamente al inicializar un workspace nuevo. En workspaces existentes no se sobreescriben.

## Estructura del archivo

```yaml
role: inbox
description: Staging area for unprocessed incoming memories
lifecycle: transient
scannable: true
writable_by_mcp: true
required_fields: [id, type, l0, status]
optional_fields: [derived_from, tags, importance]
default_values:
  status: unprocessed
  importance: 0.3
```

### Campos

| Campo | Tipo | Descripción |
|---|---|---|
| `role` | string | Identificador del tipo de carpeta. Define el `system_role` de las memorias. |
| `description` | string | Descripción legible del propósito de la carpeta. |
| `lifecycle` | enum | `transient`, `permanent` o `immutable`. |
| `scannable` | bool | Si el scanner indexa los `.md` de esta carpeta como memorias. Default: `true`. |
| `writable_by_mcp` | bool | Si `save_memory` MCP puede escribir aquí. Default: `true`. |
| `required_fields` | list | Campos de frontmatter obligatorios. El scanner emite warning si faltan. |
| `optional_fields` | list | Campos válidos pero no obligatorios. Documentación para plugins y humanos. |
| `default_values` | map | Valores sugeridos al crear una memoria en esta carpeta. |

### Valores de `lifecycle`

- **`transient`** — zona de paso. Las memorias se esperan promover a otra carpeta o descartar. Ejemplo: `inbox/`.
- **`permanent`** — memorias de larga vida. Ejemplo: `.ai/skills/`, `.ai/rules/`.
- **`immutable`** — material de referencia original que no se modifica tras la ingesta. Ejemplo: `sources/`.

### Valores de `role` reconocidos por el sistema

| Valor | `system_role` asignado |
|---|---|
| `skill` | `SystemRole::Skill` |
| `rule` | `SystemRole::Rule` |
| cualquier otro | `None` |

Solo `skill` y `rule` tienen efecto en el scoring y la carga de contexto. El resto son informativos.

## Cómo funciona en el código

### Detección del `system_role`

`paths::system_role()` sigue este orden:

1. Lee `.folder.yaml` del directorio padre del archivo.
2. Si existe y el campo `role` es `skill` o `rule`, devuelve el `SystemRole` correspondiente.
3. Si no existe el contrato, aplica la detección hardcodeada por path (`.ai/skills/` → `Skill`, `.ai/rules/` → `Rule`).

Esto garantiza compatibilidad total con workspaces existentes.

### Validación en el scanner

Al indexar cada memoria, `index::scan_dir_recursive()` comprueba si el directorio padre tiene un `.folder.yaml`. Si existe, verifica que los `required_fields` estén presentes y no vacíos en el frontmatter. Las violaciones se emiten como `log::warn` — no son errores fatales y no rompen workspaces existentes.

Los campos que el validador evalúa actualmente:

| Campo | Criterio |
|---|---|
| `id` | no vacío |
| `type` | siempre válido (es un enum) |
| `l0` | no vacío |
| `status` | `Some(_)` (no `None`) |
| `triggers` | lista no vacía |
| campos desconocidos | pasan siempre (compatibilidad hacia adelante) |

### Creación automática

`config::create_workspace_structure()` crea los 4 contratos del sistema al inicializar un workspace. Usa `write_if_not_exists` — si el archivo ya existe, no lo sobreescribe.

## Carpetas de usuario

Las carpetas que crea el usuario libremente (`projects/`, `research/`, `clients/`, etc.) **no tienen contrato y no lo necesitan**. El scanner las indexa normalmente, sin restricciones. El sistema las trata como carpetas de contexto de usuario puro.

## Extensión para plugins

Un plugin de tercero puede declarar una carpeta custom con su propio contrato creando un `.folder.yaml` en esa carpeta. El sistema lo respeta automáticamente sin necesidad de modificar el código base:

```yaml
# research/.folder.yaml
role: research
description: Long-running research threads
lifecycle: permanent
scannable: true
writable_by_mcp: true
required_fields: [id, type, l0, confidence]
optional_fields: [tags, related, derived_from]
default_values:
  confidence: 0.5
```

Si el `role` no es `skill` ni `rule`, el `system_role` será `None` — la carpeta participa en el ciclo de memorias normal pero sin comportamiento especial del engine.

## Archivos de referencia

- Módulo: [`src-tauri/src/core/folder_contract.rs`](../../src-tauri/src/core/folder_contract.rs)
- Detección de rol: [`src-tauri/src/core/paths.rs`](../../src-tauri/src/core/paths.rs) — `system_role()`
- Validación en scanner: [`src-tauri/src/core/index.rs`](../../src-tauri/src/core/index.rs) — `scan_dir_recursive()`
- Creación en init: [`src-tauri/src/commands/config.rs`](../../src-tauri/src/commands/config.rs) — `write_folder_contracts()`
