export type EstadoPoliza = "activa" | "vencida" | "cancelada" | "pendiente";
export type EstadoReclamo = "abierto" | "en_revision" | "aprobado" | "rechazado" | "pagado";

export interface Cliente {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  ciudad: string;
  polizasActivas: number;
  clienteDesde: string;
}

export interface Poliza {
  id: string;
  numero: string;
  clienteId: string;
  clienteNombre: string;
  tipo: string;
  aseguradora: string;
  prima: number;
  estado: EstadoPoliza;
  inicio: string;
  vencimiento: string;
}

export interface Reclamo {
  id: string;
  numero: string;
  polizaNumero: string;
  clienteNombre: string;
  tipo: string;
  monto: number;
  estado: EstadoReclamo;
  fecha: string;
}

export interface Comision {
  id: string;
  agente: string;
  polizaNumero: string;
  clienteNombre: string;
  monto: number;
  porcentaje: number;
  periodo: string;
  pagada: boolean;
}
