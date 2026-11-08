import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { cabeceraIdempotencia } from '../../../core/utils/solicitud-http.util';

export interface CupoItem {
  variante_id: string;
  cantidad: number;
}

export interface TurnoCrear {
  caja_id: string;
  dispositivo_id: string; // UUID v4 obligatorio para evitar error 422
  sucursal_id: string;
  cupos: CupoItem[];
  revision: number;
}

export interface CupoRespuesta {
  variante_id: string;
  sku?: string;
  producto_nombre?: string;
  otorgado: number;
  consumido: number;
  liberado: number;
  precio_autorizado_bob: number;
}

export interface TurnoHabilitacion {
  turno_id: string;
  habilitacion_id: string;
  caja_codigo: string;
  dispositivo_id: string; // UUID v4
  sucursal_id: string;
  cajero_id: string;
  estado: string;
  inicio_en: string;
  vence_en: string;
  version_precios: string;
  revision: number;
  cupos: CupoRespuesta[];
  snapshot?: any;
  ultima_secuencia_local?: number;
  total_operaciones_locales?: number;
}

export interface VentaOfflineLinea {
  variante_id: string;
  cantidad: number;
  precio_autorizado_bob: number;
}

export interface VentaOfflineCrear {
  operacion_id: string; // UUID v4 de idempotencia
  secuencia_local: number;
  vendida_local_en: string;
  entregada_local_en: string;
  version_precios: string;
  lineas: VentaOfflineLinea[];
  total_bob: number;
  efectivo_recibido_bob: number;
  cambio_entregado_bob: number;
  cliente_id?: string;
}

export interface VentaOfflineResultado {
  resultado: string;
  operacion_id: string;
  venta_id: string;
  numero: string;
  total_bob: number;
  comprobante_id: string;
  recibida_central_en: string;
  cupos_restantes: any[];
}

export interface TurnoCerrar {
  revision: number;
  ultima_secuencia_local?: number;
  total_operaciones_locales?: number;
  operaciones_pendientes?: string[];
  arqueo_efectivo_bob?: number;
  arqueo_declarado_bob?: number;
  supervision_forzada?: boolean;
  motivo_supervision?: string;
  descarte_venta_fisica?: boolean;
  evidencia_cierre?: {
    referencia_acta: string;
    conteo_fisico_por_variante: { variante_id: string; cantidad_encontrada: number }[];
  };
  ajustes_inventario?: {
    resoluciones_por_variante: {
      variante_id: string;
      resolucion: 'PENDIENTE_SINCRONIZACION' | 'MERMA';
      motivo: string;
    }[];
  };
}

export interface TurnoCerrado {
  turno_id: string;
  estado: string;
  cerrado_en: string | null;
  revision: number;
  cupos_devueltos: any[];
  cupos_retenidos?: { variante_id: string; retenido: number }[];
}

export interface TurnoRecuperar {
  revision: number;
  motivo: string;
  evidencia?: string;
}

export interface ComprobanteCajaOffline {
  operacion_id: string;
  numero: string;
  fecha: string;
  lineas: { sku: string; cantidad: number; subtotal: number }[];
  total: number;
  efectivo: number;
  cambio: number;
  esOffline: boolean;
}

export const CLAVE_DISPOSITIVO = 'fs_dispositivo_id';
export const CLAVE_TURNO_LOCAL = 'fs_turno_caja_activo';
export const CLAVE_VENTAS_OFFLINE = 'fs_ventas_offline_pendientes';
export const CLAVE_COMPROBANTES_LOCAL = 'fs_comprobantes_caja_locales';

const DB_CAJA_NOMBRE = 'FashionStoreCajaDB';
const DB_CAJA_VERSION = 1;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generarUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly api = environment.apiUrl;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private turnoActivoCache: TurnoHabilitacion | null = null;
  private migracionCompletada = false;

  constructor(private http: HttpClient) {}

  habilitarTurno(dto: TurnoCrear): Observable<TurnoHabilitacion> {
    return this.http.post<TurnoHabilitacion>(
      `${this.api}/cajas/turnos`,
      dto,
      { headers: cabeceraIdempotencia() }
    );
  }

  consultarTurnoActivo(dispositivoId?: string): Observable<TurnoHabilitacion | null> {
    const params = dispositivoId ? `?dispositivo_id=${dispositivoId}` : '';
    return this.http.get<TurnoHabilitacion | null>(`${this.api}/cajas/turnos/activo${params}`);
  }

  consultarTurno(turnoId: string): Observable<TurnoHabilitacion> {
    return this.http.get<TurnoHabilitacion>(`${this.api}/cajas/turnos/${turnoId}`);
  }

  registrarVentaOffline(turnoId: string, dto: VentaOfflineCrear): Observable<VentaOfflineResultado> {
    return this.http.post<VentaOfflineResultado>(
      `${this.api}/cajas/turnos/${turnoId}/ventas`,
      dto
    );
  }

  cerrarTurno(turnoId: string, dto: TurnoCerrar): Observable<TurnoCerrado> {
    return this.http.post<TurnoCerrado>(
      `${this.api}/cajas/turnos/${turnoId}/cerrar`,
      dto
    );
  }

  recuperarTurno(turnoId: string, dto: TurnoRecuperar): Observable<any> {
    return this.http.post<any>(
      `${this.api}/cajas/turnos/${turnoId}/recuperar`,
      dto
    );
  }

  // =========================================================================
  // IDENTIFICADOR DE DISPOSITIVO CON FORMATO UUID v4
  // =========================================================================

  obtenerDispositivoId(): string {
    let id: string | null = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        id = localStorage.getItem(CLAVE_DISPOSITIVO);
      } catch {}
    }

    if (id && UUID_V4_REGEX.test(id)) {
      return id;
    }

    const nuevoUuid = generarUuidV4();

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(CLAVE_DISPOSITIVO, nuevoUuid);
      } catch {}
    }

    return nuevoUuid;
  }

  // =========================================================================
  // PERSISTENCIA TRANSACCIONAL CANÓNICA CON INDEXEDDB
  // =========================================================================

  esIndexedDbDisponible(): boolean {
    return typeof window !== 'undefined' && !!window.indexedDB;
  }

  abrirBd(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise.then(async db => {
        await this.asegurarMigracion(db);
        return db;
      });
    }

    if (!this.esIndexedDbDisponible()) {
      return Promise.reject(new Error('Almacenamiento transaccional no disponible en este dispositivo.'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = window.indexedDB.open(DB_CAJA_NOMBRE, DB_CAJA_VERSION);

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('turnos')) {
          db.createObjectStore('turnos', { keyPath: 'turno_id' });
        }
        if (!db.objectStoreNames.contains('ventas_offline')) {
          db.createObjectStore('ventas_offline', { keyPath: 'operacion_id' });
        }
        if (!db.objectStoreNames.contains('comprobantes')) {
          db.createObjectStore('comprobantes', { keyPath: 'operacion_id' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise.then(async db => {
      await this.asegurarMigracion(db);
      return db;
    });
  }

  /**
   * Migra atómicamente datos previos existentes en almacenamiento temporal antiguo
   * a la base de datos transaccional canónica de IndexedDB una sola vez.
   */
  private async asegurarMigracion(db: IDBDatabase): Promise<void> {
    if (this.migracionCompletada) return;
    if (typeof window === 'undefined' || !window.localStorage) {
      this.migracionCompletada = true;
      return;
    }

    let turnoRaw: string | null = null;
    let ventasRaw: string | null = null;
    let comprobantesRaw: string | null = null;

    try {
      turnoRaw = localStorage.getItem(CLAVE_TURNO_LOCAL);
      ventasRaw = localStorage.getItem(CLAVE_VENTAS_OFFLINE);
      comprobantesRaw = localStorage.getItem(CLAVE_COMPROBANTES_LOCAL);
    } catch {
      this.migracionCompletada = true;
      return;
    }

    if (!turnoRaw && !ventasRaw && !comprobantesRaw) {
      this.migracionCompletada = true;
      return;
    }

    let turno: TurnoHabilitacion | null = null;
    let ventas: VentaOfflineCrear[] = [];
    let comprobantes: any[] = [];

    try {
      if (turnoRaw) turno = JSON.parse(turnoRaw);
    } catch {}
    try {
      if (ventasRaw) ventas = JSON.parse(ventasRaw);
    } catch {}
    try {
      if (comprobantesRaw) comprobantes = JSON.parse(comprobantesRaw);
    } catch {}

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['turnos', 'ventas_offline', 'comprobantes'], 'readwrite');
        tx.oncomplete = () => {
          try {
            localStorage.removeItem(CLAVE_TURNO_LOCAL);
            localStorage.removeItem(CLAVE_VENTAS_OFFLINE);
            localStorage.removeItem(CLAVE_COMPROBANTES_LOCAL);
          } catch {}
          this.migracionCompletada = true;
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Migración abortada'));

        const storeTurnos = tx.objectStore('turnos');
        const storeVentas = tx.objectStore('ventas_offline');
        const storeComprobantes = tx.objectStore('comprobantes');

        if (turno && turno.turno_id) {
          storeTurnos.put(turno);
        }
        if (Array.isArray(ventas)) {
          for (const v of ventas) {
            if (v && v.operacion_id) {
              storeVentas.put(v);
            }
          }
        }
        if (Array.isArray(comprobantes)) {
          for (const c of comprobantes) {
            if (c && c.operacion_id) {
              storeComprobantes.put(c);
            }
          }
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Persistencia atómica de la venta física en la base de datos transaccional canónica.
   * Modifica simultáneamente el turno/cupos, encola la venta física y genera el comprobante
   * dentro de una única transacción ACID. Si falla la transacción, se rechaza y no se emite comprobante.
   */
  async registrarVentaOfflineTransaccional(
    turno: TurnoHabilitacion,
    venta: VentaOfflineCrear,
    comprobante?: ComprobanteCajaOffline | any
  ): Promise<void> {
    if (!turno || !turno.turno_id) {
      throw new Error('No se puede persistir la venta: turno inválido o ausente.');
    }
    if (!venta || !venta.operacion_id) {
      throw new Error('No se puede persistir la venta: datos de venta inválidos o sin identificador de operación.');
    }

    if (!this.esIndexedDbDisponible()) {
      throw new Error('Fallo de persistencia local: almacenamiento transaccional no disponible.');
    }

    const db = await this.abrirBd();

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['turnos', 'ventas_offline', 'comprobantes'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Error en la transacción transaccional.'));
        tx.onabort = () => reject(tx.error || new Error('Transacción transaccional abortada.'));

        const storeTurnos = tx.objectStore('turnos');
        const storeVentas = tx.objectStore('ventas_offline');
        const storeComprobantes = tx.objectStore('comprobantes');

        storeTurnos.put(turno);
        storeVentas.put(venta);
        if (comprobante) {
          storeComprobantes.put({ operacion_id: venta.operacion_id, ...comprobante });
        }
      } catch (err) {
        reject(err);
      }
    });

    this.turnoActivoCache = turno;
  }

  // --- Operaciones de Turno Local en IndexedDB ---

  async guardarTurnoLocal(turno: TurnoHabilitacion): Promise<void> {
    if (!turno || !turno.turno_id) {
      throw new Error('Turno inválido para persistir en almacenamiento local.');
    }

    if (!this.esIndexedDbDisponible()) {
      throw new Error('IndexedDB no disponible para persistir el turno de caja');
    }

    const db = await this.abrirBd();
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['turnos'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Error al escribir el turno en IndexedDB.'));
        tx.onabort = () => reject(tx.error || new Error('Transacción de turno abortada en IndexedDB.'));
        tx.objectStore('turnos').put(turno);
      } catch (err) {
        reject(err);
      }
    });

    this.turnoActivoCache = turno;
  }

  async obtenerTurnoLocal(): Promise<TurnoHabilitacion | null> {
    if (!this.esIndexedDbDisponible()) {
      this.turnoActivoCache = null;
      return null;
    }

    const db = await this.abrirBd();
    return new Promise<TurnoHabilitacion | null>((resolve, reject) => {
      try {
        const tx = db.transaction(['turnos'], 'readonly');
        const store = tx.objectStore('turnos');
        const req = store.getAll();
        req.onsuccess = () => {
          const turnos = req.result as TurnoHabilitacion[];
          if (!turnos || turnos.length === 0) {
            this.turnoActivoCache = null;
            resolve(null);
            return;
          }
          const activo = turnos.find(t => t.estado === 'ABIERTO' || t.estado === 'CONCILIACION') || turnos[turnos.length - 1];
          this.turnoActivoCache = activo;
          resolve(activo);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  obtenerTurnoLocalSincrono(): TurnoHabilitacion | null {
    return this.turnoActivoCache;
  }

  async limpiarTurnoLocal(): Promise<void> {
    this.turnoActivoCache = null;
    if (!this.esIndexedDbDisponible()) return;

    const db = await this.abrirBd();
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['turnos'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('turnos').clear();
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Operaciones de Ventas Offline Pendientes en IndexedDB ---

  async guardarVentaOfflinePendiente(venta: VentaOfflineCrear): Promise<void> {
    if (!venta || !venta.operacion_id) return;
    if (!this.esIndexedDbDisponible()) return;

    const db = await this.abrirBd();
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['ventas_offline'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('ventas_offline').put(venta);
      } catch (err) {
        reject(err);
      }
    });
  }

  async obtenerVentasOfflinePendientes(): Promise<VentaOfflineCrear[]> {
    if (!this.esIndexedDbDisponible()) {
      return [];
    }

    const db = await this.abrirBd();
    return new Promise<VentaOfflineCrear[]>((resolve, reject) => {
      try {
        const tx = db.transaction(['ventas_offline'], 'readonly');
        const req = tx.objectStore('ventas_offline').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async eliminarVentaOfflinePendiente(operacionId: string): Promise<void> {
    if (!operacionId || !this.esIndexedDbDisponible()) return;

    const db = await this.abrirBd();
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['ventas_offline'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('ventas_offline').delete(operacionId);
      } catch (err) {
        reject(err);
      }
    });
  }

  removerVentaOfflinePendiente(operacionId: string): Promise<void> {
    return this.eliminarVentaOfflinePendiente(operacionId);
  }

  // --- Operaciones de Comprobantes Locales en IndexedDB ---

  async guardarComprobanteLocal(comprobante: any): Promise<void> {
    if (!comprobante || !comprobante.operacion_id || !this.esIndexedDbDisponible()) return;

    const db = await this.abrirBd();
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['comprobantes'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('comprobantes').put(comprobante);
      } catch (err) {
        reject(err);
      }
    });
  }

  async obtenerComprobantesLocales(): Promise<ComprobanteCajaOffline[]> {
    if (!this.esIndexedDbDisponible()) {
      return [];
    }

    const db = await this.abrirBd();
    return new Promise<ComprobanteCajaOffline[]>((resolve, reject) => {
      try {
        const tx = db.transaction(['comprobantes'], 'readonly');
        const req = tx.objectStore('comprobantes').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Utilidades para Pruebas y Limpieza ---

  resetearMigracionParaPruebas(): void {
    this.migracionCompletada = false;
  }

  async cerrarBd(): Promise<void> {
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        db.close();
      } catch {}
      this.dbPromise = null;
    }
  }

  async limpiarTodaBd(): Promise<void> {
    this.turnoActivoCache = null;
    this.migracionCompletada = false;
    await this.cerrarBd();
    if (this.esIndexedDbDisponible()) {
      await new Promise<void>((resolve, reject) => {
        const req = window.indexedDB.deleteDatabase(DB_CAJA_NOMBRE);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    }
  }
}
