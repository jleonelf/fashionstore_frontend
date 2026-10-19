import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { cabeceraIdempotencia, parametrosHttp } from '../../../core/utils/solicitud-http.util';
import { Pagina } from '../../../core/models/comunes.models';
import { Comprobante, MetodoCaja, Pago, Venta, VentaCrear } from '../models/venta-presencial.models';

@Injectable({ providedIn: 'root' })
export class VentaPresencialService {
  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  registrarAdelanto(reserva_id: string, metodo: MetodoCaja): Observable<Pago> { return this.http.post<Pago>(`${this.api}/pagos/adelantos`, { reserva_id, metodo }, { headers: cabeceraIdempotencia() }); }
  registrarVenta(dto: VentaCrear): Observable<Venta> { return this.http.post<Venta>(`${this.api}/ventas/presenciales`, dto, { headers: cabeceraIdempotencia() }); }
  comprobante(id: string): Observable<Comprobante> { return this.http.get<Comprobante>(`${this.api}/ventas/${id}/comprobante`); }
  historial(clienteId: string, filtros: Record<string, unknown> = {}): Observable<Pagina<Venta>> { return this.http.get<Pagina<Venta>>(`${this.api}/clientes/${clienteId}/compras`, { params: parametrosHttp(filtros) }); }
}
