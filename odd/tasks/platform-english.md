# Plataforma bilingüe español–inglés
Rama: `feature/roi-gcov-search`; base: `59884b9`. Interfaz completa con terminología científica contextual.
Conservar datos, nombres de usuario, identificadores, geometrías y contratos; sin nuevas dependencias ni publicación.

## Specs
S1. «se me pidio agregar la traducción al idioma ingles para la plataforma.»
S2. «Encargate de traducir todo el programa, utiliza las traducciones adecuadas, siempre revisa las diferentes interpretaciones y elige la más adecuada para el ambito de nuestra plataforma.»
S3. «Agrega la opción en la barra de navegación, donde esta "Archivo", "Escenas GCOV", "Procesamiento SAR", etc.»

## Tasks
T1 [S1-S3] completada — ruta: parent inline; base i18n español/inglés, persistencia y pruebas RED/GREEN — commit: 6a526ce.
T2 [S1-S3] completada — ruta: writer shell; navegación, selector, avisos, portada y rutas — commit: abf2453.
T3 [S1-S2] en curso (continuación autorizada, máximo dos rondas adicionales) — ruta: writer map; mapa, búsqueda, GCOV y errores visibles — commit: pendiente.
T4 [S1-S2] completada — ruta: writer charts; inspección, figuras y módulos C4 — commits: 07f0f5f (visor/catálogo), segunda unidad en preparación.
T5 [S1-S2] completada — ruta: writer simulation; lluvia, inundación y radiación, formatos — commit: 8e4a794.
T6 [S1-S3] pendiente — ruta: parent; integración, auditoría terminológica/cobertura, regresiones, compilación y documentación LaTeX — commit: pendiente.

## Log
L1. Solicitud original: se me pidio agregar la traducción al idioma ingles para la plataforma. Encargate de traducir todo el programa, utiliza las traducciones adecuadas, siempre revisa las diferentes interpretaciones y elige la más adecuada para el ambito de nuestra plataforma. Agrega la opción en la barra de navegación, donde esta "Archivo", "Escenas GCOV", "Procesamiento SAR", etc.
L2. Continuaciones: «Ya, actualice los modelos, continua»; «Revisa ahora». Explorador disponible en el último intento; exploración completada sin cambios.
L3. Alcance de implementación: interfaz web completa en ambos idiomas; no traducir código, IDs, fórmulas, valores de catálogo, nombres propios ni contenido introducido por usuarios. API/pipeline sin cambios de contrato. Selector reactivo y preferencia separada del almacenamiento de mapas.
L4. Evidencia inicial: árbol limpio; no existe web/node_modules. Pruebas existentes node:test; compilación React/TypeScript/Vite pendiente de instalar dependencias fijadas. No se detectó pdflatex.
L5. Glosario: retrodispersión=backscatter; adquisición=acquisition; región de interés=region of interest; trayectoria=track; marco=frame; madurez=data maturity; calado=water depth (no draft); caudal=discharge; escorrentía=runoff; radiación incidente=incident irradiance; observación/inferencia/predicción y exploratorio/no validado conservados.

L6. T1 RED: node --test tests/i18n.test.mjs falló por módulo ausente. GREEN: 5/5 focales; suite 56/56; npx tsc -b exit 0. npm ci instaló 191 paquetes del lockfile sin cambios de dependencias. Fuente LaTeX creada; pdflatex no disponible.

L7. T2–T5 se ejecutan en paralelo con superficies disjuntas; la lista visible mantiene T2 como frente activo mientras se integran resultados. T1 commit 6a526ce. Cada escritor debe añadir pruebas y reportar evidencia; padre conserva documentación y commits.

L8. T5: escritor reportó RED 4 fallos y GREEN 4/4; padre observó 15/15 pruebas de simulación/ROI/radiación, exit 0. No se cambiaron algoritmos, DTOs ni valores; imágenes originales y mensajes desconocidos conservan idioma fuente. Verificación manual de navegador no disponible.

L9. T2: RED reportado 0/3; GREEN 4/4. Padre observó 32/32 entre shell/ROI/GCOV/toast. Selector nativo accesible ES/EN en barra superior; no key de remonte. T3 terminó con pruebas 3/3 y tsc exit 0, pero cobertura parcial y dos rondas agotadas: MapCanvas bitácora/valores/procedencia, progreso GCOV y mensajes variables de manifiestos pendientes. No continuar T3 sin autorización humana; todos sus cambios se conservan sin marcar completada.

L10. T4 reportó 4/4 focales y tsc exit 0; traducción de etiquetas/manifiestos/figuras/módulos entregada sin commit. Revisión del padre detectó cambio no solicitado en visibilidad de advertencias del comparador; se restauró condición original (solo comparable, primera advertencia) conservando localización. No se ejecutaron nuevas comprobaciones después del cierre parcial de T3; esta restauración queda pendiente de prueba de integración.
L11. Estado de parada acotada: ningún hijo activo ni de estado incierto (lista consultada). T1 6a526ce, T5 8e4a794, T2 abf2453. T3/T4 y auditoría estructural conservados sin commit, cobertura completa y build final pendientes. No se afirma entrega completa. No hay navegador ni pdflatex; no hubo publicación.
L12. Continuación propuesta para decisión humana: mismo escritor de T3, mismas superficies, completar bitácora/valores/procedencia/progreso y mensajes conocidos, máximo dos rondas; padre integra T4, inventario terminológico/textos, node --test tests/*.test.mjs, tsc/build, lint y documentación LaTeX estructural. No se inicia sin autorización explícita. Risk: none (cambios de presentación solicitados; se preservan contratos, geometrías, datos y algoritmos; no implica cobertura ni validación completa).

L13. Usuario: «Si», en respuesta a la propuesta exacta de completar textos con el mismo subagente y hasta dos rondas adicionales, y luego pruebas completas, compilación y revisión final. Antes de continuar se confirmó que todos los hijos estaban terminales. Se mantiene el trabajo y los límites anteriores; esta autorización inicia solamente la continuación acotada propuesta.

L14. Integración T4: padre detectó RED real en locale de Chart.js (undefined frente a en-US), añadió locale y corrigió dependencias reactivas de memos. GREEN: 14/14 en comprobación inicial ampliada; después de separar pruebas por unidad, 7/7 (catálogo4, visor1, render ROI/comparador2), tsc exit0. El render público conserva IDs, datos de máscara, nombres del usuario, URL de PNG y visibilidad original de advertencias. División en dos commits: visor/catálogos y paneles/módulos, con pruebas al lado.
L15. Lint de integración inicial: exit1, un error de react-refresh por export SCIENTIFIC_FIGURES ya existente en base59884b9 y diez advertencias de dependencias de hooks. Se corrigieron las de gráficos; las de mapa corresponden al escritor en curso. No se modifica el contrato exportado para ocultar un error previo. Confirmación ejecutable de lint base y lint final pendientes.

L16. T4 primera unidad commit07f0f5f (visor/catálogo y render de figuras). Segunda unidad paneles Chart.js/módulos incluye prueba pública de ejes y preservación de advertencias, sin ampliar comportamiento. La comprobación de whitespace detectó y corrigió una línea vacía final en una prueba antes de commit.
