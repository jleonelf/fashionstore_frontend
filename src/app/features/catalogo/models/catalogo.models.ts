export interface TallaDTO { id: string; nombre: string; orden: number; activo: boolean; }

export interface ColorDTO { id: string; nombre: string; codigo_hex?: string; activo: boolean; }

export interface CategoriaDTO { id: string; nombre: string; descripcion?: string; categoria_padre_id?: string; activo: boolean; }

export interface TemporadaDTO { id: string; nombre: string; fecha_inicio?: string; fecha_fin?: string; activa: boolean; }

export interface ColeccionDTO { id: string; nombre: string; descripcion?: string; activa: boolean; }

export interface ProductoDTO {
  id: string;
  categoria_id?: string;
  proveedor_principal_id?: string;
  nombre: string;
  descripcion?: string;
  genero?: string;
  marca?: string;
  precio_base: number;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  imagenes: ImagenProductoDTO[];
  temporada_ids: string[];
  coleccion_ids: string[];
}

export interface ImagenProductoDTO {
  id: string;
  producto_id: string;
  enlace_imagen: string;
  texto_alternativo?: string;
  orden: number;
  es_principal: boolean;
}

export interface VarianteDTO {
  id: string;
  producto_id: string;
  talla_id: string;
  color_id: string;
  sku: string;
  codigo_barras?: string;
  precio: number;
  peso_gramos?: number;
  costo_promedio: number;
  costo_ultimo: number;
  recurso_prueba_virtual?: string;
  activa: boolean;
}

// Catálogo público

export interface CatalogoFiltroParams {
  texto?: string;
  categoria_id?: string;
  talla_id?: string;
  color_id?: string;
  temporada_id?: string;
  coleccion_id?: string;
  genero?: string;
  marca?: string;
  precio_min?: number;
  precio_max?: number;
  codigo_hex?: string;
}

export interface DisponibilidadItem {
  sucursal_id: string;
  sucursal_nombre: string;
  ciudad_nombre: string;
  direccion: string;
  disponible: number;
  reservado: number;
  comprometido_traslado: number;
  en_transito: number;
  actualizado_en: string;
}
