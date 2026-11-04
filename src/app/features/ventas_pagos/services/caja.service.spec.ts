import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpClient } from '@angular/common/http';
import {
  CajaService,
  CLAVE_DISPOSITIVO,
  CLAVE_TURNO_LOCAL,
  CLAVE_VENTAS_OFFLINE,
  CLAVE_COMPROBANTES_LOCAL,
  TurnoHabilitacion,
  VentaOfflineCrear,
  ComprobanteCajaOffline
} from './caja.service';
import { environment } from '../../../../environments/environment';

describe('CajaService (Persistencia Transaccional e IndexedDB)', () => {
  let service: CajaService;
  let httpMock: HttpTestingController;

  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const mockTurno: TurnoHabilitacion = {
    turno_id: '11111111-2222-4333-8444-555555555555',
    habilitacion_id: 'hab-01',
    caja_codigo: 'CAJA-01',
    dispositivo_id: '99999999-8888-4777-8666-555555555555',
    sucursal_id: 'suc-01',
    cajero_id: 'caj-01',
    estado: 'ABIERTO',
    inicio_en: '2026-11-04T08:00:00-04:00',
    vence_en: '2026-11-04T16:00:00-04:00',
    version_precios: 'v1.0',
    revision: 1,
    ultima_secuencia_local: 0,
    total_operaciones_locales: 0,
    cupos: [
      {
        variante_id: 'var-01',
        sku: 'SKU-ROJO-M',
        producto_nombre: 'Vestido Rojo',
        otorgado: 5,
        consumido: 0,
        liberado: 0,
        precio_autorizado_bob: 120
      }
    ]
  };

  const mockVentaOffline: VentaOfflineCrear = {
    operacion_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    secuencia_local: 1,
    vendida_local_en: '2026-11-04T10:00:00-04:00',
    entregada_local_en: '2026-11-04T10:00:00-04:00',
    version_precios: 'v1.0',
    lineas: [
      {
        variante_id: 'var-01',
        cantidad: 2,
        precio_autorizado_bob: 120
      }
    ],
    total_bob: 240,
    efectivo_recibido_bob: 250,
    cambio_entregado_bob: 10
  };

  const mockComprobante: ComprobanteCajaOffline = {
    operacion_id: mockVentaOffline.operacion_id,
    numero: 'VNT-OFF-AAAABB',
    fecha: '2026-11-04T10:00:00-04:00',
    lineas: [{ sku: 'SKU-ROJO-M', cantidad: 2, subtotal: 240 }],
    total: 240,
    efectivo: 250,
    cambio: 10,
    esOffline: true
  };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CajaService]
    });
    service = TestBed.inject(CajaService);
    httpMock = TestBed.inject(HttpTestingController);
    await service.limpiarTodaBd();
    service.resetearMigracionParaPruebas();
  });

  afterEach(async () => {
    httpMock.verify();
    await service.limpiarTodaBd();
    localStorage.clear();
  });

  // =========================================================================
  // Identificador de Dispositivo UUID v4
  // =========================================================================
  describe('Dispositivo ID y migración de formato', () => {
    it('debe generar y almacenar un UUID v4 válido cuando no existe identificador previo', () => {
      const id = service.obtenerDispositivoId();
      expect(UUID_V4_REGEX.test(id)).toBeTrue();
      expect(localStorage.getItem(CLAVE_DISPOSITIVO)).toBe(id);
    });

    it('debe migrar transparentemente un identificador previo con prefijo "disp-..." a UUID v4', () => {
      localStorage.setItem(CLAVE_DISPOSITIVO, 'disp-abc12345');
      const id = service.obtenerDispositivoId();

      expect(id).not.toBe('disp-abc12345');
      expect(UUID_V4_REGEX.test(id)).toBeTrue();
      expect(localStorage.getItem(CLAVE_DISPOSITIVO)).toBe(id);
    });

    it('debe conservar un UUID v4 preexistente sin regenerarlo', () => {
      const uuidExistente = '12345678-1234-4234-8234-123456789abc';
      localStorage.setItem(CLAVE_DISPOSITIVO, uuidExistente);

      const id = service.obtenerDispositivoId();
      expect(id).toBe(uuidExistente);
    });

    it('debe enviar el dispositivo_id en las peticiones a /cajas/turnos/activo', () => {
      const uuidPrueba = '99999999-8888-4777-8666-555555555555';
      service.consultarTurnoActivo(uuidPrueba).subscribe();

      const req = httpMock.expectOne(`${environment.apiUrl}/cajas/turnos/activo?dispositivo_id=${uuidPrueba}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockTurno);
    });
  });

  // =========================================================================
  // IndexedDB como Única Fuente Transaccional Canónica
  // =========================================================================
  describe('IndexedDB como Fuente Transaccional Canónica', () => {
    it('debe persistir atómicamente el turno actualizado, la venta offline y el comprobante en IndexedDB sin escritura dual en localStorage', async () => {
      const turnoActualizado: TurnoHabilitacion = {
        ...mockTurno,
        ultima_secuencia_local: 1,
        total_operaciones_locales: 1,
        cupos: [{ ...mockTurno.cupos[0], consumido: 2 }]
      };

      await service.registrarVentaOfflineTransaccional(turnoActualizado, mockVentaOffline, mockComprobante);

      // 1. Verificar lectura desde IndexedDB (turnos)
      const turnoGuardado = await service.obtenerTurnoLocal();
      expect(turnoGuardado).toBeTruthy();
      expect(turnoGuardado?.cupos[0].consumido).toBe(2);
      expect(turnoGuardado?.ultima_secuencia_local).toBe(1);

      // 2. Verificar lectura desde IndexedDB (ventas_offline)
      const pendientes = await service.obtenerVentasOfflinePendientes();
      expect(pendientes.length).toBe(1);
      expect(pendientes[0].operacion_id).toBe(mockVentaOffline.operacion_id);
      expect(pendientes[0].total_bob).toBe(240);

      // 3. Verificar lectura desde IndexedDB (comprobantes)
      const comprobantes = await service.obtenerComprobantesLocales();
      expect(comprobantes.length).toBe(1);
      expect(comprobantes[0].numero).toBe('VNT-OFF-AAAABB');

      // 4. Verificación de NO escritura dual en localStorage
      expect(localStorage.getItem(CLAVE_TURNO_LOCAL)).toBeNull();
      expect(localStorage.getItem(CLAVE_VENTAS_OFFLINE)).toBeNull();
      expect(localStorage.getItem(CLAVE_COMPROBANTES_LOCAL)).toBeNull();
    });

    it('debe lanzar error cuando el almacenamiento transaccional no está disponible', async () => {
      spyOn(service, 'esIndexedDbDisponible').and.returnValue(false);

      let errorLanzado: Error | null = null;
      try {
        await service.registrarVentaOfflineTransaccional(mockTurno, mockVentaOffline);
      } catch (err: any) {
        errorLanzado = err;
      }

      expect(errorLanzado).toBeTruthy();
      expect(errorLanzado?.message).toContain('Fallo de persistencia local');
    });

    it('guardarTurnoLocal debe fallar si IndexedDB no está disponible sin alterar la memoria', async () => {
      spyOn(service, 'esIndexedDbDisponible').and.returnValue(false);

      let errorCapturado: Error | null = null;
      try {
        await service.guardarTurnoLocal(mockTurno);
      } catch (err: any) {
        errorCapturado = err;
      }

      expect(errorCapturado).toBeTruthy();
      expect(errorCapturado?.message).toBe('IndexedDB no disponible para persistir el turno de caja');
      expect(service.obtenerTurnoLocalSincrono()).toBeNull();
    });

    it('guardarTurnoLocal debe propagar el error si la transacción de IndexedDB falla y no alterar el cache', async () => {
      spyOn(service, 'abrirBd').and.rejectWith(new Error('Fallo crítico de disco en IndexedDB'));

      let errorCapturado: Error | null = null;
      try {
        await service.guardarTurnoLocal(mockTurno);
      } catch (err: any) {
        errorCapturado = err;
      }

      expect(errorCapturado).toBeTruthy();
      expect(errorCapturado?.message).toContain('Fallo crítico de disco en IndexedDB');
      expect(service.obtenerTurnoLocalSincrono()).toBeNull();
    });

    it('guardarTurnoLocal actualiza el cache en memoria únicamente después de que IndexedDB confirma la escritura', async () => {
      expect(service.obtenerTurnoLocalSincrono()).toBeNull();

      await service.guardarTurnoLocal(mockTurno);

      expect(service.obtenerTurnoLocalSincrono()).toEqual(mockTurno);
      const turnoDesdeBd = await service.obtenerTurnoLocal();
      expect(turnoDesdeBd?.turno_id).toBe(mockTurno.turno_id);
    });

    it('recarga/reinicio: tras guardar el turno, una nueva sesión recupera el turno persistido y procesa ventas offline normalmente', async () => {
      await service.guardarTurnoLocal(mockTurno);

      // Simular nueva sesión / reinicio completo de la app
      const nuevaSesion = new CajaService(TestBed.inject(HttpClient));
      const turnoRecuperado = await nuevaSesion.obtenerTurnoLocal();
      expect(turnoRecuperado).toBeTruthy();
      expect(turnoRecuperado?.turno_id).toBe(mockTurno.turno_id);

      // Realizar cobro offline en la nueva sesión
      const venta: VentaOfflineCrear = {
        ...mockVentaOffline,
        operacion_id: '99999999-9999-4999-8999-999999999999'
      };
      const turnoConConsumo = {
        ...turnoRecuperado!,
        ultima_secuencia_local: 1,
        total_operaciones_locales: 1,
        cupos: [{ ...turnoRecuperado!.cupos[0], consumido: 2 }]
      };

      await nuevaSesion.registrarVentaOfflineTransaccional(turnoConConsumo, venta, mockComprobante);

      const turnoVerificado = await nuevaSesion.obtenerTurnoLocal();
      expect(turnoVerificado?.cupos[0].consumido).toBe(2);
      const pendientes = await nuevaSesion.obtenerVentasOfflinePendientes();
      expect(pendientes.length).toBe(1);
      expect(pendientes[0].operacion_id).toBe(venta.operacion_id);

      await nuevaSesion.cerrarBd();
    });

    it('migración segura: debe migrar datos previos de localStorage a IndexedDB y limpiar localStorage', async () => {
      // 1. Simular datos heredados existentes en localStorage
      localStorage.setItem(CLAVE_TURNO_LOCAL, JSON.stringify(mockTurno));
      localStorage.setItem(CLAVE_VENTAS_OFFLINE, JSON.stringify([mockVentaOffline]));
      localStorage.setItem(CLAVE_COMPROBANTES_LOCAL, JSON.stringify([mockComprobante]));

      // 2. Abrir la BD o llamar a consulta (dispara migración atómica)
      service.resetearMigracionParaPruebas();
      const turnoMigrado = await service.obtenerTurnoLocal();
      const ventasMigradas = await service.obtenerVentasOfflinePendientes();
      const comprobantesMigrados = await service.obtenerComprobantesLocales();

      // 3. Verificar que los datos ahora residen en IndexedDB
      expect(turnoMigrado).toBeTruthy();
      expect(turnoMigrado?.turno_id).toBe(mockTurno.turno_id);
      expect(ventasMigradas.length).toBe(1);
      expect(ventasMigradas[0].operacion_id).toBe(mockVentaOffline.operacion_id);
      expect(comprobantesMigrados.length).toBe(1);
      expect(comprobantesMigrados[0].numero).toBe('VNT-OFF-AAAABB');

      // 4. Verificar que localStorage fue purgado de datos transaccionales
      expect(localStorage.getItem(CLAVE_TURNO_LOCAL)).toBeNull();
      expect(localStorage.getItem(CLAVE_VENTAS_OFFLINE)).toBeNull();
      expect(localStorage.getItem(CLAVE_COMPROBANTES_LOCAL)).toBeNull();
    });

    it('recuperación tras reinicio: nueva instancia de servicio recupera el estado íntegro desde IndexedDB', async () => {
      // 1. Guardar turno y venta en IndexedDB
      await service.guardarTurnoLocal(mockTurno);
      await service.guardarVentaOfflinePendiente(mockVentaOffline);

      // 2. Crear nueva instancia de CajaService simulando recarga completa de la aplicación
      const nuevaInstancia = new CajaService(TestBed.inject(HttpClient));
      const turnoRecuperado = await nuevaInstancia.obtenerTurnoLocal();
      const ventasRecuperadas = await nuevaInstancia.obtenerVentasOfflinePendientes();

      expect(turnoRecuperado).toBeTruthy();
      expect(turnoRecuperado?.turno_id).toBe(mockTurno.turno_id);
      expect(ventasRecuperadas.length).toBe(1);
      expect(ventasRecuperadas[0].operacion_id).toBe(mockVentaOffline.operacion_id);

      await nuevaInstancia.cerrarBd();
    });

    it('eliminarVentaOfflinePendiente() debe remover únicamente la venta sincronizada por operacion_id', async () => {
      const venta1: VentaOfflineCrear = { ...mockVentaOffline, operacion_id: '11111111-1111-4111-8111-111111111111' };
      const venta2: VentaOfflineCrear = { ...mockVentaOffline, operacion_id: '22222222-2222-4222-8222-222222222222' };

      await service.guardarVentaOfflinePendiente(venta1);
      await service.guardarVentaOfflinePendiente(venta2);

      let pendientes = await service.obtenerVentasOfflinePendientes();
      expect(pendientes.length).toBe(2);

      await service.eliminarVentaOfflinePendiente(venta1.operacion_id);
      pendientes = await service.obtenerVentasOfflinePendientes();
      expect(pendientes.length).toBe(1);
      expect(pendientes[0].operacion_id).toBe(venta2.operacion_id);
    });

    it('debe registrar ventas offline contra la API preservando el operacion_id original para idempotencia', () => {
      service.registrarVentaOffline(mockTurno.turno_id, mockVentaOffline).subscribe((res) => {
        expect(res.operacion_id).toBe(mockVentaOffline.operacion_id);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/cajas/turnos/${mockTurno.turno_id}/ventas`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body.operacion_id).toBe(mockVentaOffline.operacion_id);

      req.flush({
        resultado: 'REGISTRADA_CENTRAL',
        operacion_id: mockVentaOffline.operacion_id,
        venta_id: 'vnt-001',
        numero: 'VNT-001',
        total_bob: 240,
        comprobante_id: 'cmp-001',
        recibida_central_en: '2026-11-04T10:05:00-04:00',
        cupos_restantes: []
      });
    });

    it('cerrarTurno() debe enviar los parámetros de conciliación al endpoint del backend', () => {
      const dtoCierre = {
        revision: 1,
        ultima_secuencia_local: 3,
        total_operaciones_locales: 3,
        operaciones_pendientes: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
        arqueo_efectivo_bob: 360
      };

      service.cerrarTurno(mockTurno.turno_id, dtoCierre).subscribe((res) => {
        expect(res.estado).toBe('CERRADO');
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/cajas/turnos/${mockTurno.turno_id}/cerrar`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body.revision).toBe(1);
      expect(req.request.body.ultima_secuencia_local).toBe(3);
      expect(req.request.body.total_operaciones_locales).toBe(3);
      expect(req.request.body.arqueo_efectivo_bob).toBe(360);
      expect(req.request.body.operaciones_pendientes).toEqual(['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']);

      req.flush({
        turno_id: mockTurno.turno_id,
        estado: 'CERRADO',
        cerrado_en: '2026-11-04T16:00:00-04:00',
        revision: 2,
        cupos_devueltos: []
      });
    });
  });
});
