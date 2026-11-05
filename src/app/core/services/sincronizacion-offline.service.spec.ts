import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SincronizacionOfflineService } from './sincronizacion-offline.service';
import { OfflineStoreService, OperacionEncolada, ReferenciaHorariaLocal } from './offline-store.service';
import { AuthService } from '../../features/identidad_empresas/services/auth.service';

describe('SincronizacionOfflineService (Protocolo v3 y Resiliencia Offline)', () => {
  let service: SincronizacionOfflineService;
  let httpSpy: jasmine.SpyObj<HttpClient>;
  let offlineStoreSpy: jasmine.SpyObj<OfflineStoreService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const mockUsuario = {
    id: 'usr-offline-1',
    usuario_id: 'usr-offline-1',
    nombre_completo: 'Cliente Offline',
    rol: 'CLIENTE',
    activo: true
  };

  const mockRef: ReferenciaHorariaLocal = {
    referencia_horaria_id: 'ref-hora-123',
    empresa_id: 'emp-1',
    usuario_id: 'usr-offline-1',
    dispositivo_id: 'disp-offline-1',
    valida_hasta: '2026-11-04T20:00:00-04:00',
    tolerancia_segundos: 60,
    politica_version: 1,
    guardada_en: '2026-11-04T12:00:00-04:00'
  };

  beforeEach(() => {
    httpSpy = jasmine.createSpyObj<HttpClient>('HttpClient', ['get', 'post']);
    offlineStoreSpy = jasmine.createSpyObj<OfflineStoreService>('OfflineStoreService', [
      'obtenerReferenciaHorariaVigente',
      'obtenerSiguienteSecuencia',
      'encolarOperacionAtomiaca',
      'actualizarEstadoOperacion',
      'obtenerColaOperaciones',
      'obtenerOperacionPorId'
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', [
      'obtenerUsuarioActual',
      'obtenerEmpresaId'
    ]);

    authServiceSpy.obtenerUsuarioActual.and.returnValue(mockUsuario as any);
    authServiceSpy.obtenerEmpresaId.and.returnValue('emp-1');
    offlineStoreSpy.obtenerReferenciaHorariaVigente.and.resolveTo(mockRef);
    offlineStoreSpy.obtenerSiguienteSecuencia.and.resolveTo(1);
    offlineStoreSpy.encolarOperacionAtomiaca.and.resolveTo();
    offlineStoreSpy.actualizarEstadoOperacion.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        SincronizacionOfflineService,
        { provide: HttpClient, useValue: httpSpy },
        { provide: OfflineStoreService, useValue: offlineStoreSpy },
        { provide: AuthService, useValue: authServiceSpy }
      ]
    });

    service = TestBed.inject(SincronizacionOfflineService);
  });

  describe('Emisión de versión de esquema (v1 vs v3)', () => {
    it('emite version_esquema: 1 cuando SOLICITAR_COMPRA no incluye autorizacion_cobro', async () => {
      const op = await service.registrarCompraOffline({
        sucursal_id: 'suc-1',
        modalidad: 'RECOJO',
        lineas: [{ variante_id: 'v-1', cantidad: 1 }]
      });

      expect(op.tipo).toBe('SOLICITAR_COMPRA');
      expect(op.version_esquema).toBe(1);
      expect(offlineStoreSpy.encolarOperacionAtomiaca).toHaveBeenCalledWith(
        jasmine.objectContaining({ version_esquema: 1 })
      );
    });

    it('emite version_esquema: 3 cuando SOLICITAR_COMPRA incluye autorizacion_cobro', async () => {
      const op = await service.registrarCompraOffline({
        sucursal_id: 'suc-1',
        modalidad: 'RECOJO',
        lineas: [{ variante_id: 'v-1', cantidad: 2 }],
        autorizacion_cobro: {
          consentimiento: true,
          preparacion_pago_id: 'prep-123',
          permite_cobro_al_reconectar: true,
          total_bob: '200.00',
          moneda_cobro: 'USD'
        }
      });

      expect(op.tipo).toBe('SOLICITAR_COMPRA');
      expect(op.version_esquema).toBe(3);
      expect((op.datos as any).autorizacion_cobro).toBeDefined();
      expect(offlineStoreSpy.encolarOperacionAtomiaca).toHaveBeenCalledWith(
        jasmine.objectContaining({
          version_esquema: 3,
          datos: jasmine.objectContaining({
            autorizacion_cobro: jasmine.objectContaining({
              preparacion_pago_id: 'prep-123',
              permite_cobro_al_reconectar: true
            })
          })
        })
      );
    });
  });

  describe('Manejo de respuestas del protocolo v3 en procesarOperacionEncolada', () => {
    const baseOp: OperacionEncolada = {
      operacion_id: 'op-v3-100',
      version_esquema: 3,
      tipo: 'SOLICITAR_COMPRA',
      creada_local_en: '2026-11-04T12:00:00-04:00',
      empresa_id: 'emp-1',
      usuario_id: 'usr-offline-1',
      dispositivo_id: 'disp-1',
      secuencia_local: 1,
      referencia_horaria_id: 'ref-1',
      datos: {
        sucursal_id: 'suc-1',
        modalidad: 'RECOJO',
        lineas: [{ variante_id: 'v-1', cantidad: 1 }],
        autorizacion_cobro: {
          consentimiento: true,
          preparacion_pago_id: 'prep-123'
        }
      },
      estado_envio: 'PENDIENTE_ENVIO',
      intentos: 0,
      actualizado_en: '2026-11-04T12:00:00-04:00'
    };

    it('maneja estado PENDIENTE_INTERVENCION manteniendo la operación en cola durable', async () => {
      httpSpy.post.and.returnValue(of({
        operacion_id: 'op-v3-100',
        estado: 'PENDIENTE_INTERVENCION',
        codigo_resultado: 'REQUIERE_METODO',
        detalle: 'Se requiere registrar método de pago para autorizar cobro.'
      }));

      await service.procesarOperacionEncolada(baseOp);

      expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
        'op-v3-100',
        'PENDIENTE_INTERVENCION',
        jasmine.objectContaining({ estado: 'PENDIENTE_INTERVENCION' }),
        'Se requiere registrar método de pago para autorizar cobro.'
      );
    });

    it('maneja estado REQUIERE_NUEVA_ACEPTACION asignando REQUIERE_ACCION en cola', async () => {
      httpSpy.post.and.returnValue(of({
        operacion_id: 'op-v3-100',
        estado: 'REQUIERE_NUEVA_ACEPTACION',
        codigo_resultado: 'PRECIO_CAMBIADO',
        detalle: 'El precio de las prendas se actualizó en el servidor.'
      }));

      await service.procesarOperacionEncolada(baseOp);

      expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
        'op-v3-100',
        'REQUIERE_ACCION',
        jasmine.objectContaining({ estado: 'REQUIERE_NUEVA_ACEPTACION' }),
        'El precio de las prendas se actualizó en el servidor.'
      );
    });

    it('maneja estado REQUIERE_ACCION_CLIENTE asignando REQUIERE_ACCION en cola para 3DS', async () => {
      httpSpy.post.and.returnValue(of({
        operacion_id: 'op-v3-100',
        estado: 'REQUIERE_ACCION_CLIENTE',
        codigo_resultado: 'REQUIERE_3DS',
        detalle: 'Autenticación 3D Secure requerida por el banco.'
      }));

      await service.procesarOperacionEncolada(baseOp);

      expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
        'op-v3-100',
        'REQUIERE_ACCION',
        jasmine.objectContaining({ estado: 'REQUIERE_ACCION_CLIENTE' }),
        'Autenticación 3D Secure requerida por el banco.'
      );
    });

    it('maneja estado PENDIENTE_PAGO marcando como SINCRONIZADA con detalle de verificación', async () => {
      httpSpy.post.and.returnValue(of({
        operacion_id: 'op-v3-100',
        estado: 'PENDIENTE_PAGO',
        codigo_resultado: 'PAGO_EN_PROCESO',
        detalle: 'Pago en proceso de captura con pasarela central.'
      }));

      await service.procesarOperacionEncolada(baseOp);

      expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
        'op-v3-100',
        'SINCRONIZADA',
        jasmine.objectContaining({ estado: 'PENDIENTE_PAGO' }),
        'Pago en proceso de captura con pasarela central.'
      );
    });

    it('maneja estado ACEPTADA marcando como SINCRONIZADA', async () => {
      httpSpy.post.and.returnValue(of({
        operacion_id: 'op-v3-100',
        estado: 'ACEPTADA',
        codigo_resultado: 'VENTA_REGISTRADA',
        venta_id: 'vnt-100',
        numero: 'VNT-100'
      }));

      await service.procesarOperacionEncolada(baseOp);

      expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
        'op-v3-100',
        'SINCRONIZADA',
        jasmine.objectContaining({ estado: 'ACEPTADA' })
      );
    });

    it('mantiene la operación en PENDIENTE_ENVIO ante falla temporal de red para reintento con mismo UUID', async () => {
      httpSpy.post.and.returnValue(throwError(() => ({ status: 0, message: 'Network disconnected' })));

      try {
        await service.procesarOperacionEncolada(baseOp);
        fail('Debió propagar error');
      } catch {
        expect(offlineStoreSpy.actualizarEstadoOperacion).toHaveBeenCalledWith(
          'op-v3-100',
          'PENDIENTE_ENVIO',
          undefined,
          jasmine.stringMatching(/Conexión interrumpida/)
        );
      }
    });
  });
});
