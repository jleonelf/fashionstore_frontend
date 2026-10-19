import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { DecisionPedirDTO, DecisionRespuestaDTO, ReportePedirDTO, ReporteRespuestaDTO } from '../models/analitica-ia.models';

@Injectable({ providedIn: 'root' })
export class IAAnaliticaService {
  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  generarReporte(consulta: string): Observable<ReporteRespuestaDTO> {
    const dto: ReportePedirDTO = { consulta };
    return this.http.post<ReporteRespuestaDTO>(`${this.api}/ia/reportes`, dto);
  }

  decisionesInventario(dto: DecisionPedirDTO = {}): Observable<DecisionRespuestaDTO> {
    return this.http.post<DecisionRespuestaDTO>(`${this.api}/ia/decisiones-inventario`, dto);
  }
}
