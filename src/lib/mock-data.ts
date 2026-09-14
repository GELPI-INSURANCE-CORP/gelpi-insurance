import { Cliente, Comision, Poliza, Reclamo } from "./types";

export const clientes: Cliente[] = [
  { id: "c1", nombre: "María Fernández", email: "maria.fernandez@mail.com", telefono: "+1 305 555 0134", ciudad: "Miami, FL", polizasActivas: 2, clienteDesde: "2022-03-11" },
  { id: "c2", nombre: "Carlos Ortega", email: "carlos.ortega@mail.com", telefono: "+1 786 555 0198", ciudad: "Doral, FL", polizasActivas: 1, clienteDesde: "2023-07-02" },
  { id: "c3", nombre: "Lucía Ramírez", email: "lucia.ramirez@mail.com", telefono: "+1 954 555 0177", ciudad: "Hialeah, FL", polizasActivas: 3, clienteDesde: "2021-01-20" },
  { id: "c4", nombre: "Roberto Gelpi", email: "roberto.gelpi@mail.com", telefono: "+1 305 555 0212", ciudad: "Coral Gables, FL", polizasActivas: 1, clienteDesde: "2024-02-14" },
  { id: "c5", nombre: "Ana Torres", email: "ana.torres@mail.com", telefono: "+1 786 555 0245", ciudad: "Kendall, FL", polizasActivas: 2, clienteDesde: "2023-11-05" },
];

export const polizas: Poliza[] = [
  { id: "p1", numero: "GI-100234", clienteId: "c1", clienteNombre: "María Fernández", tipo: "Auto", aseguradora: "Progressive", prima: 1240, estado: "activa", inicio: "2025-11-01", vencimiento: "2026-11-01" },
  { id: "p2", numero: "GI-100235", clienteId: "c1", clienteNombre: "María Fernández", tipo: "Hogar", aseguradora: "Citizens", prima: 2100, estado: "activa", inicio: "2025-09-15", vencimiento: "2026-09-15" },
  { id: "p3", numero: "GI-100236", clienteId: "c2", clienteNombre: "Carlos Ortega", tipo: "Auto", aseguradora: "GEICO", prima: 980, estado: "pendiente", inicio: "2026-09-20", vencimiento: "2027-09-20" },
  { id: "p4", numero: "GI-100237", clienteId: "c3", clienteNombre: "Lucía Ramírez", tipo: "Vida", aseguradora: "MetLife", prima: 640, estado: "activa", inicio: "2025-05-10", vencimiento: "2026-05-10" },
  { id: "p5", numero: "GI-100238", clienteId: "c3", clienteNombre: "Lucía Ramírez", tipo: "Auto", aseguradora: "Progressive", prima: 1150, estado: "vencida", inicio: "2024-08-01", vencimiento: "2025-08-01" },
  { id: "p6", numero: "GI-100239", clienteId: "c3", clienteNombre: "Lucía Ramírez", tipo: "Hogar", aseguradora: "Citizens", prima: 1890, estado: "activa", inicio: "2025-12-01", vencimiento: "2026-12-01" },
  { id: "p7", numero: "GI-100240", clienteId: "c4", clienteNombre: "Roberto Gelpi", tipo: "Comercial", aseguradora: "Travelers", prima: 3400, estado: "activa", inicio: "2026-01-15", vencimiento: "2027-01-15" },
  { id: "p8", numero: "GI-100241", clienteId: "c5", clienteNombre: "Ana Torres", tipo: "Auto", aseguradora: "GEICO", prima: 1020, estado: "cancelada", inicio: "2025-04-01", vencimiento: "2026-04-01" },
];

export const reclamos: Reclamo[] = [
  { id: "r1", numero: "CLM-5001", polizaNumero: "GI-100234", clienteNombre: "María Fernández", tipo: "Colisión", monto: 4200, estado: "en_revision", fecha: "2026-08-20" },
  { id: "r2", numero: "CLM-5002", polizaNumero: "GI-100237", clienteNombre: "Lucía Ramírez", tipo: "Vida - beneficio", monto: 50000, estado: "aprobado", fecha: "2026-07-02" },
  { id: "r3", numero: "CLM-5003", polizaNumero: "GI-100236", clienteNombre: "Carlos Ortega", tipo: "Cristales", monto: 350, estado: "pagado", fecha: "2026-06-11" },
  { id: "r4", numero: "CLM-5004", polizaNumero: "GI-100240", clienteNombre: "Roberto Gelpi", tipo: "Daño a propiedad", monto: 12800, estado: "abierto", fecha: "2026-09-05" },
  { id: "r5", numero: "CLM-5005", polizaNumero: "GI-100241", clienteNombre: "Ana Torres", tipo: "Robo", monto: 2200, estado: "rechazado", fecha: "2026-05-28" },
];

export const comisiones: Comision[] = [
  { id: "co1", agente: "Roberto Gelpi", polizaNumero: "GI-100234", clienteNombre: "María Fernández", monto: 186, porcentaje: 15, periodo: "2026-08", pagada: true },
  { id: "co2", agente: "Roberto Gelpi", polizaNumero: "GI-100235", clienteNombre: "María Fernández", monto: 315, porcentaje: 15, periodo: "2026-08", pagada: true },
  { id: "co3", agente: "Ana Torres", polizaNumero: "GI-100237", clienteNombre: "Lucía Ramírez", monto: 96, porcentaje: 15, periodo: "2026-08", pagada: false },
  { id: "co4", agente: "Ana Torres", polizaNumero: "GI-100240", clienteNombre: "Roberto Gelpi", monto: 680, porcentaje: 20, periodo: "2026-09", pagada: false },
  { id: "co5", agente: "Carlos Ortega", polizaNumero: "GI-100238", clienteNombre: "Lucía Ramírez", monto: 172, porcentaje: 15, periodo: "2026-07", pagada: true },
];
