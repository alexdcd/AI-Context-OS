# Plan De Integracion: decoracion markdown segura

## Proposito

Este archivo define el plan de implementacion para recuperar una experiencia tipo Obsidian en el editor markdown sin volver al ciclo de regresiones de seleccion que ya sufrimos.

El objetivo no es "hacerlo bonito" a cualquier precio. El objetivo es:

- mantener la seleccion nativa del navegador estable
- recuperar una presentacion mucho mas agradable del markdown
- mostrar la sintaxis markdown cuando la linea o bloque esta activo
- evitar mezclar cambios visuales y cambios delicados de DOM en el mismo paso

Este plan parte del estado actual estable del branch `decoracion-md` y usa el repo `blueberrycongee/codemirror-live-markdown` solo como blueprint parcial, no como dependencia ni como implementacion a copiar ciegamente.

---

## Invariantes No Negociables

- No anadir `codemirror-live-markdown` como dependencia.
- No mezclar decoraciones estructurales y live preview sensible en el mismo commit.
- No reintroducir `Decoration.replace` ni widgets ricos dentro del editor editable durante las fases de estabilizacion.
- Mantener como baseline que el ocultado inline use `Decoration.mark`, no `Decoration.replace`.
- No cambiar al mismo tiempo la logica de refresco por seleccion y la estrategia visual de ocultado.
- Si una fase rompe seleccion, doble click o triple click, parar y corregir esa fase. No apilar mas fixes encima.
- Actualizar `docs/editor-live-preview-guardrails.md` al cerrar cada fase relevante para que el siguiente agente entienda por que existe cada proteccion.

---

## Referencias Del Repo Actual

Leer antes de tocar codigo:

- `src/components/editor/HybridMarkdownEditor.tsx`
- `src/components/editor/editorLivePreview.ts`
- `src/components/editor/editorPreviewState.ts`
- `src/components/editor/editorWikilinks.ts`
- `src/components/editor/editorMouseSelection.ts`
- `src/components/editor/MemoryEditor.tsx`
- `src/components/chat/ChatPanel.tsx`
- `docs/editor-live-preview-guardrails.md`
- `tests/editorLivePreview.test.ts`
- `tests/editorPreviewState.test.ts`
- `tests/editorMouseSelection.test.ts`

Referencia externa a estudiar con criterio:

- `https://github.com/blueberrycongee/codemirror-live-markdown`

De esa referencia solo tomamos ideas concretas:

- `mouseSelectingField` para congelar decoraciones durante drag
- una fuente unica de verdad para decidir cuando mostrar syntax o preview
- reconstruccion unica despues de `mouseup`, no durante el drag

No tomamos en esta integracion:

- sus widgets ricos con `Decoration.replace` para el editor editable
- su estrategia visual completa como primer baseline
- sus decisiones de UX como si fueran una especificacion obligatoria

---

## Verificacion Inicial Ya Confirmada

Antes de empezar cualquier fase, asumir como baseline real estas verificaciones:

1. `package.json` no tiene script `test`.
2. La verificacion tipica del proyecto sigue siendo `npm run build`.
3. Los tests unitarios actuales si pasan con `node --test` en este entorno.

Comandos de baseline:

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts
```

Nota: `node --test` muestra un warning experimental de type stripping, pero los tests pasan. No tratar ese warning como fallo del plan.

---

## Estado Actual Que Hay Que Tener En Cuenta

- `shouldUsePresentationDecorations()` en `HybridMarkdownEditor.tsx` corta a la vez decoraciones estructurales y live preview.
- `createLivePreviewPlugin()` ya usa `Decoration.mark` para ocultar syntax inline.
- `hiddenSyntaxStyle` actual usa solo `color: transparent !important` y los tests protegen que no se alteren `fontSize`, `lineHeight`, `letterSpacing` ni `wordSpacing`.
- `shouldRenderReplacePreviewWidget(editable, lineIsActive)` ya protege de `Decoration.replace` en editable.
- `createWikilinkPreviewPlugin()` ya evita refrescos en `select.pointer` a traves de `shouldRefreshActivePreviewLines()`. El futuro `mouseSelectingField` sera una segunda capa, no la primera.
- `MemoryEditor.tsx` todavia no pasa `revealSyntaxOnActiveLine` a sus dos instancias de `HybridMarkdownEditor`.
- `ChatPanel.tsx` usa `editable={false}` y no pasa `showSyntax`, asi que si se reactiva live preview podria activar decoraciones y widgets ricos antes de tiempo.

---

## Estrategia General

La implementacion se hace en fases pequenas, reversibles y con valor visible por si mismas.

### Regla principal

Primero reactivamos lo seguro y visible. Despues anadimos infraestructura anti-regresion. Solo luego reactivamos el live preview sensible.

### Regla de PRs y commits

- Un commit o PR por fase o subfase logica.
- No editar `createStructuralDecorations()` y `createLivePreviewPlugin()` en el mismo commit.
- No introducir nuevas features de checklist, prioridades, badges o overlays mientras se estabiliza este flujo.

---

## Fase 0 - Baseline Seguro

### Objetivo

Confirmar que se parte de un estado estable y verificable.

### Trabajo

- No tocar comportamiento.
- Ejecutar build y tests de baseline.
- Documentar brevemente en el PR o en notas de trabajo que ese es el punto de partida validado.

### Verificacion

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts
```

### Criterio de salida

- Build en verde.
- Tests actuales en verde.
- Seleccion actual estable intacta.

---

## Fase 1 - Recuperar Solo La Capa Estructural

### Objetivo

Recuperar una presentacion mucho mas decente sin ocultar aun la syntax markdown inline.

### Trabajo

- Reemplazar el punto de corte unico por dos funciones separadas en `HybridMarkdownEditor.tsx`.

Ejemplo esperado:

```ts
function shouldUseStructuralDecorations() {
  return true
}

function shouldUseLivePreviewDecorations() {
  return false
}
```

- Hacer que `createStructuralDecorations()` consulte solo el switch estructural.
- Hacer que `createLivePreviewPlugin()` consulte solo el switch de live preview.
- Reactivar unicamente decoraciones estructurales: headings, blockquotes, listas, tasks visuales, code blocks, tablas.
- No tocar todavia la ocultacion de syntax inline.

### Detalle importante validado

`createStructuralDecorations()` contiene un `Decoration.replace` para `ImagePreviewWidget`, pero esta protegido por `shouldRenderReplacePreviewWidget(editable, false)`. Eso significa que no se ejecuta en el editor editable. No hace falta tocarlo en esta fase; solo documentarlo para que quede claro por que sigue siendo seguro.

### Verificacion

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts
```

### Checklist manual

- El texto se ve claramente mejor.
- Siguen visibles `#`, `**`, `[]`, etc.
- Drag selection funciona igual que en el baseline.
- Doble click y triple click siguen bien.
- Click en checkbox visual sigue haciendo toggle sin romper seleccion.

### Criterio de salida

- Mejora visual clara.
- Cero regresiones de seleccion.
- Sin tocar todavia live preview.

### Guardrails a actualizar

Actualizar `docs/editor-live-preview-guardrails.md` indicando que la capa estructural y la de live preview vuelven a estar explicitamente separadas y no deben remezclarse.

---

## Fase 2 - Introducir mouseSelectingField Como Infraestructura Viva

### Objetivo

Anadir un estado explicito de drag que sirva como guardian defensivo real, no como codigo muerto.

### Trabajo

- Crear `src/components/editor/editorMouseSelectingField.ts`.
- Implementar `StateField<boolean>` y su `StateEffect` asociado, por ejemplo `setMouseSelecting`.
- Conectar `mousedown` para activar el estado.
- Conectar `mouseup` en `document` y resolverlo con `requestAnimationFrame` para desactivar el estado cuando la seleccion nativa ya se haya asentado.
- Hacer limpieza correcta de listeners.
- Pre-cablear el campo como guardia defensiva en:
  - `createLivePreviewPlugin()`
  - `createWikilinkPreviewPlugin()`

Aunque el live preview siga desactivado, el guardia debe quedar conectado de forma que esta fase ya deje infraestructura viva y comprobable.

### Importante

No fusionar aqui cambios visuales. Esta fase solo introduce infraestructura anti-regresion y la deja consumida por plugins aunque sigan inactivos.

### Tests nuevos obligatorios

Crear `tests/editorMouseSelectingField.test.ts` con cobertura minima de:

- activar el campo con `setMouseSelecting.of(true)`
- desactivarlo con `setMouseSelecting.of(false)`
- comprobar que la logica de refresh sensible devuelve `false` o no reconstruye mientras el campo esta en `true`

No hace falta testear toda la UI del drag; si hace falta, extraer una funcion pequena que permita probar la decision de refresco sin depender del DOM completo.

### Verificacion

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts tests/editorMouseSelectingField.test.ts
```

### Checklist manual

- Durante un drag real, el campo pasa a `true`.
- Tras soltar el raton, el campo vuelve a `false`.
- Verificar en DevTools con `view.state.field(mouseSelectingField)` tras un drag.

### Criterio de salida

- El campo existe.
- El campo esta cableado y consumido por plugins sensibles.
- Hay test automatizado del nuevo contrato.
- No hay cambios visuales ni regresiones.

### Guardrails a actualizar

Anadir una seccion explicita en `docs/editor-live-preview-guardrails.md`:

- si vas a tocar el ciclo `drag -> mouseup`, leelo antes
- `mouseSelectingField` existe para impedir reconstrucciones durante la seleccion nativa
- no eliminarlo por "simplificacion" sin una prueba equivalente

---

## Fase 3 - Reactivar Live Preview Con El Baseline Mas Conservador

### Objetivo

Recuperar el comportamiento tipo Obsidian sin tocar aun el refinamiento visual mas delicado.

### Trabajo

- Reactivar `createLivePreviewPlugin()` usando el switch especifico de live preview.
- Mantener el ocultado inline con `Decoration.mark`.
- Mantener `hiddenSyntaxStyle` conservador usando `color: transparent !important`.
- No migrar todavia a `max-width`, `opacity` animada o `fontSize: 0.01em` como baseline. Eso queda para refinamiento posterior.
- Hacer que la logica sensible consulte `mouseSelectingField` y congele reconstrucciones durante drag.
- Mantener tambien la proteccion ya existente de `shouldRefreshActivePreviewLines()` contra `select.pointer` y rangos activos.
- Hacer que el plugin de wikilinks respete tambien `mouseSelectingField`, aunque ya filtre `select.pointer` hoy. El nuevo campo es una segunda capa de defensa.

### Aislamiento del radio de explosion

En esta fase, forzar `ChatPanel` a modo conservador:

```tsx
<HybridMarkdownEditor
  content={turn.content}
  onChange={() => {}}
  editable={false}
  revealSyntaxOnActiveLine={false}
  showSyntax={true}
/>
```

Motivo: evitar que la reactivacion de live preview en modo read-only permita widgets ricos o decoraciones no necesarias en chat mientras estabilizamos el editor principal.

### Advertencia UX conocida

Con `color: transparent`, al arrastrar seleccion puede verse una banda de seleccion sobre texto visualmente invisible. Eso no es un bug funcional; es un tradeoff UX aceptado en esta fase porque preserva mejor las metricas del texto. No intentar resolver esto ahora.

### Verificacion

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts tests/editorMouseSelectingField.test.ts
```

### Checklist manual obligatorio

Probar en un `.md` real, no en snippets aislados:

- arrastrar a traves de `# heading`
- arrastrar a traves de `**bold**`, `*italic*` y links markdown
- triple click en parrafo normal
- triple click en tareas `- [ ]`
- doble click dentro de una palabra en un link
- doble click dentro de un wikilink
- mover el cursor con flechas y ver reveal en la linea activa
- comprobar que durante drag `view.state.field(mouseSelectingField)` es `true`
- comprobar que despues de soltar vuelve a `false`
- copiar una seleccion y verificar que el portapapeles lleva markdown crudo

### Criterio de salida

- Live preview vuelve.
- La linea activa revela syntax.
- No hay reconstrucciones visibles durante drag.
- ChatPanel queda aislado del experimento.

### Confirmacion que debe quedar documentada en el PR

- `shouldRenderReplacePreviewWidget(editable, lineIsActive)` sigue protegiendo de `Decoration.replace` en editable.
- Los paths de `LinkIconWidget` e `ImagePreviewWidget` no se activan en el editor editable.

### Guardrails a actualizar

Registrar que:

- `Decoration.mark` para ocultacion inline es invariante del baseline estable
- `mouseSelectingField` es la proteccion contra churn durante drag
- ChatPanel esta temporalmente en modo conservador a proposito

---

## Fase 4 - Alinear El Comportamiento Del Producto

### Objetivo

Asegurar que la UI y los ajustes hacen exactamente lo que prometen.

### Trabajo

En `MemoryEditor.tsx`, aplicar el cableado correcto en las dos instancias del editor:

```tsx
showSyntax={showMarkdownSyntax}
revealSyntaxOnActiveLine={!showMarkdownSyntax}
```

Aplicar tanto a:

- la instancia L2
- la instancia L1

Interpretacion correcta:

- si `showMarkdownSyntax === true`, todo el markdown se ve y no hace falta reveal por linea activa
- si `showMarkdownSyntax === false`, estamos en modo preview y la sintaxis debe reaparecer al entrar el cursor

### Verificacion

```bash
npm run build
node --test tests/editorLivePreview.test.ts tests/editorPreviewState.test.ts tests/editorMouseSelection.test.ts tests/editorMouseSelectingField.test.ts
```

### Checklist manual

- El toggle de ajustes coincide con el comportamiento real.
- L1 y L2 se comportan igual.
- En modo raw, se ve todo el markdown siempre.
- En modo preview, la syntax reaparece solo cuando corresponde.

### Criterio de salida

- Producto y comportamiento tecnico quedan alineados.

### Guardrails a actualizar

Anadir al documento de guardrails que el contrato de `showSyntax` y `revealSyntaxOnActiveLine` no debe volver a quedar desacoplado de la UI.

---

## Fase 5 - Refinamiento Visual Opcional

### Objetivo

Pulir la experiencia visual sin tocar la estabilidad ya conseguida.

### Trabajo posible

- Evaluar si compensa migrar parte del ocultado inline a una estrategia visual inspirada en el repo externo.
- Considerar animaciones o transiciones suaves solo en un commit separado y reversible.
- Estudiar un refinamiento futuro para `ALWAYS_HIDDEN_MARKERS` si se quiere revelar `ListMark` o `QuoteMark` cuando el cursor este exactamente dentro del nodo.

### Lo que sigue fuera de alcance tambien aqui salvo decision explicita

- widgets ricos en editable
- previews complejas con `Decoration.replace` en el editor principal
- nuevas features de checklist u overlays de prioridad

### Nota importante

El comportamiento actual de `ALWAYS_HIDDEN_MARKERS` oculta siempre `QuoteMark`, `HorizontalRule`, `ListMark`, `TaskMarker` y `TableDelimiter`. Eso es aceptable para las fases 1-4. Si se quiere un comportamiento mas fino cuando el cursor cae exactamente dentro del marcador, tratarlo como refinamiento separado en esta fase.

### Criterio de salida

- Mejora visual sin tocar estabilidad.
- Ningun refinamiento entra si reabre bugs de seleccion.

---

## Checklist Manual Global

Este checklist se repite siempre que una fase toque render, seleccion o wiring del editor:

- arrastrar seleccion en headings
- arrastrar seleccion en bold e italic
- doble click en link markdown
- doble click en wikilink
- triple click en parrafo normal
- triple click en tareas
- click en checkbox visual
- flechas de cursor entre lineas
- copiar seleccion con syntax oculta
- pegar HTML/rich text y comprobar turndown
- probar L1 y L2
- comprobar `view.state.field(mouseSelectingField)` durante drag y despues de mouseup

---

## Criterios De Stop Inmediato

Parar la implementacion y no seguir a la siguiente fase si ocurre cualquiera de estos casos:

- el DOM cambia durante drag selection
- el triple click vuelve a fallar
- el doble click selecciona mal dentro de inline syntax
- aparecen widgets ricos en editable sin haber sido planeados para esa fase
- se rompe el contrato del toggle de markdown en ajustes
- se elimina o bypassa `mouseSelectingField` sin cobertura equivalente

---

## resumen 

Implementa este plan por fases partiendo del baseline actual estable. No uses `codemirror-live-markdown` como dependencia; usalo solo como blueprint para `mouseSelectingField`, congelacion durante drag y una fuente unica de verdad para decidir cuando mostrar syntax. Mantén como invariante que el ocultado inline use `Decoration.mark`, no `Decoration.replace`. Fase 1: reactiva solo decoraciones estructurales usando un switch separado del live preview. Fase 2: añade `mouseSelectingField`, cablealo como guardia real en live preview y wikilinks aunque sigan inactivos, y crea `tests/editorMouseSelectingField.test.ts`. Fase 3: reactiva live preview con el baseline mas conservador, manteniendo `color: transparent`, respetando `mouseSelectingField`, y fuerza `ChatPanel` a `showSyntax={true}` para aislar el riesgo. Fase 4: conecta `revealSyntaxOnActiveLine={!showMarkdownSyntax}` en las dos instancias de `MemoryEditor.tsx`. Fase 5: solo refinamiento visual opcional y separado. Si alguna fase rompe seleccion, doble click o triple click, para y corrige esa fase antes de seguir.
