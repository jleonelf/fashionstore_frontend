import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmpresaService } from '../services/empresa.service';
import { EmpresaCrearDTO, EmpresaDetalleDTO } from '../models/empresa.models';
import { formatearErrorApi } from '../../../core/utils/error-handler.util';
import { formatearFechaBolivia } from '../../../core/utils/bolivia-time.util';
import {
  bloquearScrollBody,
  desbloquearScrollBody,
  atraparFocoModal,
  enfocarPrimerElemento,
  devolverFocoDisparador
} from '../../../core/utils/modal-accessibility.util';

@Component({
  selector: 'app-empresas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './empresas.component.html',
  styleUrls: ['./empresas.component.css']
})
export class EmpresasComponent implements OnInit, OnDestroy {
  empresas: EmpresaDetalleDTO[] = [];
  filtroSoloActivas = false;

  nuevaEmpresa: EmpresaCrearDTO = {
    razon_social: '',
    nombre_comercial: '',
    empresa_codigo: '',
    administrador: {
      nombre: '',
      correo: '',
      credencial_inicial: ''
    }
  };

  cargando = false;
  guardando = false;
  mensajeError: string | null = null;
  mensajeExito: string | null = null;

  empresaSeleccionada: EmpresaDetalleDTO | null = null;
  private claveIdempotenciaActual: string | null = null;

  @ViewChild('modalDetalleBox') modalDetalleBox?: ElementRef<HTMLElement>;
  private disparadorPrevio: HTMLElement | null = null;

  constructor(private empresaService: EmpresaService) {}

  ngOnInit(): void {
    this.cargarEmpresas();
  }

  cargarEmpresas(): void {
    this.cargando = true;
    this.empresaService.listarEmpresas(this.filtroSoloActivas).subscribe({
      next: (data) => {
        this.empresas = data;
        this.cargando = false;
      },
      error: (err) => {
        this.mensajeError = formatearErrorApi(err, 'No se pudo obtener el listado de empresas.');
        this.cargando = false;
      }
    });
  }

  cambiarFiltroActivas(): void {
    this.cargarEmpresas();
  }

  crearEmpresa(): void {
    this.mensajeError = null;
    this.mensajeExito = null;

    const razon = this.nuevaEmpresa.razon_social?.trim();
    const nombre = this.nuevaEmpresa.nombre_comercial?.trim();
    const codigo = this.nuevaEmpresa.empresa_codigo?.trim().toLowerCase();
    const adminNombre = this.nuevaEmpresa.administrador.nombre?.trim();
    const adminCorreo = this.nuevaEmpresa.administrador.correo?.trim().toLowerCase();
    const adminClave = this.nuevaEmpresa.administrador.credencial_inicial;

    if (!razon || !nombre || !codigo || !adminNombre || !adminCorreo || !adminClave) {
      this.mensajeError = 'Por favor complete todos los campos requeridos (*).';
      return;
    }

    const regexCodigo = /^[a-zA-Z0-9_-]+$/;
    if (!regexCodigo.test(codigo)) {
      this.mensajeError = 'El identificador de empresa sólo puede contener letras, números, guiones y guiones bajos (sin espacios).';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminCorreo)) {
      this.mensajeError = 'Por favor ingrese una dirección de correo válida para el administrador.';
      return;
    }

    if (!this.contraseniaValida) {
      const faltantes = this.obtenerRequisitosFaltantes();
      this.mensajeError = `La credencial inicial debe cumplir los requisitos de seguridad. Falta: ${faltantes.join(', ')}.`;
      return;
    }

    const payload: EmpresaCrearDTO = {
      razon_social: razon,
      nombre_comercial: nombre,
      empresa_codigo: codigo,
      administrador: {
        nombre: adminNombre,
        correo: adminCorreo,
        credencial_inicial: adminClave
      }
    };

    if (!this.claveIdempotenciaActual) {
      this.claveIdempotenciaActual = crypto.randomUUID();
    }
    const idempotencyKey = this.claveIdempotenciaActual;
    this.guardando = true;

    this.empresaService.crearEmpresa(payload, idempotencyKey).subscribe({
      next: (resp) => {
        this.guardando = false;
        this.claveIdempotenciaActual = null;
        this.mensajeExito = `Empresa "${payload.nombre_comercial}" registrada correctamente con código "${resp.empresa_codigo}". Administrador inicial asignado.`;
        this.nuevaEmpresa = {
          razon_social: '',
          nombre_comercial: '',
          empresa_codigo: '',
          administrador: {
            nombre: '',
            correo: '',
            credencial_inicial: ''
          }
        };
        this.cargarEmpresas();
      },
      error: (err) => {
        this.guardando = false;
        // Conservamos this.claveIdempotenciaActual para que reintentos posteriores tras fallo usen la misma clave
        this.mensajeError = formatearErrorApi(err, 'No fue posible completar el registro de la empresa contratante.');
      }
    });
  }

  verDetalle(empresa: EmpresaDetalleDTO, event?: Event): void {
    this.disparadorPrevio = (event?.currentTarget as HTMLElement) || (document.activeElement as HTMLElement);
    this.empresaSeleccionada = empresa;
    bloquearScrollBody();
    setTimeout(() => {
      if (this.modalDetalleBox) {
        enfocarPrimerElemento(this.modalDetalleBox.nativeElement);
      }
    }, 50);
  }

  cerrarDetalle(): void {
    if (this.empresaSeleccionada) {
      desbloquearScrollBody();
      this.empresaSeleccionada = null;
    }
    devolverFocoDisparador(this.disparadorPrevio);
    this.disparadorPrevio = null;
  }

  formatearFecha(fecha?: string): string {
    return formatearFechaBolivia(fecha);
  }

  @HostListener('keydown.escape')
  alPresionarEscape(): void {
    if (this.empresaSeleccionada) {
      this.cerrarDetalle();
    }
  }

  alManejarTabDetalle(event: KeyboardEvent): void {
    if (this.modalDetalleBox) {
      atraparFocoModal(event, this.modalDetalleBox.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (this.empresaSeleccionada) {
      desbloquearScrollBody();
    }
  }

  // Validaciones de credencial inicial
  get claveActual(): string {
    return this.nuevaEmpresa.administrador.credencial_inicial || '';
  }

  get tieneLongitudMinima(): boolean {
    return this.claveActual.length >= 6;
  }

  get tieneMinuscula(): boolean {
    return /[a-z]/.test(this.claveActual);
  }

  get tieneMayuscula(): boolean {
    return /[A-Z]/.test(this.claveActual);
  }

  get tieneNumero(): boolean {
    return /[0-9]/.test(this.claveActual);
  }

  get contraseniaValida(): boolean {
    return this.tieneLongitudMinima && this.tieneMinuscula && this.tieneMayuscula && this.tieneNumero;
  }

  obtenerRequisitosFaltantes(): string[] {
    const faltantes: string[] = [];
    if (!this.tieneLongitudMinima) faltantes.push('al menos 6 caracteres');
    if (!this.tieneMinuscula) faltantes.push('una minúscula (a-z)');
    if (!this.tieneMayuscula) faltantes.push('una mayúscula (A-Z)');
    if (!this.tieneNumero) faltantes.push('un número (0-9)');
    return faltantes;
  }
}
