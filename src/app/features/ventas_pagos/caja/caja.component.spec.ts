import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CajaComponent } from './caja.component';
import { CajaService, TurnoHabilitacion, VentaOfflineResultado, ComprobanteCajaOffline } from '../services/caja.service';
import { VentaPresencialService } from '../services/venta-presencial.service';
import { ReservaTrasladoService } from '../../reservas_traslados/services/reserva-traslado.service';
import { AuthService } from '../../identidad_empresas/services/auth.service';
import { ProductoService } from '../../catalogo/services/producto.service';

describe('CajaComponent (Persistencia Transaccional, Conciliación y Reintentos)', () => {
  let component: CajaComponent;
  let fixture: ComponentFixture<CajaComponent>;

  let cajaServiceSpy: jasmine.SpyObj<CajaService>;
  let ventaPresencialSpy: jasmine.SpyObj<VentaPresencialService>;
  let reservaServiceSpy: jasmine.SpyObj<ReservaTrasladoService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let productoServiceSpy: jasmine.SpyObj<ProductoService>;

  const mockUUID = '12345678-1234-4234-8234-123456789abc';

  const mockTurno: TurnoHabilitacion = {
    turno_id: 'turno-111',
    habilitacion_id: 'hab-111',
    caja_codigo: 'CAJA-01',
    dispositivo_id: mockUUID,
    sucursal_id: 'suc-111',
    cajero_id: 'caj-111',
    estado: 'ABIERTO',
    inicio_en: '2026-11-04T08:00:00-04:00',
    vence_en: '2026-11-04T16:00:00-04:00',
    version_precios: 'v1.0',
    revision: 1,
    ultima_secuencia_local: 0,
    total_operaciones_locales: 0,
    cupos: [
      {
        variante_id: 'var-1',
        sku: 'SKU-01',
        producto_nombre: 'Blusa Urbana',
        otorgado: 5,
        consumido: 0,
        liberado: 0,
        precio_autorizado_bob: 100
      }
    ]
  };

  beforeEach(async () => {
    cajaServiceSpy = jasmine.createSpyObj<CajaService>('CajaService', [
      'obtenerDispositivoId',
      'obtenerTurnoLocal',
      'guardarTurnoLocal',
      'limpiarTurnoLocal',
      'consultarTurnoActivo',
      'consultarTurno',
      'habilitarTurno',
      'registrarVentaOfflineTransaccional',
      'registrarVentaOffline',
      'obtenerVentasOfflinePendientes',
      'eliminarVentaOfflinePendiente',
      'removerVentaOfflinePendiente',
      'cerrarTurno',
      'recuperarTurno'
    ]);

    ventaPresencialSpy = jasmine.createSpyObj<VentaPresencialService>('VentaPresencialService', [
      'registrarVenta',
      'comprobante'
    ]);

    reservaServiceSpy = jasmine.createSpyObj<ReservaTrasladoService>('ReservaTrasladoService', [
      'reservaPorCodigo'
    ]);

    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', [
      'obtenerUsuarioActual',
      'estaAutenticado'
    ]);

    productoServiceSpy = jasmine.createSpyObj<ProductoService>('ProductoService', [
      'gestionarVariantes'
    ]);

    cajaServiceSpy.obtenerDispositivoId.and.returnValue(mockUUID);
    cajaServiceSpy.obtenerTurnoLocal.and.resolveTo(mockTurno);
    cajaServiceSpy.guardarTurnoLocal.and.resolveTo();
    cajaServiceSpy.limpiarTurnoLocal.and.resolveTo();
    cajaServiceSpy.consultarTurnoActivo.and.returnValue(of(mockTurno));
    cajaServiceSpy.consultarTurno.and.returnValue(of(mockTurno));
    cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([]);
    cajaServiceSpy.eliminarVentaOfflinePendiente.and.resolveTo();
    cajaServiceSpy.removerVentaOfflinePendiente.and.resolveTo();
    productoServiceSpy.gestionarVariantes.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [CajaComponent],
      providers: [
        { provide: CajaService, useValue: cajaServiceSpy },
        { provide: VentaPresencialService, useValue: ventaPresencialSpy },
        { provide: ReservaTrasladoService, useValue: reservaServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: ProductoService, useValue: productoServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CajaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debe inicializarse con dispositivo_id en formato UUID v4 y turno activo desde almacenamiento canónico', fakeAsync(() => {
    tick();
    expect(component.dispositivoId).toBe(mockUUID);
    expect(component.turnoActivo).toEqual(mockTurno);
  }));

  describe('Persistencia Transaccional y Regla de Atomicidad', () => {
    beforeEach(() => {
      component.turnoActivo = JSON.parse(JSON.stringify(mockTurno));
      component.lineasVentaOffline = [
        { variante_id: 'var-1', cantidad: 2, precio_bob: 100 }
      ];
      component.efectivoRecibido = 200;
      component.cambioEntregado = 0;
    });

    it('cuando la persistencia en almacenamiento transaccional es exitosa, descuenta cupo, incrementa contadores y muestra comprobante', fakeAsync(() => {
      cajaServiceSpy.registrarVentaOfflineTransaccional.and.resolveTo();
      const mockResultadoVenta: VentaOfflineResultado = {
        resultado: 'REGISTRADA_CENTRAL',
        operacion_id: 'op-123',
        venta_id: 'vnt-123',
        numero: 'VNT-123',
        total_bob: 200,
        comprobante_id: 'cmp-123',
        recibida_central_en: '2026-11-04T10:00:00-04:00',
        cupos_restantes: []
      };
      cajaServiceSpy.registrarVentaOffline.and.returnValue(of(mockResultadoVenta));

      component.cobrarVentaContado();
      tick();

      expect(cajaServiceSpy.registrarVentaOfflineTransaccional).toHaveBeenCalled();
      const args = cajaServiceSpy.registrarVentaOfflineTransaccional.calls.mostRecent().args;
      const turnoGuardado = args[0];
      const ventaGuardada = args[1];

      expect(turnoGuardado.cupos[0].consumido).toBe(2);
      expect(turnoGuardado.ultima_secuencia_local).toBe(1);
      expect(turnoGuardado.total_operaciones_locales).toBe(1);
      expect(ventaGuardada.secuencia_local).toBe(1);

      expect(component.comprobanteOffline).toBeDefined();
      expect(component.comprobanteOffline?.total).toBe(200);
      expect(component.lineasVentaOffline.length).toBe(0);
      expect(component.error).toBe('');
    }));

    it('si falla la persistencia en almacenamiento transaccional, NUNCA emite comprobante, preserva pedido y REUTILIZA el mismo operacion_id al reintentar', fakeAsync(() => {
      cajaServiceSpy.registrarVentaOfflineTransaccional.and.rejectWith(new Error('Fallo transaccional'));

      // 1. Primer intento (falla almacenamiento)
      component.cobrarVentaContado();
      tick();

      expect(component.comprobanteOffline).toBeUndefined();
      expect(component.error).toContain('Error de almacenamiento local');
      expect(component.lineasVentaOffline.length).toBe(1);
      expect(component.turnoActivo?.cupos[0].consumido).toBe(0);
      expect(component.procesando).toBeFalse();

      // Capturar operacion_id del primer intento
      const primerIntentoArgs = cajaServiceSpy.registrarVentaOfflineTransaccional.calls.mostRecent().args;
      const operacionIdPrimerIntento = primerIntentoArgs[1].operacion_id;
      expect(operacionIdPrimerIntento).toBeTruthy();

      // 2. Segundo intento (reintento tras resolver almacenamiento)
      cajaServiceSpy.registrarVentaOfflineTransaccional.and.resolveTo();
      cajaServiceSpy.registrarVentaOffline.and.returnValue(of({
        resultado: 'REGISTRADA_CENTRAL',
        operacion_id: operacionIdPrimerIntento,
        venta_id: 'vnt-abc',
        numero: 'VNT-ABC',
        total_bob: 200,
        comprobante_id: 'cmp-abc',
        recibida_central_en: '2026-11-04T10:05:00-04:00',
        cupos_restantes: []
      }));

      component.cobrarVentaContado();
      tick();

      const segundoIntentoArgs = cajaServiceSpy.registrarVentaOfflineTransaccional.calls.mostRecent().args;
      const operacionIdSegundoIntento = segundoIntentoArgs[1].operacion_id;

      // COMPROBACIÓN CRÍTICA DE NO DOBLE COBRO: El reintento DEBE mantener el MISMO operacion_id
      expect(operacionIdSegundoIntento).toBe(operacionIdPrimerIntento);
      expect(component.comprobanteOffline).toBeDefined();
      expect(component.lineasVentaOffline.length).toBe(0);
    }));

    it('ausencia de doble cobro: si falla la sincronización con el servidor, la venta se mantiene offline con el operacion_id canónico', fakeAsync(() => {
      cajaServiceSpy.registrarVentaOfflineTransaccional.and.resolveTo();
      cajaServiceSpy.registrarVentaOffline.and.returnValue(throwError(() => new Error('Network error')));

      component.cobrarVentaContado();
      tick();

      expect(component.comprobanteOffline).toBeDefined();
      expect(component.comprobanteOffline?.esOffline).toBeTrue();
      expect(component.lineasVentaOffline.length).toBe(0);
      expect(cajaServiceSpy.eliminarVentaOfflinePendiente).not.toHaveBeenCalled();
    }));
  });

  describe('Conciliación de Cierre coordinada con Backend', () => {
    it('cerrarTurno() debe enviar revision, ultima_secuencia_local, total_operaciones_locales, operaciones_pendientes y arqueo_efectivo_bob', fakeAsync(() => {
      component.turnoActivo = {
        ...mockTurno,
        revision: 2,
        ultima_secuencia_local: 5,
        total_operaciones_locales: 5
      };

      cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([
        {
          operacion_id: 'op-pendiente-1',
          secuencia_local: 4,
          vendida_local_en: '2026-11-04T10:00:00Z',
          entregada_local_en: '2026-11-04T10:00:00Z',
          version_precios: 'v1.0',
          lineas: [],
          total_bob: 100,
          efectivo_recibido_bob: 100,
          cambio_entregado_bob: 0
        }
      ]);

      cajaServiceSpy.cerrarTurno.and.returnValue(of({
        turno_id: mockTurno.turno_id,
        estado: 'CONCILIACION',
        cerrado_en: null,
        revision: 3,
        cupos_devueltos: []
      }));
      cajaServiceSpy.consultarTurno.and.returnValue(of({
        ...mockTurno,
        estado: 'CONCILIACION',
        revision: 3
      }));

      // Ejecutar cierre con arqueo ingresado
      component.cerrarTurno(500);
      tick();

      expect(cajaServiceSpy.cerrarTurno).toHaveBeenCalledWith(
        mockTurno.turno_id,
        {
          revision: 2,
          ultima_secuencia_local: 5,
          total_operaciones_locales: 5,
          operaciones_pendientes: ['op-pendiente-1'],
          arqueo_efectivo_bob: 500
        }
      );

      expect(component.turnoActivo?.estado).toBe('CONCILIACION');
      expect(component.error).toContain('1 operacion(es) pendiente(s)');
    }));

    it('modal de cierre interactivo: confirmarCierreTurno() transmite el arqueo ingresado', fakeAsync(() => {
      component.turnoActivo = {
        ...mockTurno,
        revision: 1,
        ultima_secuencia_local: 2,
        total_operaciones_locales: 2
      };

      cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([]);
      cajaServiceSpy.cerrarTurno.and.returnValue(of({
        turno_id: mockTurno.turno_id,
        estado: 'CERRADO',
        cerrado_en: '2026-11-04T16:00:00Z',
        revision: 2,
        cupos_devueltos: []
      }));

      component.abrirModalCierre();
      expect(component.mostrarDialogoCierre).toBeTrue();

      component.arqueoEfectivoBob = 340.50;
      component.confirmarCierreTurno();
      tick();

      expect(component.mostrarDialogoCierre).toBeFalse();
      expect(cajaServiceSpy.cerrarTurno).toHaveBeenCalledWith(
        mockTurno.turno_id,
        jasmine.objectContaining({
          revision: 1,
          ultima_secuencia_local: 2,
          total_operaciones_locales: 2,
          operaciones_pendientes: [],
          arqueo_efectivo_bob: 340.50
        })
      );
      expect(component.mensajeExito).toContain('Turno cerrado');
      expect(component.turnoActivo).toBeNull();
    }));
  });

  describe('Resolución física supervisada', () => {
    it('no permite enviar un cierre supervisado sin acta, arqueo y conteo completo', fakeAsync(() => {
      authServiceSpy.obtenerUsuarioActual.and.returnValue({ rol: 'ADMINISTRADOR' } as any);
      component.turnoActivo = { ...mockTurno, estado: 'CONCILIACION' };
      component.abrirModalCierre(true);

      component.confirmarCierreTurno();
      tick();

      expect(component.mostrarDialogoCierre).toBeTrue();
      expect(component.error).toContain('Completa el acta');
      expect(cajaServiceSpy.cerrarTurno).not.toHaveBeenCalled();
    }));

    it('envía conteo por variante y retiene faltante que espera sincronización tardía', fakeAsync(() => {
      authServiceSpy.obtenerUsuarioActual.and.returnValue({ rol: 'ENCARGADO' } as any);
      const turnoConciliacion: TurnoHabilitacion = {
        ...mockTurno,
        estado: 'CONCILIACION',
        revision: 3,
        cupos: [{ ...mockTurno.cupos[0], consumido: 1, liberado: 0 }]
      };
      component.turnoActivo = turnoConciliacion;
      cajaServiceSpy.consultarTurno.and.returnValue(of(turnoConciliacion));
      cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([]);
      cajaServiceSpy.cerrarTurno.and.returnValue(of({
        turno_id: mockTurno.turno_id,
        estado: 'CONCILIACION',
        cerrado_en: '2026-11-04T16:00:00Z',
        revision: 4,
        cupos_devueltos: [{ variante_id: 'var-1', otorgado: 5, consumido: 1, devuelto: 2 }],
        cupos_retenidos: [{ variante_id: 'var-1', otorgado: 5, consumido: 1, retenido: 2 }]
      }));

      component.abrirModalCierre(true);
      component.referenciaActa = 'ACTA-CAJA-2026-014';
      component.motivoSupervision = 'Conteo fisico al recuperar el dispositivo';
      component.arqueoEfectivoBob = 120;
      component.conteoFisicoPorVariante['var-1'] = 2;
      component.resolucionFaltantePorVariante['var-1'] = 'PENDIENTE_SINCRONIZACION';
      component.motivoFaltantePorVariante['var-1'] = 'Venta cobrada pendiente de recuperar';
      component.confirmarCierreTurno();
      tick();

      expect(cajaServiceSpy.cerrarTurno).toHaveBeenCalledWith(mockTurno.turno_id, jasmine.objectContaining({
        supervision_forzada: true,
        descarte_venta_fisica: false,
        arqueo_declarado_bob: 120,
        evidencia_cierre: {
          referencia_acta: 'ACTA-CAJA-2026-014',
          conteo_fisico_por_variante: [{ variante_id: 'var-1', cantidad_encontrada: 2 }]
        },
        ajustes_inventario: {
          resoluciones_por_variante: [{
            variante_id: 'var-1',
            resolucion: 'PENDIENTE_SINCRONIZACION',
            motivo: 'Venta cobrada pendiente de recuperar'
          }]
        }
      }));
      expect(component.turnoActivo?.estado).toBe('CONCILIACION');
      expect(component.error).toContain('2 prenda(s) retenida(s)');
    }));

    it('permite liberar cantidades confirmadas y registrar una merma con motivo', fakeAsync(() => {
      authServiceSpy.obtenerUsuarioActual.and.returnValue({ rol: 'ADMINISTRADOR' } as any);
      component.turnoActivo = { ...mockTurno, estado: 'CONCILIACION', revision: 2 };
      cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([]);
      cajaServiceSpy.cerrarTurno.and.returnValue(of({
        turno_id: mockTurno.turno_id,
        estado: 'CERRADO',
        cerrado_en: '2026-11-04T16:00:00Z',
        revision: 3,
        cupos_devueltos: [{ variante_id: 'var-1', otorgado: 5, consumido: 0, devuelto: 3 }],
        cupos_retenidos: []
      }));

      component.abrirModalCierre(true);
      component.referenciaActa = 'ACTA-CAJA-2026-015';
      component.motivoSupervision = 'Cierre con conteo fisico documentado';
      component.arqueoEfectivoBob = 0;
      component.conteoFisicoPorVariante['var-1'] = 3;
      component.resolucionFaltantePorVariante['var-1'] = 'MERMA';
      component.motivoFaltantePorVariante['var-1'] = 'Dano confirmado durante la inspeccion';
      component.confirmarCierreTurno();
      tick();

      expect(cajaServiceSpy.cerrarTurno.calls.mostRecent().args[1].ajustes_inventario?.resoluciones_por_variante)
        .toEqual([{
          variante_id: 'var-1',
          resolucion: 'MERMA',
          motivo: 'Dano confirmado durante la inspeccion'
        }]);
      expect(component.turnoActivo).toBeNull();
      expect(component.mensajeExito).toContain('Turno cerrado');
    }));
  });

  describe('Sincronización Idempotente con mismo operacion_id', () => {
    it('sincronizarVentasPendientes() transmite las operaciones pendientes y las elimina de IndexedDB tras confirmación', fakeAsync(() => {
      const operacionIdOriginal = '55555555-5555-4555-8555-555555555555';
      const ventaPendiente = {
        operacion_id: operacionIdOriginal,
        secuencia_local: 1,
        vendida_local_en: '2026-11-04T10:00:00-04:00',
        entregada_local_en: '2026-11-04T10:00:00-04:00',
        version_precios: 'v1.0',
        lineas: [{ variante_id: 'var-1', cantidad: 1, precio_autorizado_bob: 100 }],
        total_bob: 100,
        efectivo_recibido_bob: 100,
        cambio_entregado_bob: 0
      };

      cajaServiceSpy.obtenerVentasOfflinePendientes.and.resolveTo([ventaPendiente]);
      cajaServiceSpy.registrarVentaOffline.and.returnValue(of({
        resultado: 'REGISTRADA_CENTRAL',
        operacion_id: operacionIdOriginal,
        venta_id: 'vnt-1',
        numero: 'VNT-1',
        total_bob: 100,
        comprobante_id: 'cmp-1',
        recibida_central_en: '2026-11-04T10:05:00-04:00',
        cupos_restantes: []
      }));

      component.sincronizarVentasPendientes();
      tick();

      expect(cajaServiceSpy.registrarVentaOffline).toHaveBeenCalledWith(
        mockTurno.turno_id,
        jasmine.objectContaining({ operacion_id: operacionIdOriginal })
      );
      expect(cajaServiceSpy.eliminarVentaOfflinePendiente).toHaveBeenCalledWith(operacionIdOriginal);
    }));
  });

  describe('Accesibilidad y Traducción de Estados', () => {
    it('etiquetaEstadoTurno traduce estados técnicos a español legible', () => {
      expect(component.etiquetaEstadoTurno('ABIERTO')).toBe('Abierto');
      expect(component.etiquetaEstadoTurno('CERRADO')).toBe('Cerrado');
      expect(component.etiquetaEstadoTurno('CONCILIACION')).toBe('Conciliación requerida');
      expect(component.etiquetaEstadoTurno('RECUPERACION')).toBe('En recuperación');
    });
  });

  describe('Persistencia Garantizada de Apertura de Turno', () => {
    beforeEach(() => {
      authServiceSpy.obtenerUsuarioActual.and.returnValue({
        id: 'usr-1',
        email: 'cajero@fashionstore.test',
        nombre: 'Cajero Prueba',
        rol: 'VENDEDOR',
        activo: true,
        sucursal_id: 'suc-111'
      } as any);
      component.cajaId = 'CAJA-01';
      component.cuposSolicitados = [{ variante_id: 'var-1', cantidad: 5 }];
    });

    it('en abrirTurno, si la persistencia en IndexedDB falla: turnoActivo queda null, muestra error, conserva turnoPendienteRecuperacion y bloquea cobros offline', fakeAsync(() => {
      cajaServiceSpy.habilitarTurno.and.returnValue(of(mockTurno));
      cajaServiceSpy.guardarTurnoLocal.and.rejectWith(new Error('IndexedDB no disponible para persistir el turno de caja'));

      component.abrirTurno();
      tick();

      // Comprobaciones críticas
      expect(component.turnoActivo).toBeNull();
      expect(component.turnoPendienteRecuperacion as any).toEqual(mockTurno);
      expect(component.error).toContain('Error de almacenamiento local');
      expect(component.mensajeExito).toBe('');

      // Comprobación de que no se permiten cobros offline en este estado
      component.lineasVentaOffline = [{ variante_id: 'var-1', cantidad: 1, precio_bob: 100 }];
      component.efectivoRecibido = 100;
      component.cobrarVentaContado();
      tick();

      expect(cajaServiceSpy.registrarVentaOfflineTransaccional).not.toHaveBeenCalled();
      expect(component.error).toBe('No hay un turno de caja activo para procesar ventas.');
    }));

    it('reintento exitoso de persistencia activa el turno correctamente y limpia la referencia pendiente', fakeAsync(() => {
      // Estado inicial con turno pendiente tras fallo previo
      component.turnoActivo = null;
      component.turnoPendienteRecuperacion = { ...mockTurno };
      component.error = 'Error de almacenamiento previo';

      cajaServiceSpy.guardarTurnoLocal.and.resolveTo();

      component.reintentarPersistenciaTurno();
      tick();

      expect(cajaServiceSpy.guardarTurnoLocal).toHaveBeenCalledWith(jasmine.objectContaining({ turno_id: mockTurno.turno_id }));
      expect(component.turnoActivo as any).toEqual(mockTurno);
      expect(component.turnoPendienteRecuperacion).toBeNull();
      expect(component.mensajeExito).toContain('habilitada exitosamente');
      expect(component.error).toBe('');
    }));

    it('cancelarTurnoPendiente() descarta la referencia transitoria y permite volver a la vista inicial', () => {
      component.turnoPendienteRecuperacion = { ...mockTurno };
      component.error = 'Error previo';

      component.cancelarTurnoPendiente();

      expect(component.turnoPendienteRecuperacion).toBeNull();
      expect(component.error).toBe('');
    });

    it('simulación de recarga/reinicio con turno persistido permite cobrar ventas normalmente', fakeAsync(() => {
      cajaServiceSpy.obtenerTurnoLocal.and.resolveTo(mockTurno);
      cajaServiceSpy.registrarVentaOfflineTransaccional.and.resolveTo();
      cajaServiceSpy.registrarVentaOffline.and.returnValue(of({
        resultado: 'REGISTRADA_CENTRAL',
        operacion_id: 'op-rein-1',
        venta_id: 'vnt-rein-1',
        numero: 'VNT-REIN-001',
        total_bob: 100,
        comprobante_id: 'cmp-rein-1',
        recibida_central_en: '2026-11-04T12:00:00-04:00',
        cupos_restantes: []
      }));

      // Ejecutar carga simulada de inicio
      component.cargarTurnoActivo();
      tick();

      expect(component.turnoActivo).toEqual(mockTurno);
      expect(component.turnoPendienteRecuperacion).toBeNull();

      // Proceder a realizar una venta con el turno restaurado
      component.lineasVentaOffline = [{ variante_id: 'var-1', cantidad: 1, precio_bob: 100 }];
      component.efectivoRecibido = 100;
      component.cambioEntregado = 0;

      component.cobrarVentaContado();
      tick();

      expect(cajaServiceSpy.registrarVentaOfflineTransaccional).toHaveBeenCalled();
      expect(component.comprobanteOffline).toBeDefined();
      expect(component.comprobanteOffline?.total).toBe(100);
    }));

    it('cargarTurnoActivo: si la consulta remota obtiene un turno pero falla la persistencia en IndexedDB, no lo activa en memoria', fakeAsync(() => {
      // 1. Localmente no había turno previo
      cajaServiceSpy.obtenerTurnoLocal.and.resolveTo(null);
      // 2. Servidor tiene un turno
      cajaServiceSpy.consultarTurnoActivo.and.returnValue(of(mockTurno));
      // 3. Fallo de persistencia local
      cajaServiceSpy.guardarTurnoLocal.and.rejectWith(new Error('IndexedDB bloqueado'));

      component.turnoActivo = null;
      component.cargarTurnoActivo();
      tick();

      expect(component.turnoActivo).toBeNull();
      expect(component.turnoPendienteRecuperacion as any).toEqual(mockTurno);
      expect(component.error).toContain('el turno existe en el servidor pero no pudo persistirse');
    }));
  });
});
