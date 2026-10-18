# Contrato Angular y PWA

**Estado:** diseño de cliente web previo a implementación. Reglas compartidas en [compartido.md](compartido.md). Al modificar `frontend-web`, aplicar el skill `fashionstore-frontend-continuity` y conservar identidad visual, navegación por roles, responsive y accesibilidad.

## Ámbitos y navegación

| Área | Conexión | Persistencia local |
|---|---|---|
| Administración habitual | Obligatoria | Solo datos de sesión/caché ordinario; gestión de empresas, planes, inventario, cambios, reportes y ML no opera offline. |
| Cliente PWA parcial | Catálogo descargado, carrito, solicitud de reserva/compra y pendientes disponibles offline según reglas | IndexedDB separado por empresa/usuario para privados; catálogo público versionado. |
| Caja web instalada | Turno habilitado online; venta de contado dentro de cupos durante desconexión | IndexedDB separado de cliente: habilitación, precios, promociones, cupos, borradores, ventas, efectivo/entrega y resultados. |

La caja requiere rol de cajero/administrador y sucursal asignada. Nunca se habilita por una sesión de cliente. Se debe probar instalación y reinicio offline reales; compartir origen Angular no implica compartir datos ni permiso. Configurar manifest y service worker sin ámbitos/cachés que entreguen datos de otra empresa o usuario.

## Cliente PWA

- Invitado consulta solo catálogo público previamente descargado. Usuario previamente autenticado puede ver datos privados hasta ocho horas desde último login online; al vencer/logout se ocultan y se conservan aislados hasta reautenticación. La aplicación no envía pendientes con una cuenta distinta.
- Cada operación se escribe antes de mostrar «guardada localmente» y conserva UUID/versión/fecha/estado tras reinicio. Enviar al abrir, volver al primer plano, recuperar red o pulsar reintentar; no prometer sincronización garantizada con PWA cerrada.
- Mostrar fecha de última descarga y «existencia conocida», no «stock reservado» para copia local. Si precio o stock cambia al sincronizar, mostrar detalle y acción de aceptación o corrección.
- Bandeja de resultados persistida, aviso visible con app abierta y Web Push cuando navegador/permiso lo permiten. Push abre y reconsulta estado autenticado; no inicia pago.

## Caja web offline

- Descargar antes de desconectar habilitación de ocho horas, cupos, productos, precios y promociones autorizados. Guardar todo en una transacción local verificable antes de permitir el turno.
- Impedir nueva venta sin cupo, después de ocho horas, ante fallo de persistencia o con una caja/usuario distinto. Guardar borrador y cupo provisional; si se recibe efectivo, registrar venta durable antes de entregar. Si falla, devolver efectivo y no entregar.
- Etiquetas separadas: «cobrado y entregado localmente», «pendiente central», «registrado central» e «incidencia para conciliar». No borrar registros de efectivo/entrega por un error de red o conflicto.
- Al volver Internet, consultar/enviar operaciones con mismo UUID, recuperar resultados, sincronizar todo, cerrar turno y solo entonces devolver cupos no usados. Pérdida de almacenamiento requiere flujo online de conteo auditado; no auto liberar.

## Funciones nuevas en español y aceptación

Ejemplos de nombres Angular: `guardarSolicitudLocal`, `sincronizarPendientes`, `consultarResultado`, `ocultarDatosPrivados`, `abrirTurnoCaja`, `guardarVentaLocal`, `cerrarTurnoCaja`, `mostrarEstadoPago`. Adaptar servicios HTTP existentes en vez de duplicar lógica de negocio; stock, precio, permiso y aceptación son del backend.

Pruebas: instalación, reapertura sin red, múltiples pestañas, cambio de usuario/empresa, sesión de ocho horas, solicitud caducada, stock/importe cambiado, dos cajas, cuota agotada, turno vencido, error de escritura IndexedDB, push denegado y recibo/resultado durable. Pago, cambios, reportes y ML requieren conexión.
