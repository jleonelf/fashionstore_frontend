# Contrato del segundo parcial — Angular/PWA

**Versión propuesta: 0.1.0.** El contrato describe una implementación futura; las rutas nuevas de `interfaz.json` aún no son OpenAPI real. Esta carpeta viaja con el repositorio `frontend-web`, sin depender de rutas de otro clon.

## Contenido

- [interfaz.json](interfaz.json): copia fijada del contrato de mensajes y rutas cuyo origen está en `backend`.
- [operacion.schema.json](operacion.schema.json) y [resultado.schema.json](resultado.schema.json): esquemas de la cola y los resultados.
- [compartido.md](compartido.md): reglas compartidas de sincronización y pagos.
- [angular-pwa.md](angular-pwa.md): navegación, persistencia y estados visibles del cliente PWA y la caja web.
- [integracion.md](integracion.md): flujos y contratos funcionales entre canales.
- [payloads.md](payloads.md): solicitudes/respuestas ilustrativas para consumidores y dobles de prueba.
- [trazabilidad-cu.md](trazabilidad-cu.md): cambios en CU existentes y nuevas capacidades por componente.
- [flujo-trabajo.md](flujo-trabajo.md): secuencia de entregas, PRs y condiciones de integración.
- [version.json](version.json): versión y SHA-256 de los tres JSON para comprobar que coinciden con backend y Flutter.

Angular implementa administración **online**, cliente PWA parcial y la única caja web offline. El desarrollo puede realizarse en un PR independiente; citar versión del contrato y PR de backend asociado. Los servicios HTTP deben poder trabajar con respuestas simuladas basadas en `interfaz.json` hasta disponer del OpenAPI exportado. Al integrar, comprobar la forma real de los mensajes y ejecutar los escenarios de `angular-pwa.md`. No declarar implementado un flujo cuyo endpoint siga siendo solo diseño.

Si cambia el contrato común, primero se acuerda en backend, luego se actualizan las tres copias con la misma versión y hash. Un cambio incompatible exige migrar pendientes IndexedDB por `version_esquema`. Nunca se modifica una copia local para resolver una discrepancia sin propagar el cambio a los otros repositorios. Métodos y funciones nuevos en español, `camelCase`, salvo firmas obligatorias del framework o SDK.
