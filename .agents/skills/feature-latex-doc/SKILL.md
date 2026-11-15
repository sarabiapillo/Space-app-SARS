---
name: feature-latex-doc
description: "Trigger: implementar una feature, nueva funcionalidad, feature implementation. Documenta cada feature implementada de TerraPulse AI en LaTeX dentro del mismo trabajo."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Activá este skill al implementar o modificar una feature en este repositorio, incluso si el pedido no menciona documentación. No lo actives para investigación, propuestas sin implementación o correcciones que no cambien una funcionalidad.

## Hard Rules

- Creá o actualizá `docs/features/<slug>.tex` en la misma unidad de trabajo que la feature; usá un slug estable en kebab-case y conservá el archivo existente si ya documenta esa feature.
- Escribí la documentación en español de México, sin voseo ni regionalismos rioplatenses, y en LaTeX válido, autónomo (`article`, UTF-8), sin dependencias ni paquetes nuevos salvo necesidad justificada.
- Documentá solo comportamiento implementado y comprobado: propósito, interfaz o flujo de uso, entradas/salidas, archivos o componentes relevantes, límites, y pasos de verificación reproducibles con sus resultados observados. Si una prueba no corrió, indicá que está pendiente y por qué.
- Para datos NISAR o métricas, distinguí observación de inferencia; no inventes escenas, cifras, validaciones ni causas. No copies secretos, rutas privadas ni datos ignorados por Git.
- Respetá la titularidad de archivos del plan del equipo; si no tenés permiso para editar la documentación necesaria, informá el bloqueo y proponé el texto al dueño, sin afirmar que la feature está documentada.

## Decision Gates

| Situación | Acción |
| --- | --- |
| Feature nueva | Creá `docs/features/<slug>.tex`. |
| Feature existente modificada | Actualizá su documento, sin crear uno duplicado. |
| Comportamiento aún no verificado | Describí la implementación como no verificada; no inventes resultados. |

## Execution Steps

1. Leé la implementación y el documento existente, si lo hay; extraé únicamente hechos comprobables.
2. Escribí o actualizá el `.tex` junto con código y pruebas de la feature; usá secciones `Objetivo`, `Uso`, `Implementación`, `Limitaciones` y `Verificación` según corresponda.
3. Si hay compilador LaTeX disponible, compilá en un directorio temporal dentro del proyecto y borrá solo tus archivos temporales; si no, verificá estructura y comandos manualmente. No incorpores PDF ni auxiliares generados al repositorio.

## Output Contract

Indicá ruta del `.tex`, qué comportamiento cubre, comprobaciones realizadas y cualquier verificación pendiente o bloqueo.

## References

- `../../../AGENTS.md` — rigor científico, trazabilidad y convenciones del proyecto.
- `../../../docs/plan-de-trabajo.md` — contratos y titularidad de archivos.
