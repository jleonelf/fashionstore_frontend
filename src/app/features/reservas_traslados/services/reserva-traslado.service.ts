import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { cabeceraIdempotencia, parametrosHttp } from '../../../core/utils/solicitud-http.util';
import { Pagina } from '../../../core/models/comunes.models';
import { Reserva, ReservaCrear, Traslado } from '../models/reserva-traslado.models';

@Injectable({ providedIn: 'root' })
export class ReservaTrasladoService {
  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  crearReserva(dto: ReservaCrear): Observable<Reserva> { return this.http.post<Reserva>(`${this.api}/reservas`, dto, { headers: cabeceraIdempotencia() }); }
  listarReservas(filtros: Record<string, unknown> = {}): Observable<Pagina<Reserva>> { return this.http.get<Pagina<Reserva>>(`${this.api}/reservas`, { params: parametrosHttp(filtros) }); }
  panelReservas(sucursal: string, estado = ''): Observable<Pagina<Reserva>> { return this.http.get<Pagina<Reserva>>(`${this.api}/reservas/panel/cola`, { params: parametrosHttp({ sucursal, estado }) }); }
  reservaPorCodigo(codigo: string): Observable<Reserva> { return this.http.get<Reserva>(`${this.api}/reservas/codigo/${encodeURIComponent(codigo)}`); }
  cancelarReserva(id: string): Observable<Reserva> { return this.http.patch<Reserva>(`${this.api}/reservas/${id}/cancelar`, {}); }
  prepararReserva(id: string): Observable<Reserva> { return this.http.patch<Reserva>(`${this.api}/reservas/${id}/preparar`, {}); }
  atenderReserva(id: string): Observable<Reserva> { return this.http.patch<Reserva>(`${this.api}/reservas/${id}/atender`, {}); }
  listarTraslados(filtros: Record<string, unknown> = {}): Observable<Pagina<Traslado>> { return this.http.get<Pagina<Traslado>>(`${this.api}/traslados`, { params: parametrosHttp(filtros) }); }
  solicitarTraslado(detalle_reserva_id: string, sucursal_origen_id: string): Observable<Traslado> { return this.http.post<Traslado>(`${this.api}/traslados/solicitudes`, { detalle_reserva_id, sucursal_origen_id }, { headers: cabeceraIdempotencia() }); }
  transicionarTraslado(id: string, accion: 'aprobar'|'despachar'|'recibir'): Observable<Traslado> { return this.http.patch<Traslado>(`${this.api}/traslados/${id}/${accion}`, {}); }
  rechazarTraslado(id: string, motivo: string): Observable<Traslado> { return this.http.patch<Traslado>(`${this.api}/traslados/${id}/rechazar`, { motivo }); }
}
