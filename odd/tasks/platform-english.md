# Plataforma bilingüe español–inglés
Rama: `feature/roi-gcov-search`; base: `59884b9`. Interfaz completa con terminología científica contextual.
Conservar datos, nombres de usuario, identificadores, geometrías y contratos; sin nuevas dependencias ni publicación.

## Specs
S1. «se me pidio agregar la traducción al idioma ingles para la plataforma.»
S2. «Encargate de traducir todo el programa, utiliza las traducciones adecuadas, siempre revisa las diferentes interpretaciones y elige la más adecuada para el ambito de nuestra plataforma.»
S3. «Agrega la opción en la barra de navegación, donde esta "Archivo", "Escenas GCOV", "Procesamiento SAR", etc.»

## Tasks
T1 [S1-S3] completada — ruta: parent inline; base i18n español/inglés, persistencia y pruebas RED/GREEN — commit: en preparación.
T2 [S1-S3] pendiente — ruta: writer shell; navegación, selector, avisos, portada y rutas — commit: pendiente.
T3 [S1-S2] pendiente — ruta: writer map; mapa, búsqueda, GCOV y errores visibles — commit: pendiente.
T4 [S1-S2] pendiente — ruta: writer charts; inspección, figuras y módulos C4 — commit: pendiente.
T5 [S1-S2] pendiente — ruta: writer simulation; lluvia, inundación y radiación, formatos — commit: pendiente.
T6 [S1-S3] pendiente — ruta: parent; integración, auditoría terminológica/cobertura, regresiones, compilación y documentación LaTeX — commit: pendiente.

## Log
L1. Solicitud original: se me pidio agregar la traducción al idioma ingles para la plataforma. Encargate de traducir todo el programa, utiliza las traducciones adecuadas, siempre revisa las diferentes interpretaciones y elige la más adecuada para el ambito de nuestra plataforma. Agrega la opción en la barra de navegación, donde esta "Archivo", "Escenas GCOV", "Procesamiento SAR", etc.
L2. Continuaciones: «Ya, actualice los modelos, continua»; «Revisa ahora». Explorador disponible en el último intento; exploración completada sin cambios.
L3. Alcance de implementación: interfaz web completa en ambos idiomas; no traducir código, IDs, fórmulas, valores de catálogo, nombres propios ni contenido introducido por usuarios. API/pipeline sin cambios de contrato. Selector reactivo y preferencia separada del almacenamiento de mapas.
L4. Evidencia inicial: árbol limpio; no existe web/node_modules. Pruebas existentes node:test; compilación React/TypeScript/Vite pendiente de instalar dependencias fijadas. No se detectó pdflatex.
L5. Glosario: retrodispersión=backscatter; adquisición=acquisition; región de interés=region of interest; trayectoria=track; marco=frame; madurez=data maturity; calado=water depth (no draft); caudal=discharge; escorrentía=runoff; radiación incidente=incident irradiance; observación/inferencia/predicción y exploratorio/no validado conservados.

L6. T1 RED: node --test tests/i18n.test.mjs falló por módulo ausente. GREEN: 5/5 focales; suite 56/56; npx tsc -b exit 0. npm ci instaló 191 paquetes del lockfile sin cambios de dependencias. Fuente LaTeX creada; pdflatex no disponible.
