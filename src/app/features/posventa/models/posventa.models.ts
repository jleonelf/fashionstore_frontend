export interface Devolucion { id: string; detalle_venta_id: string; venta_id: string; variante_id: string; sucursal_id: string; cantidad: number; costo_unitario: number; motivo?: string; responsable_id?: string; fecha_hora: string; }

export interface Merma { id: string; variante_id: string; sucursal_id: string; cantidad: number; costo_unitario: number; causa?: string; responsable_id?: string; fecha_hora: string; }
