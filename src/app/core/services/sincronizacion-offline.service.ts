import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  OfflineStoreService,
  OperacionEncolada,
  OperacionDatosReserva,
  OperacionDatosCompra,
  AutorizacionCobroOfflineDTO,
  ReferenciaHorariaLocal,
  ResultadoOperacionDurable
} from './offline-store.service';
import { AuthService } from '../../features/identidad_empresas/services/auth.service';
import {
  obtenerDispositivoId,
  obtenerHoraBoliviaIso,
  esVentanaPrivacidadValida
} from '../utils/bolivia-time.util';

export interface ResumenSincronizacion {
  total: number;
  sincronizadas: number;
  errores: number;
  pendientes: number;
}

@Injectable({
  providedIn: 'root'
})
export class SincronizacionOfflineService {
  private http = inject(HttpClient);
  private offlineStore = inject(OfflineStoreService);
  private authService = inject(AuthService);

  private readonly api = environment.apiUrl;
  private enLineaSubject = new BehaviorSubject<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  public enLinea$ = this.enLineaSubject.asObservable();

  private sincronizandoSubject = new BehaviorSubject<boolean>(false);
  public sincronizando$ = this.sincronizandoSubject.asObservable();
  private _claveEmisionActiva?: string;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.enLineaSubject.next(true);
        this.sincronizarColaSilenciosa();
      });
      window.addEventListener('offline', () => {
        this.enLineaSubject.next(false);
      });
    }
  }

  get estaEnLinea(): boolean {
    return this.enLineaSubject.value;
  }

  // ==========================================
  // REFERENCIAS HORARIAS (reserva offline)
  // ==========================================

  /**
   * Obtiene y almacena una referencia horaria válida del servidor central.
   * Llama a POST /sincronizacion/referencias-horarias con Idempotency-Key y hora_local_en (-04:00).
   * Con fallback a GET /sincronizacion/referencia-horaria si el POST devuelve 404/405.
   */
  obtenerReferenciaHoraria(forzar = false): Observable<ReferenciaHorariaLocal> {
    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario) {
      return throwError(() => new Error('Debes iniciar sesión para obtener una referencia horaria.'));
    }

    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;
    const dispositivoId = obtenerDispositivoId();

    if (!forzar) {
      // Intentar obtener referencia vigente en IndexedDB
      return new Observable<ReferenciaHorariaLocal>((observer) => {
        this.offlineStore.obtenerReferenciaHorariaVigente(empresaId, usuarioId).then((ref) => {
          if (ref) {
            observer.next(ref);
            observer.complete();
          } else {
            this.solicitarNuevaReferencia(empresaId, usuarioId, dispositivoId).subscribe(observer);
          }
        }).catch(() => {
          this.solicitarNuevaReferencia(empresaId, usuarioId, dispositivoId).subscribe(observer);
        });
      });
    }

    return this.solicitarNuevaReferencia(empresaId, usuarioId, dispositivoId);
  }

  private solicitarNuevaReferencia(
    empresaId: string,
    usuarioId: string,
    dispositivoId: string,
    claveIdempotencia?: string
  ): Observable<ReferenciaHorariaLocal> {
    const key = claveIdempotencia || this._claveEmisionActiva || (this._claveEmisionActiva = crypto.randomUUID());
    const horaLocalEn = obtenerHoraBoliviaIso();
    const headers = new HttpHeaders({
      'Idempotency-Key': key
    });
    const cuerpo = {
      dispositivo_id: dispositivoId,
      hora_local_en: horaLocalEn
    };

    return this.http.post<any>(`${this.api}/sincronizacion/referencias-horarias`, cuerpo, { headers }).pipe(
      catchError((error) => {
        // Fallback a adaptador GET si el endpoint plural no existe aún
        if (error.status === 404 || error.status === 405) {
          return this.http.get<any>(`${this.api}/sincronizacion/referencia-horaria?dispositivo_id=${dispositivoId}`);
        }
        return throwError(() => error);
      }),
      switchMap((resp) => {
        this._claveEmisionActiva = undefined;
        const refLocal: ReferenciaHorariaLocal = {
          referencia_horaria_id: resp.referencia_horaria_id,
          empresa_id: resp.empresa_id || empresaId,
          usuario_id: resp.usuario_id || usuarioId,
          dispositivo_id: resp.dispositivo_id || dispositivoId,
          hora_central_en: resp.hora_central_en,
          valida_hasta: resp.valida_hasta || resp.vence_en,
          tolerancia_segundos: resp.tolerancia_segundos || 300,
          politica_version: resp.politica_version || 1,
          emitida_en: resp.emitida_en,
          guardada_en: obtenerHoraBoliviaIso()
        };

        return new Observable<ReferenciaHorariaLocal>((obs) => {
          this.offlineStore.guardarReferenciaHoraria(refLocal).then(() => {
            obs.next(refLocal);
            obs.complete();
          }).catch((err) => obs.error(err));
        });
      })
    );
  }

  // ==========================================
  // REGISTRO DE RESERVA OFFLINE (reserva offline)
  // ==========================================

  /**
   * Crea y guarda una solicitud de reserva fuera de línea en IndexedDB de forma atómica.
   * Asigna UUID estable, secuencia local y fecha/hora con offset de Bolivia (-04:00).
   */
  async registrarReservaOffline(datos: OperacionDatosReserva): Promise<OperacionEncolada> {
    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario) {
      throw new Error('Debes iniciar sesión para registrar una reserva fuera de línea.');
    }

    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;
    const dispositivoId = obtenerDispositivoId();

    // 1. Obtener referencia horaria vigente localmente o por red
    let ref = await this.offlineStore.obtenerReferenciaHorariaVigente(empresaId, usuarioId);
    if (!ref && this.estaEnLinea) {
      try {
        ref = await new Promise((resolve, reject) => {
          this.obtenerReferenciaHoraria(true).subscribe({ next: resolve, error: reject });
        });
      } catch (e) {
        // Continuar si falla la red
      }
    }

    if (!ref || !ref.referencia_horaria_id) {
      throw new Error(
        'No cuentas con una referencia horaria válida emitida por el servidor central. Conéctate a internet para sincronizar la hora civil antes de registrar nuevas reservas fuera de línea.'
      );
    }

    const referenciaHorariaId = ref.referencia_horaria_id;
    const secuencia = await this.offlineStore.obtenerSiguienteSecuencia(dispositivoId, usuarioId);
    const creadaLocalEn = obtenerHoraBoliviaIso();
    const operacionId = crypto.randomUUID();

    const operacion: OperacionEncolada = {
      operacion_id: operacionId,
      version_esquema: 1,
      tipo: 'SOLICITAR_RESERVA',
      creada_local_en: creadaLocalEn,
      empresa_id: empresaId,
      usuario_id: usuarioId,
      dispositivo_id: dispositivoId,
      secuencia_local: secuencia,
      referencia_horaria_id: referenciaHorariaId,
      datos: {
        sucursal_id: datos.sucursal_id,
        visita_en: datos.visita_en,
        lineas: datos.lineas.map(l => ({
          variante_id: l.variante_id,
          cantidad: Number(l.cantidad)
        }))
      },
      estado_envio: 'PENDIENTE_ENVIO',
      intentos: 0,
      actualizado_en: creadaLocalEn
    };

    // Guardar cabecera, líneas y UUID en una transacción atómica antes de mostrar PENDIENTE_ENVIO
    await this.offlineStore.encolarOperacionAtomiaca(operacion);

    return operacion;
  }

  // ==========================================
  // REGISTRO DE COMPRA OFFLINE v3 (compra offline)
  // ==========================================

  /**
   * Crea y guarda una orden de compra durable fuera de línea en IndexedDB con autorización de cobro.
   * Si incluye autorización de cobro, emite version_esquema: 3 conforme al protocolo v3.
   * Asigna UUID estable, secuencia local y fecha/hora con offset de Bolivia (-04:00).
   */
  async registrarCompraOffline(datos: OperacionDatosCompra): Promise<OperacionEncolada> {
    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario) {
      throw new Error('Debes iniciar sesión para registrar una compra fuera de línea.');
    }

    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;
    const dispositivoId = obtenerDispositivoId();

    let ref = await this.offlineStore.obtenerReferenciaHorariaVigente(empresaId, usuarioId);
    if (!ref && this.estaEnLinea) {
      try {
        ref = await new Promise((resolve, reject) => {
          this.obtenerReferenciaHoraria(true).subscribe({ next: resolve, error: reject });
        });
      } catch {
        // Continuar si falla la red
      }
    }

    if (!ref || !ref.referencia_horaria_id) {
      throw new Error(
        'No cuentas con una referencia horaria válida emitida por el servidor central. Conéctate a internet para sincronizar la hora civil antes de registrar nuevas compras fuera de línea.'
      );
    }

    const secuencia = await this.offlineStore.obtenerSiguienteSecuencia(dispositivoId, usuarioId);
    const creadaLocalEn = obtenerHoraBoliviaIso();
    const operacionId = crypto.randomUUID();

    const tieneAutorizacion = !!datos.autorizacion_cobro && (
      datos.autorizacion_cobro.consentimiento !== undefined ||
      !!datos.autorizacion_cobro.metodo_preparado_id ||
      !!datos.autorizacion_cobro.preparacion_pago_id ||
      !!datos.autorizacion_cobro.consentimiento_id
    );
    const versionEsquema = tieneAutorizacion ? 3 : 1;

    const autorizacionCobroData = datos.autorizacion_cobro
      ? {
          consentimiento: !!datos.autorizacion_cobro.consentimiento,
          metodo_preparado_id: datos.autorizacion_cobro.metodo_preparado_id || datos.autorizacion_cobro.preparacion_pago_id,
          huella_dispositivo: datos.autorizacion_cobro.huella_dispositivo || dispositivoId,
          ...(datos.autorizacion_cobro.consentimiento_id ? { consentimiento_id: datos.autorizacion_cobro.consentimiento_id } : {}),
          ...(datos.autorizacion_cobro.aceptado_local_en ? { aceptado_local_en: datos.autorizacion_cobro.aceptado_local_en } : {}),
          ...(datos.autorizacion_cobro.huella_compra ? { huella_compra: datos.autorizacion_cobro.huella_compra } : {}),
          ...(datos.autorizacion_cobro.base_bob ? { base_bob: datos.autorizacion_cobro.base_bob } : {}),
          ...(datos.autorizacion_cobro.descuento_bob ? { descuento_bob: datos.autorizacion_cobro.descuento_bob } : {}),
          ...(datos.autorizacion_cobro.envio_bob ? { envio_bob: datos.autorizacion_cobro.envio_bob } : {}),
          ...(datos.autorizacion_cobro.total_bob ? { total_bob: datos.autorizacion_cobro.total_bob } : {}),
          ...(datos.autorizacion_cobro.moneda_cobro ? { moneda_cobro: datos.autorizacion_cobro.moneda_cobro } : {}),
          ...(datos.autorizacion_cobro.importe_cobro ? { importe_cobro: datos.autorizacion_cobro.importe_cobro } : {}),
          ...(datos.autorizacion_cobro.tasa_id ? { tasa_id: datos.autorizacion_cobro.tasa_id } : {}),
          ...(datos.autorizacion_cobro.tasa_bob_por_usd ? { tasa_bob_por_usd: datos.autorizacion_cobro.tasa_bob_por_usd } : {}),
          ...(datos.autorizacion_cobro.condiciones_version ? { condiciones_version: datos.autorizacion_cobro.condiciones_version } : {}),
          ...(datos.autorizacion_cobro.vigente_hasta ? { vigente_hasta: datos.autorizacion_cobro.vigente_hasta } : {}),
          ...(datos.autorizacion_cobro.preparacion_pago_id ? { preparacion_pago_id: datos.autorizacion_cobro.preparacion_pago_id } : {}),
          permite_cobro_al_reconectar: datos.autorizacion_cobro.permite_cobro_al_reconectar !== false
        }
      : undefined;

    const operacion: OperacionEncolada = {
      operacion_id: operacionId,
      version_esquema: versionEsquema,
      tipo: 'SOLICITAR_COMPRA',
      creada_local_en: creadaLocalEn,
      empresa_id: empresaId,
      usuario_id: usuarioId,
      dispositivo_id: dispositivoId,
      secuencia_local: secuencia,
      referencia_horaria_id: ref.referencia_horaria_id,
      datos: {
        sucursal_id: datos.sucursal_id,
        modalidad: datos.modalidad,
        direccion: datos.direccion,
        anillo_destino: datos.anillo_destino,
        lineas: datos.lineas.map(l => ({
          variante_id: l.variante_id,
          cantidad: Number(l.cantidad),
          ...((l as any).precio_visto_bob ? { precio_visto_bob: (l as any).precio_visto_bob } : {})
        })),
        ...(autorizacionCobroData ? { autorizacion_cobro: autorizacionCobroData } : {})
      },
      estado_envio: 'PENDIENTE_ENVIO',
      intentos: 0,
      actualizado_en: creadaLocalEn
    };

    await this.offlineStore.encolarOperacionAtomiaca(operacion);
    return operacion;
  }

  // ==========================================
  // SINCRONIZACIÓN DE LA COLA (reserva offline)
  // ==========================================

  /**
   * Sincroniza todas las operaciones pendientes de la cuenta activa.
   * Respeta la ventana de privacidad de 8 horas y el orden de decisión central.
   */
  async sincronizarCola(): Promise<ResumenSincronizacion> {
    if (this.sincronizandoSubject.value) {
      return { total: 0, sincronizadas: 0, errores: 0, pendientes: 0 };
    }

    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario || !this.estaEnLinea || !esVentanaPrivacidadValida()) {
      return { total: 0, sincronizadas: 0, errores: 0, pendientes: 0 };
    }

    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;

    this.sincronizandoSubject.next(true);

    try {
      const cola = await this.offlineStore.obtenerColaOperaciones(empresaId, usuarioId);
      const pendientes = cola.filter(op => op.estado_envio === 'PENDIENTE_ENVIO' || op.estado_envio === 'ENVIANDO');

      let sincronizadas = 0;
      let errores = 0;

      for (const op of pendientes) {
        try {
          await this.procesarOperacionEncolada(op);
          sincronizadas++;
        } catch (e) {
          errores++;
        }
      }

      return {
        total: pendientes.length,
        sincronizadas,
        errores,
        pendientes: pendientes.length - sincronizadas - errores
      };
    } finally {
      this.sincronizandoSubject.next(false);
    }
  }

  /**
   * Sincronización silenciosa al recuperar conexión
   */
  private async sincronizarColaSilenciosa(): Promise<void> {
    if (!this.estaEnLinea || !this.authService.estaAutenticado() || !esVentanaPrivacidadValida()) {
      return;
    }
    try {
      await this.sincronizarCola();
    } catch {
      // Silenciar errores en sincronización de fondo
    }
  }

  /**
   * Procesa una única operación encolada garantizando la idempotencia por operacion_id.
   * Si quedó en ENVIANDO, primero consulta por UUID para verificar si ya fue procesada.
   */
  async procesarOperacionEncolada(op: OperacionEncolada): Promise<void> {
    // Si la operación quedó en ENVIANDO (por recarga, reinicio o corte de red):
    if (op.estado_envio === 'ENVIANDO') {
      try {
        const resultadoPrevio = await this.consultarOperacionPorId(op.operacion_id);
        if (resultadoPrevio) {
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'SINCRONIZADA',
            resultadoPrevio
          );
          return;
        }
      } catch (err: any) {
        // Si responde 404 es porque aún no fue recibida por el servidor, procedemos al envío
        if (err.status !== 404) {
          // Error de red, conservar pendiente
          throw err;
        }
      }
    }

    // Marcar como ENVIANDO antes de emitir la llamada
    await this.offlineStore.actualizarEstadoOperacion(op.operacion_id, 'ENVIANDO');

    const tieneAutorizacion = !!(op.datos as any)?.autorizacion_cobro && (
      (op.datos as any).autorizacion_cobro.consentimiento !== undefined ||
      !!(op.datos as any).autorizacion_cobro.metodo_preparado_id ||
      !!(op.datos as any).autorizacion_cobro.preparacion_pago_id ||
      !!(op.datos as any).autorizacion_cobro.consentimiento_id
    );

    const versionEsquema = op.version_esquema === 3 || (op.tipo === 'SOLICITAR_COMPRA' && tieneAutorizacion)
      ? 3
      : (op.version_esquema || 1);

    const comando = {
      version_esquema: versionEsquema,
      operacion_id: op.operacion_id,
      tipo: op.tipo,
      tipo_operacion: op.tipo,
      creada_local_en: op.creada_local_en,
      empresa_id: op.empresa_id,
      usuario_id: op.usuario_id,
      dispositivo_id: op.dispositivo_id,
      secuencia_local: op.secuencia_local,
      referencia_horaria_id: op.referencia_horaria_id,
      datos: op.datos
    };

    try {
      const resultado = await new Promise<ResultadoOperacionDurable>((resolve, reject) => {
        this.http.post<ResultadoOperacionDurable>(`${this.api}/sincronizacion/operaciones`, comando).subscribe({
          next: resolve,
          error: reject
        });
      });

      // Manejo estricto de las respuestas del protocolo v3:
      // PENDIENTE_INTERVENCION, REQUIERE_NUEVA_ACEPTACION, REQUIERE_ACCION_CLIENTE, PENDIENTE_PAGO, ACEPTADA
      switch (resultado.estado) {
        case 'ACEPTADA':
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'SINCRONIZADA',
            resultado
          );
          break;

        case 'PENDIENTE_INTERVENCION':
          // Solicitud guardada en servidor; requiere autorización de cobro o método preparado
          // Se conserva en cola durable sin descartarla para permitir la intervención del cliente
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'PENDIENTE_INTERVENCION',
            resultado,
            resultado.detalle || 'Solicitud guardada en servidor; requiere autorización y método preparado para cobro.'
          );
          break;

        case 'REQUIERE_NUEVA_ACEPTACION':
          // Cambio en la oferta (precio actualizado, tasa de cambio o condiciones de compra)
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'REQUIERE_ACCION',
            resultado,
            resultado.detalle || 'La cotización o condiciones cambiaron; requiere nueva aceptación del cliente.'
          );
          break;

        case 'REQUIERE_ACCION_CLIENTE':
          // Autenticación bancaria 3DS requerida
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'REQUIERE_ACCION',
            resultado,
            resultado.detalle || 'Requiere validación de identidad o autenticación bancaria adicional (3D Secure).'
          );
          break;

        case 'PENDIENTE_PAGO':
          // Pago en verificación con pasarela central / esperando confirmación webhook
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'SINCRONIZADA',
            resultado,
            resultado.detalle || 'Pago en verificación con pasarela central.'
          );
          break;

        default:
          await this.offlineStore.actualizarEstadoOperacion(
            op.operacion_id,
            'SINCRONIZADA',
            resultado
          );
          break;
      }
    } catch (error: any) {
      if (error.status === 409) {
        // Conflicto de operación modificada u otro rechazo no reintentable
        const detalleError = error.error?.detail?.detalle || 'La operación presenta un conflicto con el servidor.';
        await this.offlineStore.actualizarEstadoOperacion(
          op.operacion_id,
          'ERROR',
          undefined,
          detalleError
        );
      } else {
        // Falla de red temporal o 503: mantener en PENDIENTE_ENVIO para reintento con el mismo UUID
        await this.offlineStore.actualizarEstadoOperacion(
          op.operacion_id,
          'PENDIENTE_ENVIO',
          undefined,
          'Conexión interrumpida durante el envío. Se reintentará al recuperar la red.'
        );
      }
      throw error;
    }
  }

  /**
   * Consulta el resultado durable de una operación por UUID en el servidor central.
   */
  private consultarOperacionPorId(operacionId: string): Promise<ResultadoOperacionDurable | null> {
    return new Promise((resolve, reject) => {
      this.http.get<ResultadoOperacionDurable>(`${this.api}/sincronizacion/operaciones/${operacionId}`).subscribe({
        next: (res) => resolve(res),
        error: (err) => {
          if (err.status === 404) {
            resolve(null);
          } else {
            reject(err);
          }
        }
      });
    });
  }

  /**
   * Consulta las reservas locales en cola para la interfaz de usuario.
   */
  async listarReservasLocales(): Promise<OperacionEncolada[]> {
    const list = await this.listarOperacionesLocales();
    return list.filter(op => op.tipo === 'SOLICITAR_RESERVA');
  }

  /**
   * Consulta las compras offline locales en cola para la interfaz de usuario.
   */
  async listarComprasLocales(): Promise<OperacionEncolada[]> {
    const list = await this.listarOperacionesLocales();
    return list.filter(op => op.tipo === 'SOLICITAR_COMPRA');
  }

  /**
   * Consulta todas las operaciones locales de la cuenta activa.
   */
  async listarOperacionesLocales(): Promise<OperacionEncolada[]> {
    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario) return [];
    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;
    return this.offlineStore.obtenerColaOperaciones(empresaId, usuarioId);
  }

  /**
   * Continúa una solicitud que quedó en PENDIENTE_INTERVENCION o REQUIERE_ACCION
   * adjuntando la autorización de cobro/método preparado o nueva aceptación de cotización v3,
   * y reencolándola de forma durable para sincronización sin perder la solicitud original.
   */
  async continuarOperacionConAutorizacion(
    operacionId: string,
    autorizacion: AutorizacionCobroOfflineDTO
  ): Promise<OperacionEncolada> {
    const op = await this.offlineStore.obtenerOperacionPorId(operacionId);
    if (!op) {
      throw new Error(`Operación ${operacionId} no encontrada en la cola local.`);
    }

    const datosCompra = { ...(op.datos as OperacionDatosCompra) };
    datosCompra.autorizacion_cobro = {
      ...(datosCompra.autorizacion_cobro || {}),
      ...autorizacion,
      consentimiento: autorizacion.consentimiento !== false
    };

    op.datos = datosCompra;
    op.version_esquema = 3;
    op.estado_envio = 'PENDIENTE_ENVIO';
    op.actualizado_en = obtenerHoraBoliviaIso();

    await this.offlineStore.encolarOperacionAtomiaca(op);

    if (this.estaEnLinea) {
      this.sincronizarColaSilenciosa();
    }
    return op;
  }

  /**
   * Actualiza el estado local de una operación consultando su estado durable central por operacion_id.
   */
  async actualizarEstadoDesdeServidor(operacionId: string): Promise<ResultadoOperacionDurable | null> {
    try {
      const res = await this.consultarOperacionPorId(operacionId);
      if (res) {
        let nuevoEstadoEnvio: import('./offline-store.service').EstadoEnvio = 'SINCRONIZADA';
        if (res.estado === 'PENDIENTE_INTERVENCION') {
          nuevoEstadoEnvio = 'PENDIENTE_INTERVENCION';
        } else if (res.estado === 'REQUIERE_NUEVA_ACEPTACION' || res.estado === 'REQUIERE_ACCION_CLIENTE') {
          nuevoEstadoEnvio = 'REQUIERE_ACCION';
        }

        await this.offlineStore.actualizarEstadoOperacion(
          operacionId,
          nuevoEstadoEnvio,
          res,
          res.detalle
        );
      }
      return res;
    } catch {
      return null;
    }
  }
}
