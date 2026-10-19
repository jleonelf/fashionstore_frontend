import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { cabeceraIdempotencia } from '../../../core/utils/solicitud-http.util';
import { Devolucion, Merma } from '../models/posventa.models';

@Injectable({ providedIn: 'root' })
export class PosventaService {
  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  devolver(detalle_venta_id: string, cantidad: number, motivo?: string): Observable<Devolucion> { return this.http.post<Devolucion>(`${this.api}/devoluciones`, { detalle_venta_id, cantidad, motivo }, { headers: cabeceraIdempotencia() }); }
  registrarMerma(variante_id: string, sucursal_id: string, cantidad: number, causa: string): Observable<Merma> { return this.http.post<Merma>(`${this.api}/mermas`, { variante_id, sucursal_id, cantidad, causa }, { headers: cabeceraIdempotencia() }); }
}
