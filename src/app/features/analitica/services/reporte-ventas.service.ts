import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { parametrosHttp } from '../../../core/utils/solicitud-http.util';
import { ReporteVentas } from '../models/reporte-ventas.models';

@Injectable({ providedIn: 'root' })
export class ReporteVentasService {
  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  reporteVentas(sucursal: string, filtros: Record<string, unknown> = {}): Observable<ReporteVentas> { return this.http.get<ReporteVentas>(`${this.api}/reportes/ventas-sucursal`, { params: parametrosHttp({ sucursal, ...filtros }) }); }
}
