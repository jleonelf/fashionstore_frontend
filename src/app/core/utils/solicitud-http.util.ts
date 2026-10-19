import { HttpHeaders, HttpParams } from '@angular/common/http';

export function cabeceraIdempotencia(): HttpHeaders {
  return new HttpHeaders({ 'Idempotency-Key': crypto.randomUUID() });
}

export function parametrosHttp(valores: Record<string, unknown>): HttpParams {
  let parametros = new HttpParams();
  Object.entries(valores).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') {
      parametros = parametros.set(clave, String(valor));
    }
  });
  return parametros;
}
