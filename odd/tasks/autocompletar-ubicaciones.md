# Autocompletar ubicaciones
Branch: feature/roi-gcov-search. Delivery: uncommitted per previous user constraint; no push.
Scope: suggestions while typing; explicit Nominatim selection and ROI unchanged.

## Specs
S1. «Lo unico que quiero que agregues es que mientras se va escribiendo se vaya completando los municipios, ciudades o pais»

## Tasks
T1 [S1] route: parent inline; status: done; commit: none per previous user constraint; evidence: Photon suggestions endpoint, cache and 0.5s shared-cache rate guard; 4 focused Django tests pass.
T2 [S1] route: parent inline; status: done; commit: none; evidence: debounced keyboard-accessible suggestions, explicit Nominatim selection, focused web tests/build/lint pass.
T3 [S1] route: parent inline + independent verifier; status: done; commit: none; evidence: docs/features/seleccion-geografica-roi.tex compiled; independent verifier found rate-limit gap, corrected; 47 Django tests, 51 web tests, build, focused lint and git diff --check passed.

## Log
L1 (original user request, verbatim): Lo unico que quiero que agregues es que mientras se va escribiendo se vaya completando los municipios, ciudades o pais
L2: Nominatim public explicitly disallows autocomplete. Use Photon public autocomplete only for suggested text, with frontend debounce/backend guard/cache; preserve explicit Nominatim provider search to obtain actual administrative geometry. Sources: https://operations.osmfoundation.org/policies/nominatim/ and https://github.com/komoot/photon/blob/master/README.md. Photon public availability has no guarantee; never turn suggestions into ROI without the explicit Nominatim flow.
L3: Independent verifier ran 3 Django and 31 frontend targeted tests and found backend lacked server rate limit for uncached queries. Added RED/GREEN test and cache-backed 0.5s rate guard. Final 47 Django and 51 web tests, build, focused lint, LaTeX compile and git diff --check passed. Browser visual behavior not exercised; native RDD assess unavailable (package-local-binary-missing). No commits/push.
