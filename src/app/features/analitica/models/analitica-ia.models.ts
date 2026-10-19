import type { DecimalApi } from '../../../core/models/comunes.models';

export type AccionDecision    = 'PROMOCION' | 'LIQUIDACION' | 'TRASLADO' | 'REPOSICION' | 'MANTENER';

export type FuncionReporte =
  | 'ventasPorSucursal'
  | 'inventarioPorSucursal'
  | 'ventasPorTemporada'
  | 'stockCritico'
  | 'topVendidos'
  | 'efectividadReservas'
  | 'rotacionPorTemporada';

export interface DashboardSucursalItem {
  sucursal_id: string;
  sucursal_nombre: string;
  ventas: number;
  ingresos: DecimalApi;
}

export interface DashboardTopProducto {
  producto: string;
  unidades: number;
}

export interface DashboardStockCritico {
  sku: string;
  sucursal_id: string;
  disponible: number;
  existencia: number;
}

export interface ConversionReservasDTO {
  total: number;
  completadas: number;
  tasa: number;
}

export interface EfectividadPromocionesDTO {
  con_promocion: number;
  sin_promocion: number;
  descuento_total: DecimalApi;
}

export interface DashboardDTO {
  desde: string | null;
  hasta: string | null;
  ventas_total: number;
  ingresos_total: DecimalApi;
  margen_bruto_total: DecimalApi;
  ticket_promedio: DecimalApi;
  por_sucursal: DashboardSucursalItem[];
  top_productos: DashboardTopProducto[];
  stock_critico: DashboardStockCritico[];
  valorizacion_total: DecimalApi;
  conversion_reservas: ConversionReservasDTO;
  estados_pedidos: Record<string, number>;
  efectividad_promociones: EfectividadPromocionesDTO;
}

// IA

export interface ReportePedirDTO {
  consulta: string;
}

export interface ReporteRespuestaDTO {
  funcion_usada: FuncionReporte;
  parametros: Record<string, unknown>;
  datos: Record<string, unknown>;
  narrativa: string;
  proveedor: string;
}

export interface DecisionPedirDTO {
  dias_ventana?: number;
  umbral_rotacion?: number;
}

export interface DecisionItemDTO {
  variante_id: string;
  sku: string;
  accion: AccionDecision;
  detalle: string;
  stock_total: number;
  ventas_periodo: number;
  reposicion_sugerida: number;
}

export interface DecisionRespuestaDTO {
  items: DecisionItemDTO[];
  proveedor: string;
}
