# Contrato del segundo parcial — Angular/PWA

**Versión propuesta: 0.1.1.** El contrato describe una implementación futura; las rutas nuevas de `interfaz.json` aún no son OpenAPI real. Esta carpeta viaja con el repositorio `frontend-web`, sin depender de rutas de otro clon.

**Implementación por agente:** dejar cambios locales sin commits, push ni PR hasta que el propietario haga pruebas manuales y dé su OK explícito. Ver [flujo-trabajo.md](flujo-trabajo.md).

## Contenido

- [reglas-aprobadas.md](reglas-aprobadas.md): acuerdos C01–C30, notificaciones y criterios técnicos completos para este repositorio.
- [casos-de-uso.md](casos-de-uso.md): las 37 fichas CU01–CU37 con actores, flujos y alternativas.
- [guia-revision-manual.md](guia-revision-manual.md): pasos para comprobar por cuenta propia el alcance, los mensajes y la trazabilidad.
- [interfaz.json](interfaz.json): copia fijada del contrato de mensajes y rutas cuyo origen está en `backend`.
- [operacion.schema.json](operacion.schema.json) y [resultado.schema.json](resultado.schema.json): esquemas de la cola y los resultados.
- [compartido.md](compartido.md): reglas compartidas de sincronización y pagos.
- [angular-pwa.md](angular-pwa.md): navegación, persistencia y estados visibles del cliente PWA y la caja web.
- [integracion.md](integracion.md): flujos y contratos funcionales entre canales.
- [payloads.md](payloads.md): solicitudes/respuestas ilustrativas para consumidores y dobles de prueba.
- [trazabilidad-cu.md](trazabilidad-cu.md): cambios en CU existentes y nuevas capacidades por componente.
- [paquetes-cu.md](paquetes-cu.md): mapa de paquetes y casos de uso compartido con backend y Flutter.
- [flujo-trabajo.md](flujo-trabajo.md): secuencia de entregas, PRs y condiciones de integración.
- [version.json](version.json): versión y SHA-256 de los tres JSON para comprobar que coinciden con backend y Flutter.

Angular implementa administración **online**, cliente PWA parcial y la única caja web offline. El desarrollo puede realizarse en un PR independiente; citar versión del contrato y PR de backend asociado. Los servicios HTTP deben poder trabajar con respuestas simuladas basadas en `interfaz.json` hasta disponer del OpenAPI exportado. Al integrar, comprobar la forma real de los mensajes y ejecutar los escenarios de `angular-pwa.md`. No declarar implementado un flujo cuyo endpoint siga siendo solo diseño.

El código actual está organizado físicamente por paquete en `src/app/features/<paquete>/`: cada paquete contiene sus pantallas, servicios y modelos. [paquetes-cu.md](paquetes-cu.md) muestra la correspondencia CU–paquete–carpeta. La caja actual dentro de `ventas_pagos/caja` cubre CU11 online; `caja_offline` de CU31–CU32 continúa prevista.

Si cambia el contrato común, primero se acuerda en backend, luego se actualizan las tres copias con la misma versión y hash. Un cambio incompatible exige migrar pendientes IndexedDB por `version_esquema`. Nunca se modifica una copia local para resolver una discrepancia sin propagar el cambio a los otros repositorios. Métodos y funciones nuevos en español, `camelCase`, salvo firmas obligatorias del framework o SDK.

Las fichas, reglas, trazabilidad, ejemplos, esquemas y guía de revisión residen en este repositorio. Los otros repositorios solo se necesitan para integrar sus implementaciones, no para conocer este contrato.
