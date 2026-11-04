import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ReservaTrasladoService } from '../../reservas_traslados/services/reserva-traslado.service';
import { VentaPresencialService } from '../services/venta-presencial.service';
import {
  CajaService,
  TurnoHabilitacion,
  CupoRespuesta,
  VentaOfflineCrear,
  ComprobanteCajaOffline
} from '../services/caja.service';
import { AuthService } from '../../identidad_empresas/services/auth.service';
import { ProductoService } from '../../catalogo/services/producto.service';
import { Reserva } from '../../reservas_traslados/models/reserva-traslado.models';
import { Comprobante, ItemVenta, MetodoCaja } from '../models/venta-presencial.models';
import { VarianteDTO } from '../../catalogo/models/catalogo.models';
import { formatearErrorApi } from '../../../core/utils/error-handler.util';

@Component({
  selector: 'app-caja',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './caja.component.html',
  styleUrls: ['./caja.component.css']
})
export class CajaComponent implements OnInit {
  readonly Math = Math;
  // Modalidad de operación: 'RESERVA' o 'TURNO_OFFLINE'
  vistaModo: 'RESERVA' | 'TURNO_OFFLINE' = 'TURNO_OFFLINE';

  // Datos comunes
  variantes: VarianteDTO[] = [];
  cargando = false;
  procesando = false;
  error = '';
  mensajeExito = '';

  // Modo Venta Online / Reserva (Online)
  codigo = '';
  reserva?: Reserva;
  items: ItemVenta[] = [];
  variante = '';
  cantidad = 1;
  metodo: MetodoCaja = 'EFECTIVO';
  comprobante?: Comprobante;

  // Modo Turno y Caja Offline
  turnoActivo: TurnoHabilitacion | null = null;
  turnoPendienteRecuperacion: TurnoHabilitacion | null = null;
  cajaId = 'CAJA-01';
  dispositivoId = '';
  cupoVarianteSeleccionada = '';
  cupoCantidadSolicitada = 1;
  cuposSolicitados: { variante_id: string; cantidad: number }[] = [];

  // Venta Contado Offline
  lineasVentaOffline: { variante_id: string; cantidad: number; precio_bob: number }[] = [];
  varianteVentaOffline = '';
  cantidadVentaOffline = 1;
  efectivoRecibido = 0;
  cambioEntregado = 0;
  ventasPendientesSync = 0;
  comprobanteOffline?: ComprobanteCajaOffline;
  operacionIdActual: string | null = null;

  // Cierre de Turno y Arqueo
  mostrarDialogoCierre = false;
  cierreSupervisado = false;
  arqueoEfectivoBob = 0;
  motivoSupervision = '';
  referenciaActa = '';
  conteoFisicoPorVariante: Record<string, number | null> = {};
  resolucionFaltantePorVariante: Record<string, 'PENDIENTE_SINCRONIZACION' | 'MERMA'> = {};
  motivoFaltantePorVariante: Record<string, string> = {};

  constructor(
    private api: VentaPresencialService,
    private cajaService: CajaService,
    private reservas: ReservaTrasladoService,
    public auth: AuthService,
    private productos: ProductoService
  ) {}

  async ngOnInit() {
    this.dispositivoId = this.cajaService.obtenerDispositivoId();
    this.cargarVariantes();
    await this.cargarTurnoActivo();
    await this.actualizarContadorPendientes();
  }

  cargarVariantes() {
    this.productos.gestionarVariantes().subscribe({
      next: v => this.variantes = v,
      error: e => this.error = this.msg(e)
    });
  }

  async cargarTurnoActivo() {
    // 1. Verificar primero en almacenamiento transaccional local canónico
    try {
      const turnoLocal = await this.cajaService.obtenerTurnoLocal();
      if (turnoLocal && (turnoLocal.estado === 'ABIERTO' || turnoLocal.estado === 'CONCILIACION')) {
        this.turnoActivo = turnoLocal;
      }
    } catch {
      this.turnoActivo = null;
    }

    // 2. Consultar al servidor si hay conexión disponible
    if (navigator.onLine) {
      this.cajaService.consultarTurnoActivo(this.dispositivoId).subscribe({
        next: async t => {
          if (t && (t.estado === 'ABIERTO' || t.estado === 'CONCILIACION')) {
            if (this.turnoActivo && this.turnoActivo.turno_id === t.turno_id) {
              t.ultima_secuencia_local = this.turnoActivo.ultima_secuencia_local ?? 0;
              t.total_operaciones_locales = this.turnoActivo.total_operaciones_locales ?? 0;
            }
            try {
              await this.cajaService.guardarTurnoLocal(t);
              this.turnoActivo = t;
              this.turnoPendienteRecuperacion = null;
            } catch {
              if (!this.turnoActivo) {
                this.turnoPendienteRecuperacion = t;
                this.error = 'Alerta de almacenamiento local: el turno existe en el servidor pero no pudo persistirse en este dispositivo. Reintente la persistencia antes de operar.';
              }
            }
          } else if (!t) {
            try {
              await this.cajaService.limpiarTurnoLocal();
            } catch {}
            this.turnoActivo = null;
            this.turnoPendienteRecuperacion = null;
          }
        },
        error: () => {
          // Si falla conexión, mantenemos el turno local
        }
      });
    }
  }

  async actualizarContadorPendientes() {
    const pendientes = await this.cajaService.obtenerVentasOfflinePendientes();
    this.ventasPendientesSync = pendientes ? pendientes.length : 0;
  }

  // --- Habilitación de Turno y Cupos ---
  agregarCupoSolicitado() {
    this.error = '';
    if (!this.cupoVarianteSeleccionada) {
      this.error = 'Seleccione una prenda para solicitar cupo.';
      return;
    }
    if (this.cupoCantidadSolicitada < 1) {
      this.error = 'La cantidad debe ser mayor a 0.';
      return;
    }
    const existente = this.cuposSolicitados.find(c => c.variante_id === this.cupoVarianteSeleccionada);
    if (existente) {
      existente.cantidad += this.cupoCantidadSolicitada;
    } else {
      this.cuposSolicitados.push({
        variante_id: this.cupoVarianteSeleccionada,
        cantidad: this.cupoCantidadSolicitada
      });
    }
    this.cupoVarianteSeleccionada = '';
    this.cupoCantidadSolicitada = 1;
  }

  quitarCupoSolicitado(index: number) {
    this.cuposSolicitados.splice(index, 1);
  }

  abrirTurno() {
    const u = this.auth.obtenerUsuarioActual();
    this.error = '';
    this.mensajeExito = '';

    if (!u?.sucursal_id) {
      this.error = 'El usuario no tiene una sucursal asignada para operar en caja.';
      return;
    }
    if (!this.cajaId.trim()) {
      this.error = 'Ingrese un código identificador para la caja.';
      return;
    }
    if (!this.cuposSolicitados.length) {
      this.error = 'Debe solicitar al menos un cupo exclusivo de prendas para operar la caja.';
      return;
    }

    this.procesando = true;
    this.cajaService.habilitarTurno({
      caja_id: this.cajaId.trim(),
      dispositivo_id: this.dispositivoId,
      sucursal_id: u.sucursal_id,
      cupos: this.cuposSolicitados,
      revision: 1
    }).subscribe({
      next: async turno => {
        turno.ultima_secuencia_local = 0;
        turno.total_operaciones_locales = 0;
        await this.persistirTurnoLocalmente(turno);
        this.procesando = false;
      },
      error: err => {
        this.error = this.msg(err);
        this.procesando = false;
      }
    });
  }

  habilitarTurno() {
    return this.abrirTurno();
  }

  async persistirTurnoLocalmente(turno: TurnoHabilitacion): Promise<boolean> {
    try {
      await this.cajaService.guardarTurnoLocal(turno);
      this.turnoActivo = turno;
      this.turnoPendienteRecuperacion = null;
      this.cuposSolicitados = [];
      this.mensajeExito = `Caja ${turno.caja_codigo} habilitada exitosamente con vigencia de 8 horas.`;
      this.error = '';
      return true;
    } catch (errPersistencia) {
      this.turnoActivo = null;
      this.turnoPendienteRecuperacion = turno;
      this.error = 'Error de almacenamiento local: no se pudo guardar el turno en el almacenamiento transaccional del dispositivo. El turno fue reservado en el servidor pero la caja no está lista ni puede operar offline. Puede reintentar la persistencia local sin volver a solicitar cupos.';
      return false;
    }
  }

  async reintentarPersistenciaTurno(): Promise<void> {
    if (!this.turnoPendienteRecuperacion) return;
    this.procesando = true;
    this.error = '';
    await this.persistirTurnoLocalmente(this.turnoPendienteRecuperacion);
    this.procesando = false;
  }

  cancelarTurnoPendiente(): void {
    this.turnoPendienteRecuperacion = null;
    this.error = '';
  }

  // --- Venta Contado Offline ---
  agregarLineaVentaOffline() {
    this.error = '';
    if (!this.varianteVentaOffline) {
      this.error = 'Seleccione una prenda del inventario de caja.';
      return;
    }
    if (this.cantidadVentaOffline < 1) {
      this.error = 'La cantidad debe ser mayor a 0.';
      return;
    }

    const cupo = this.obtenerCupo(this.varianteVentaOffline);
    if (!cupo) {
      this.error = 'La prenda seleccionada no cuenta con cupo en este turno.';
      return;
    }

    const disponibleCupo = cupo.otorgado - cupo.consumido;
    const yaEnVenta = this.lineasVentaOffline
      .filter(l => l.variante_id === this.varianteVentaOffline)
      .reduce((acc, l) => acc + l.cantidad, 0);

    if (yaEnVenta + this.cantidadVentaOffline > disponibleCupo) {
      this.error = `Cupo insuficiente en caja: quedan ${disponibleCupo - yaEnVenta} unidades disponibles.`;
      return;
    }

    const precio = Number(cupo.precio_autorizado_bob) || 0;
    this.lineasVentaOffline.push({
      variante_id: this.varianteVentaOffline,
      cantidad: this.cantidadVentaOffline,
      precio_bob: precio
    });

    this.varianteVentaOffline = '';
    this.cantidadVentaOffline = 1;
    this.calcularCambio();
  }

  quitarLineaVentaOffline(index: number) {
    this.lineasVentaOffline.splice(index, 1);
    this.calcularCambio();
  }

  totalVentaOffline(): number {
    return this.lineasVentaOffline.reduce((acc, l) => acc + (l.cantidad * l.precio_bob), 0);
  }

  calcularCambio() {
    const total = this.totalVentaOffline();
    if (this.efectivoRecibido >= total) {
      this.cambioEntregado = Math.round((this.efectivoRecibido - total) * 100) / 100;
    } else {
      this.cambioEntregado = 0;
    }
  }

  async cobrarVentaContado() {
    this.error = '';
    this.mensajeExito = '';
    if (!this.turnoActivo) {
      this.error = 'No hay un turno de caja activo para procesar ventas.';
      return;
    }
    if (!this.lineasVentaOffline.length) {
      this.error = 'Agregue al menos una prenda a la venta.';
      return;
    }
    const total = this.totalVentaOffline();
    if (this.efectivoRecibido < total) {
      this.error = 'El efectivo recibido es menor al total de la venta.';
      return;
    }

    this.procesando = true;

    // Preservar el mismo operacion_id si se reintenta tras un fallo de almacenamiento
    if (!this.operacionIdActual) {
      this.operacionIdActual = crypto.randomUUID();
    }
    const operacionId = this.operacionIdActual;
    const ahoraIso = new Date().toISOString();

    const nuevaSecuencia = (this.turnoActivo.ultima_secuencia_local || 0) + 1;
    const totalOps = (this.turnoActivo.total_operaciones_locales || 0) + 1;

    const ventaDto: VentaOfflineCrear = {
      operacion_id: operacionId,
      secuencia_local: nuevaSecuencia,
      vendida_local_en: ahoraIso,
      entregada_local_en: ahoraIso,
      version_precios: this.turnoActivo.version_precios,
      lineas: this.lineasVentaOffline.map(l => ({
        variante_id: l.variante_id,
        cantidad: l.cantidad,
        precio_autorizado_bob: l.precio_bob
      })),
      total_bob: total,
      efectivo_recibido_bob: this.efectivoRecibido,
      cambio_entregado_bob: this.cambioEntregado
    };

    // Preparar comprobante local durable
    const comprobanteInfo: ComprobanteCajaOffline = {
      operacion_id: operacionId,
      numero: `VNT-OFF-${operacionId.substring(0, 6).toUpperCase()}`,
      fecha: ahoraIso,
      lineas: this.lineasVentaOffline.map(l => ({
        sku: this.v(l.variante_id),
        cantidad: l.cantidad,
        subtotal: l.cantidad * l.precio_bob
      })),
      total: total,
      efectivo: this.efectivoRecibido,
      cambio: this.cambioEntregado,
      esOffline: !navigator.onLine
    };

    // Descontar cupo local en copia de trabajo y actualizar contadores
    const turnoClonado: TurnoHabilitacion = JSON.parse(JSON.stringify(this.turnoActivo));
    turnoClonado.ultima_secuencia_local = nuevaSecuencia;
    turnoClonado.total_operaciones_locales = totalOps;
    for (const l of this.lineasVentaOffline) {
      const c = turnoClonado.cupos.find(cupo => cupo.variante_id === l.variante_id);
      if (c) c.consumido += l.cantidad;
    }

    // Regla de persistencia atómica: Si falla la transacción local, NUNCA emitir comprobante,
    // NUNCA declarar la venta completada y preservar las líneas para reintentar con el MISMO operacion_id.
    try {
      await this.cajaService.registrarVentaOfflineTransaccional(turnoClonado, ventaDto, comprobanteInfo);
    } catch (errPersistencia) {
      this.procesando = false;
      this.comprobanteOffline = undefined;
      this.error = 'Error de almacenamiento local: no se pudo guardar la venta en el dispositivo. La venta NO fue completada y se conserva el pedido para reintentar.';
      return;
    }

    // Persistencia local confirmada con éxito: venta canónica y definitiva
    this.turnoActivo = turnoClonado;
    this.operacionIdActual = null; // Reiniciar solo tras éxito definitivo en almacenamiento local

    if (navigator.onLine) {
      this.cajaService.registrarVentaOffline(this.turnoActivo.turno_id, ventaDto).subscribe({
        next: async () => {
          await this.cajaService.eliminarVentaOfflinePendiente(ventaDto.operacion_id);
          await this.actualizarContadorPendientes();
          this.comprobanteOffline = { ...comprobanteInfo, esOffline: false };
          this.limpiarFormularioVentaOffline();
          this.procesando = false;
        },
        error: async () => {
          // Si falla la sincronización por red, la venta ya está segura en la base de datos local
          await this.actualizarContadorPendientes();
          this.comprobanteOffline = { ...comprobanteInfo, esOffline: true };
          this.limpiarFormularioVentaOffline();
          this.procesando = false;
        }
      });
    } else {
      await this.actualizarContadorPendientes();
      this.comprobanteOffline = { ...comprobanteInfo, esOffline: true };
      this.limpiarFormularioVentaOffline();
      this.procesando = false;
    }
  }

  limpiarFormularioVentaOffline() {
    this.lineasVentaOffline = [];
    this.efectivoRecibido = 0;
    this.cambioEntregado = 0;
    this.operacionIdActual = null;
  }

  nuevaVentaOffline() {
    this.comprobanteOffline = undefined;
    this.limpiarFormularioVentaOffline();
  }

  // --- Sincronización y Cierre de Turno ---
  async sincronizarVentasPendientes() {
    if (!this.turnoActivo) return;
    const pendientes = await this.cajaService.obtenerVentasOfflinePendientes();
    if (!pendientes.length) return;

    this.procesando = true;
    this.error = '';
    let completadas = 0;
    let conError = 0;

    const finalizar = async () => {
      if (completadas + conError !== pendientes.length) return;
      if (conError === 0) await this.refrescarTurnoCentral();
      this.procesando = false;
      if (conError === 0) {
        this.mensajeExito = `${completadas} venta(s) sincronizada(s) con el servidor central.`;
      }
    };

    for (const venta of pendientes) {
      this.cajaService.registrarVentaOffline(this.turnoActivo.turno_id, venta).subscribe({
        next: async () => {
          await this.cajaService.eliminarVentaOfflinePendiente(venta.operacion_id);
          completadas++;
          await this.actualizarContadorPendientes();
          await finalizar();
        },
        error: async err => {
          conError++;
          this.error = `Error al sincronizar venta: ${this.msg(err)}`;
          await finalizar();
        }
      });
    }
  }

  private async refrescarTurnoCentral(): Promise<void> {
    const turnoActual = this.turnoActivo;
    if (!turnoActual) return;
    try {
      const actualizado = await firstValueFrom(this.cajaService.consultarTurno(turnoActual.turno_id));
      actualizado.ultima_secuencia_local = turnoActual.ultima_secuencia_local ?? 0;
      actualizado.total_operaciones_locales = turnoActual.total_operaciones_locales ?? 0;
      this.turnoActivo = actualizado;
      await this.cajaService.guardarTurnoLocal(actualizado);
    } catch {
      this.error = 'Las ventas se sincronizaron, pero no se pudo actualizar el estado central del turno. Recarga el turno antes de cerrar.';
    }
  }

  get puedeSupervisarCierre(): boolean {
    const rol = this.auth.obtenerUsuarioActual()?.rol;
    return ['ADMINISTRADOR', 'PROPIETARIO', 'ENCARGADO'].includes(rol || '');
  }

  get cuposConFaltanteFisico(): CupoRespuesta[] {
    if (!this.turnoActivo) return [];
    return this.turnoActivo.cupos.filter(cupo => {
      const remanente = Math.max(0, cupo.otorgado - cupo.consumido - cupo.liberado);
      const encontrado = this.conteoFisicoPorVariante[cupo.variante_id];
      return encontrado !== null && encontrado !== undefined && encontrado < remanente;
    });
  }

  get formularioSupervisionValido(): boolean {
    if (!this.turnoActivo || !this.cierreSupervisado) return true;
    if (!this.referenciaActa.trim() || this.motivoSupervision.trim().length < 3) return false;
    if (!Number.isFinite(this.arqueoEfectivoBob) || this.arqueoEfectivoBob < 0) return false;
    const conteoValido = this.turnoActivo.cupos.every(cupo => {
      const cantidad = this.conteoFisicoPorVariante[cupo.variante_id];
      const remanente = Math.max(0, cupo.otorgado - cupo.consumido - cupo.liberado);
      return Number.isInteger(cantidad) && cantidad! >= 0 && cantidad! <= remanente;
    });
    if (!conteoValido) return false;
    return this.cuposConFaltanteFisico.every(cupo => {
      const resolucion = this.resolucionFaltantePorVariante[cupo.variante_id];
      const motivo = this.motivoFaltantePorVariante[cupo.variante_id]?.trim() || '';
      return !!resolucion && motivo.length >= 10;
    });
  }

  abrirModalCierre(supervisado = false) {
    this.error = '';
    this.mensajeExito = '';
    this.arqueoEfectivoBob = 0;
    this.cierreSupervisado = supervisado;
    this.motivoSupervision = '';
    this.referenciaActa = '';
    this.conteoFisicoPorVariante = {};
    this.resolucionFaltantePorVariante = {};
    this.motivoFaltantePorVariante = {};
    if (supervisado && this.turnoActivo) {
      for (const cupo of this.turnoActivo.cupos) {
        this.conteoFisicoPorVariante[cupo.variante_id] = null;
      }
    }
    this.mostrarDialogoCierre = true;
  }

  cancelarCierre() {
    this.mostrarDialogoCierre = false;
    this.cierreSupervisado = false;
  }

  async confirmarCierreTurno() {
    if (this.cierreSupervisado && !this.formularioSupervisionValido) {
      this.error = 'Completa el acta, el arqueo y el conteo de cada prenda. Para cada faltante, indica si esperará una sincronización o si se registrará como merma con su motivo.';
      return;
    }
    this.mostrarDialogoCierre = false;
    await this.cerrarTurno(this.arqueoEfectivoBob);
  }

  async cerrarTurno(arqueoDirecto?: number) {
    if (!this.turnoActivo) return;
    try {
      await this.actualizarContadorPendientes();
      const pendientes = await this.cajaService.obtenerVentasOfflinePendientes();
      const pendientesIds = pendientes.map(p => p.operacion_id);
      const arqueo = arqueoDirecto !== undefined ? arqueoDirecto : (this.arqueoEfectivoBob ?? 0);
      const turnoId = this.turnoActivo.turno_id;
      const dto: import('../services/caja.service').TurnoCerrar = {
        revision: this.turnoActivo.revision,
        ultima_secuencia_local: this.turnoActivo.ultima_secuencia_local ?? 0,
        total_operaciones_locales: this.turnoActivo.total_operaciones_locales ?? 0,
        operaciones_pendientes: pendientesIds,
        arqueo_efectivo_bob: arqueo
      };

      if (this.cierreSupervisado) {
        dto.supervision_forzada = true;
        dto.motivo_supervision = this.motivoSupervision.trim();
        // Per-variant evidence is authoritative; never globally discard a variant awaiting sync.
        dto.descarte_venta_fisica = false;
        dto.arqueo_declarado_bob = arqueo;
        dto.evidencia_cierre = {
          referencia_acta: this.referenciaActa.trim(),
          conteo_fisico_por_variante: this.turnoActivo.cupos.map(cupo => ({
            variante_id: cupo.variante_id,
            cantidad_encontrada: Number(this.conteoFisicoPorVariante[cupo.variante_id])
          }))
        };
        dto.ajustes_inventario = {
          resoluciones_por_variante: this.cuposConFaltanteFisico.map(cupo => ({
            variante_id: cupo.variante_id,
            resolucion: this.resolucionFaltantePorVariante[cupo.variante_id]!,
            motivo: this.motivoFaltantePorVariante[cupo.variante_id].trim()
          }))
        };
      }

      this.procesando = true;
      this.error = '';
      const resultado = await firstValueFrom(this.cajaService.cerrarTurno(turnoId, dto));
      this.procesando = false;
      if (resultado.estado === 'CERRADO') {
        const unidadesDevueltas = resultado.cupos_devueltos.reduce((total, cupo) => total + (cupo.devuelto || 0), 0);
        this.mensajeExito = `Turno cerrado. Se liberaron ${unidadesDevueltas} unidad(es) confirmadas por el conteo.`;
        this.turnoActivo = null;
        this.turnoPendienteRecuperacion = null;
        this.cierreSupervisado = false;
        try {
          await this.cajaService.limpiarTurnoLocal();
        } catch {
          this.error = 'El turno se cerro en el servidor, pero no se pudo limpiar la copia local. Recarga la caja con conexion antes de operar.';
        }
        return;
      }

      // The response is an action summary. Refresh the central cupo balances before another resolution.
      const actualizado = await firstValueFrom(this.cajaService.consultarTurno(turnoId));
      actualizado.ultima_secuencia_local = this.turnoActivo.ultima_secuencia_local ?? 0;
      actualizado.total_operaciones_locales = this.turnoActivo.total_operaciones_locales ?? 0;
      this.turnoActivo = actualizado;
      await this.cajaService.guardarTurnoLocal(actualizado);
      this.cierreSupervisado = false;
      const retenidos = resultado.cupos_retenidos?.reduce((total, cupo) => total + cupo.retenido, 0) || 0;
      this.error = retenidos > 0
        ? `El turno sigue en conciliacion con ${retenidos} prenda(s) retenida(s). Sincroniza las ventas tardias o registra un nuevo conteo supervisado.`
        : `El turno paso a conciliacion por ${pendientesIds.length} operacion(es) pendiente(s). Sincronizalas y vuelve a cerrar.`;
    } catch (err) {
      this.error = this.msg(err);
      this.procesando = false;
    }
  }

  async recuperarTurno() {
    const turno = this.turnoActivo || this.turnoPendienteRecuperacion;
    if (!turno) return;
    this.procesando = true;
    this.error = '';
    try {
      await firstValueFrom(this.cajaService.recuperarTurno(turno.turno_id, {
        revision: turno.revision,
        motivo: 'Fallo irreversible en almacenamiento o dispositivo de caja'
      }));
      turno.estado = 'RECUPERACION';
      this.turnoActivo = null;
      this.turnoPendienteRecuperacion = null;
      this.mensajeExito = 'El turno quedo en recuperacion. Los cupos permanecen retenidos para revision supervisada.';
      try {
        await this.cajaService.limpiarTurnoLocal();
      } catch {
        this.error = 'El servidor puso el turno en recuperacion, pero no se pudo limpiar la copia local. No operes sin conexion y vuelve a cargar la caja con red.';
      }
    } catch (err) {
      this.error = this.msg(err);
    } finally {
      this.procesando = false;
    }
  }

  obtenerCupo(varianteId: string): CupoRespuesta | undefined {
    return this.turnoActivo?.cupos.find(c => c.variante_id === varianteId);
  }

  etiquetaEstadoTurno(estado?: string): string {
    switch (estado) {
      case 'ABIERTO': return 'Abierto';
      case 'CERRADO': return 'Cerrado';
      case 'CONCILIACION': return 'Conciliación requerida';
      case 'RECUPERACION': return 'En recuperación';
      default: return estado || '—';
    }
  }

  // --- Modo Reserva Online (Online legacy) ---
  buscar() {
    if (!this.codigo.trim()) {
      this.error = 'Ingrese un código de reserva para buscar.';
      return;
    }
    this.cargando = true;
    this.error = '';
    this.reservas.reservaPorCodigo(this.codigo.trim()).subscribe({
      next: r => {
        this.reserva = r;
        this.items = r.detalles
          .filter(d => d.cantidad_reservada > d.cantidad_vendida)
          .map(d => ({
            detalle_reserva_id: d.id,
            variante_id: d.variante_id,
            cantidad: d.cantidad_reservada - d.cantidad_vendida
          }));
        this.cargando = false;
        if (!this.items.length) {
          this.error = 'Esta reserva no tiene prendas disponibles para cobro (ya fueron cobradas o liberadas).';
        }
      },
      error: e => {
        this.error = this.msg(e);
        this.cargando = false;
      }
    });
  }

  agregar() {
    this.error = '';
    if (!this.variante) {
      this.error = 'Seleccione una variante antes de agregar.';
      return;
    }
    if (this.cantidad < 1) {
      this.error = 'La cantidad debe ser al menos 1.';
      return;
    }
    this.items.push({ variante_id: this.variante, cantidad: this.cantidad });
    this.variante = '';
    this.cantidad = 1;
  }

  quitar(i: number) {
    this.items.splice(i, 1);
  }

  v(id: string) {
    return this.variantes.find(x => x.id === id)?.sku || (id ? 'Prenda' : '—');
  }

  vender() {
    const u = this.auth.obtenerUsuarioActual();
    this.error = '';
    if (!u?.sucursal_id) {
      this.error = 'El usuario no tiene una sucursal asignada para operar en caja.';
      return;
    }
    if (!this.items.length) {
      this.error = 'Debe agregar al menos una prenda para procesar la venta.';
      return;
    }
    if (this.procesando) return;

    this.procesando = true;
    this.api.registrarVenta({
      reserva_id: this.reserva?.id,
      sucursal_id: u.sucursal_id,
      cliente_id: this.reserva?.cliente_id,
      metodo: this.metodo,
      items: this.items
    }).subscribe({
      next: v => {
        this.api.comprobante(v.id).subscribe({
          next: c => {
            this.comprobante = c;
            this.procesando = false;
            this.items = [];
          },
          error: e => {
            this.error = this.msg(e);
            this.procesando = false;
          }
        });
      },
      error: e => {
        this.error = this.msg(e);
        this.procesando = false;
      }
    });
  }

  nueva() {
    this.reserva = undefined;
    this.comprobante = undefined;
    this.codigo = '';
    this.items = [];
    this.error = '';
  }

  imprimir() {
    window.print();
  }

  private msg(e: unknown): string {
    return formatearErrorApi(e, 'No se pudo completar la operación en caja.');
  }
}
