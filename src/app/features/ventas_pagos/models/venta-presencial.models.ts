export type MetodoCaja = 'EFECTIVO' | 'TARJETA_CAJA' | 'QR_CAJA' | 'TRANSFERENCIA';

export interface Pago { id: string; contexto: string; reserva_id?: string; venta_id?: string; metodo: string; tipo_pago?: string; modalidad_adelanto?: string; monto: number; no_reembolsable: boolean; estado: string; pagado_en?: string; }

export interface ItemVenta { detalle_reserva_id?: string; variante_id: string; cantidad: number; }

export interface VentaCrear { reserva_id?: string; sucursal_id: string; cliente_id?: string; metodo: MetodoCaja; items: ItemVenta[]; }

export interface DetalleVenta { id: string; detalle_reserva_id?: string; variante_id: string; cantidad: number; precio_unitario: number; descuento: number; costo_promedio?: number; }

export interface Venta { id: string; numero: string; cliente_id?: string; reserva_id?: string; sucursal_id: string; cajero_id?: string; canal: string; estado: string; subtotal: number; descuento: number; adelanto_descontado: number; costo_entrega: number; total: number; creada_en: string; confirmada_en?: string; detalles: DetalleVenta[]; }

export interface Comprobante extends Venta { reserva_codigo?: string; sucursal_nombre?: string; cajero_nombre?: string; pagos: Pago[]; }
