import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  OfflineStoreService,
  OperacionEncolada,
  OperacionDatosReserva,
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
  private async procesarOperacionEncolada(op: OperacionEncolada): Promise<void> {
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

    const comando = {
      version_esquema: 1,
      operacion_id: op.operacion_id,
      tipo: op.tipo,
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

      // El servidor responde HTTP 200 con resultado durable (ACEPTADA, RECHAZADA, CONFLICTO)
      await this.offlineStore.actualizarEstadoOperacion(
        op.operacion_id,
        'SINCRONIZADA',
        resultado
      );
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
    const usuario = this.authService.obtenerUsuarioActual();
    if (!usuario) return [];
    const empresaId = this.authService.obtenerEmpresaId();
    const usuarioId = usuario.usuario_id || usuario.id;
    return this.offlineStore.obtenerColaOperaciones(empresaId, usuarioId);
  }
}
