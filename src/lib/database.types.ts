export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      abb_versiones: {
        Row: {
          archivo_path: string | null
          estado: string
          fecha_carga: string
          id: string
          nota: string | null
          subido_por: string | null
        }
        Insert: {
          archivo_path?: string | null
          estado?: string
          fecha_carga?: string
          id?: string
          nota?: string | null
          subido_por?: string | null
        }
        Update: {
          archivo_path?: string | null
          estado?: string
          fecha_carga?: string
          id?: string
          nota?: string | null
          subido_por?: string | null
        }
        Relationships: []
      }
      agentes: {
        Row: {
          activo: boolean
          codigo: string | null
          created_at: string
          email: string | null
          es_casa: boolean
          fecha_alta: string | null
          id: string
          nombre: string
          oficina_id: string | null
          pct_split_default: number
          supervisor_id: string | null
          telefono: string | null
          user_id: string | null
        }
        Insert: {
          activo?: boolean
          codigo?: string | null
          created_at?: string
          email?: string | null
          es_casa?: boolean
          fecha_alta?: string | null
          id?: string
          nombre: string
          oficina_id?: string | null
          pct_split_default?: number
          supervisor_id?: string | null
          telefono?: string | null
          user_id?: string | null
        }
        Update: {
          activo?: boolean
          codigo?: string | null
          created_at?: string
          email?: string | null
          es_casa?: boolean
          fecha_alta?: string | null
          id?: string
          nombre?: string
          oficina_id?: string | null
          pct_split_default?: number
          supervisor_id?: string | null
          telefono?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
        ]
      }
      alias_agencia: {
        Row: {
          activo: boolean
          aseguradora_id: string | null
          created_at: string
          id: string
          texto: string
          texto_normalizado: string | null
        }
        Insert: {
          activo?: boolean
          aseguradora_id?: string | null
          created_at?: string
          id?: string
          texto: string
          texto_normalizado?: string | null
        }
        Update: {
          activo?: boolean
          aseguradora_id?: string | null
          created_at?: string
          id?: string
          texto?: string
          texto_normalizado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alias_agencia_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
        ]
      }
      aseguradoras: {
        Row: {
          activa: boolean
          codigo: string | null
          created_at: string
          formato_esperado: string | null
          id: string
          nivel_atribucion: string | null
          nombre: string
          plantilla_mapeo: Json | null
        }
        Insert: {
          activa?: boolean
          codigo?: string | null
          created_at?: string
          formato_esperado?: string | null
          id?: string
          nivel_atribucion?: string | null
          nombre: string
          plantilla_mapeo?: Json | null
        }
        Update: {
          activa?: boolean
          codigo?: string | null
          created_at?: string
          formato_esperado?: string | null
          id?: string
          nivel_atribucion?: string | null
          nombre?: string
          plantilla_mapeo?: Json | null
        }
        Relationships: []
      }
      auditoria: {
        Row: {
          accion: string
          campo: string | null
          created_at: string
          entidad: string
          entidad_id: string | null
          id: number
          motivo: string | null
          usuario: string | null
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          accion: string
          campo?: string | null
          created_at?: string
          entidad: string
          entidad_id?: string | null
          id?: number
          motivo?: string | null
          usuario?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          accion?: string
          campo?: string | null
          created_at?: string
          entidad?: string
          entidad_id?: string | null
          id?: number
          motivo?: string | null
          usuario?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: []
      }
      bono_reparto: {
        Row: {
          agente_id: string
          bono_id: string
          created_at: string
          id: string
          monto: number
          motivo: string | null
          pagado: boolean
        }
        Insert: {
          agente_id: string
          bono_id: string
          created_at?: string
          id?: string
          monto: number
          motivo?: string | null
          pagado?: boolean
        }
        Update: {
          agente_id?: string
          bono_id?: string
          created_at?: string
          id?: string
          monto?: number
          motivo?: string | null
          pagado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bono_reparto_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_reparto_bono_id_fkey"
            columns: ["bono_id"]
            isOneToOne: false
            referencedRelation: "bonos"
            referencedColumns: ["id"]
          },
        ]
      }
      bonos: {
        Row: {
          aseguradora_id: string | null
          created_at: string
          estado: string
          id: string
          monto_total: number
          nombre: string | null
          oficina_id: string | null
          periodo: string | null
          regla_reparto: string
          reporte_id: string | null
          tipo: string
        }
        Insert: {
          aseguradora_id?: string | null
          created_at?: string
          estado?: string
          id?: string
          monto_total?: number
          nombre?: string | null
          oficina_id?: string | null
          periodo?: string | null
          regla_reparto?: string
          reporte_id?: string | null
          tipo: string
        }
        Update: {
          aseguradora_id?: string | null
          created_at?: string
          estado?: string
          id?: string
          monto_total?: number
          nombre?: string | null
          oficina_id?: string | null
          periodo?: string | null
          regla_reparto?: string
          reporte_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonos_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonos_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonos_reporte_id_fkey"
            columns: ["reporte_id"]
            isOneToOne: false
            referencedRelation: "reportes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string
          direccion: string | null
          email: string | null
          id: string
          nombre: string
          nombre_normalizado: string | null
          telefono: string | null
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nombre: string
          nombre_normalizado?: string | null
          telefono?: string | null
        }
        Update: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nombre?: string
          nombre_normalizado?: string | null
          telefono?: string | null
        }
        Relationships: []
      }
      configuracion: {
        Row: {
          clave: string
          updated_at: string
          valor: Json
        }
        Insert: {
          clave: string
          updated_at?: string
          valor: Json
        }
        Update: {
          clave?: string
          updated_at?: string
          valor?: Json
        }
        Relationships: []
      }
      excepciones: {
        Row: {
          accion: string | null
          candidatos: Json | null
          created_at: string
          estado: string
          explicacion: string | null
          id: string
          linea_comision_id: string | null
          linea_relacionada_id: string | null
          linea_venta_id: string | null
          nota: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          tipo: string
        }
        Insert: {
          accion?: string | null
          candidatos?: Json | null
          created_at?: string
          estado?: string
          explicacion?: string | null
          id?: string
          linea_comision_id?: string | null
          linea_relacionada_id?: string | null
          linea_venta_id?: string | null
          nota?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          tipo: string
        }
        Update: {
          accion?: string | null
          candidatos?: Json | null
          created_at?: string
          estado?: string
          explicacion?: string | null
          id?: string
          linea_comision_id?: string | null
          linea_relacionada_id?: string | null
          linea_venta_id?: string | null
          nota?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "excepciones_linea_comision_id_fkey"
            columns: ["linea_comision_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_comision_id_fkey"
            columns: ["linea_comision_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_relacionada_id_fkey"
            columns: ["linea_relacionada_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_relacionada_id_fkey"
            columns: ["linea_relacionada_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_venta_id_fkey"
            columns: ["linea_venta_id"]
            isOneToOne: false
            referencedRelation: "lineas_venta"
            referencedColumns: ["id"]
          },
        ]
      }
      lineas_comision: {
        Row: {
          agente_id: string | null
          campos_extra: Json | null
          candidatos: Json | null
          clave_duplicado: string | null
          confianza: number | null
          created_at: string
          duplicado_par_id: string | null
          es_primera_confirmacion_alias: boolean
          estado: string
          fecha_statement: string | null
          fecha_vigencia: string | null
          fila: number | null
          id: string
          linea_original_id: string | null
          monto: number
          nombre_asegurado_crudo: string | null
          nombre_asegurado_normalizado: string | null
          numero_normalizado: string | null
          numero_poliza_crudo: string | null
          oficina_id: string | null
          poliza_id: string | null
          prima: number | null
          productor_crudo: string | null
          ramo: string | null
          regla_match: string | null
          reporte_id: string
          score: number | null
          tasa: number | null
          tipo_transaccion: string
          updated_at: string
        }
        Insert: {
          agente_id?: string | null
          campos_extra?: Json | null
          candidatos?: Json | null
          clave_duplicado?: string | null
          confianza?: number | null
          created_at?: string
          duplicado_par_id?: string | null
          es_primera_confirmacion_alias?: boolean
          estado?: string
          fecha_statement?: string | null
          fecha_vigencia?: string | null
          fila?: number | null
          id?: string
          linea_original_id?: string | null
          monto?: number
          nombre_asegurado_crudo?: string | null
          nombre_asegurado_normalizado?: string | null
          numero_normalizado?: string | null
          numero_poliza_crudo?: string | null
          oficina_id?: string | null
          poliza_id?: string | null
          prima?: number | null
          productor_crudo?: string | null
          ramo?: string | null
          regla_match?: string | null
          reporte_id: string
          score?: number | null
          tasa?: number | null
          tipo_transaccion?: string
          updated_at?: string
        }
        Update: {
          agente_id?: string | null
          campos_extra?: Json | null
          candidatos?: Json | null
          clave_duplicado?: string | null
          confianza?: number | null
          created_at?: string
          duplicado_par_id?: string | null
          es_primera_confirmacion_alias?: boolean
          estado?: string
          fecha_statement?: string | null
          fecha_vigencia?: string | null
          fila?: number | null
          id?: string
          linea_original_id?: string | null
          monto?: number
          nombre_asegurado_crudo?: string | null
          nombre_asegurado_normalizado?: string | null
          numero_normalizado?: string | null
          numero_poliza_crudo?: string | null
          oficina_id?: string | null
          poliza_id?: string | null
          prima?: number | null
          productor_crudo?: string | null
          ramo?: string | null
          regla_match?: string | null
          reporte_id?: string
          score?: number | null
          tasa?: number | null
          tipo_transaccion?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineas_comision_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_duplicado_par_id_fkey"
            columns: ["duplicado_par_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_duplicado_par_id_fkey"
            columns: ["duplicado_par_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_linea_original_id_fkey"
            columns: ["linea_original_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_linea_original_id_fkey"
            columns: ["linea_original_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_reporte_id_fkey"
            columns: ["reporte_id"]
            isOneToOne: false
            referencedRelation: "reportes"
            referencedColumns: ["id"]
          },
        ]
      }
      lineas_venta: {
        Row: {
          agente_id: string | null
          agente_nombre_crudo: string | null
          aseguradora_id: string | null
          aseguradora_nombre_crudo: string | null
          campos_extra: Json | null
          cliente_nombre_crudo: string | null
          confianza: number | null
          created_at: string
          email: string | null
          estado_en_abb: string
          fecha_venta: string | null
          fecha_vigencia: string | null
          fila: number | null
          id: string
          numero_normalizado: string | null
          numero_poliza: string | null
          oficina_id: string | null
          oficina_nombre_crudo: string | null
          poliza_id: string | null
          prima: number | null
          ramo: string | null
          reporte_id: string
          telefono: string | null
        }
        Insert: {
          agente_id?: string | null
          agente_nombre_crudo?: string | null
          aseguradora_id?: string | null
          aseguradora_nombre_crudo?: string | null
          campos_extra?: Json | null
          cliente_nombre_crudo?: string | null
          confianza?: number | null
          created_at?: string
          email?: string | null
          estado_en_abb?: string
          fecha_venta?: string | null
          fecha_vigencia?: string | null
          fila?: number | null
          id?: string
          numero_normalizado?: string | null
          numero_poliza?: string | null
          oficina_id?: string | null
          oficina_nombre_crudo?: string | null
          poliza_id?: string | null
          prima?: number | null
          ramo?: string | null
          reporte_id: string
          telefono?: string | null
        }
        Update: {
          agente_id?: string | null
          agente_nombre_crudo?: string | null
          aseguradora_id?: string | null
          aseguradora_nombre_crudo?: string | null
          campos_extra?: Json | null
          cliente_nombre_crudo?: string | null
          confianza?: number | null
          created_at?: string
          email?: string | null
          estado_en_abb?: string
          fecha_venta?: string | null
          fecha_vigencia?: string | null
          fila?: number | null
          id?: string
          numero_normalizado?: string | null
          numero_poliza?: string | null
          oficina_id?: string | null
          oficina_nombre_crudo?: string | null
          poliza_id?: string | null
          prima?: number | null
          ramo?: string | null
          reporte_id?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lineas_venta_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_venta_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_venta_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_venta_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_venta_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_venta_reporte_id_fkey"
            columns: ["reporte_id"]
            isOneToOne: false
            referencedRelation: "reportes"
            referencedColumns: ["id"]
          },
        ]
      }
      oficinas: {
        Row: {
          activa: boolean
          codigo: string | null
          created_at: string
          direccion: string | null
          gerente_agente_id: string | null
          id: string
          nombre: string
          pct_override: number
        }
        Insert: {
          activa?: boolean
          codigo?: string | null
          created_at?: string
          direccion?: string | null
          gerente_agente_id?: string | null
          id?: string
          nombre: string
          pct_override?: number
        }
        Update: {
          activa?: boolean
          codigo?: string | null
          created_at?: string
          direccion?: string | null
          gerente_agente_id?: string | null
          id?: string
          nombre?: string
          pct_override?: number
        }
        Relationships: [
          {
            foreignKeyName: "oficinas_gerente_fk"
            columns: ["gerente_agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
        ]
      }
      polizas: {
        Row: {
          abb_version_id: string | null
          agente_id: string | null
          aseguradora_id: string | null
          cliente_id: string | null
          created_at: string
          estado: string
          fecha_vencimiento: string | null
          fecha_vigencia: string | null
          id: string
          numero_normalizado: string
          numero_poliza: string
          oficina_id: string | null
          origen: string
          prima: number | null
          ramo: string
          updated_at: string
        }
        Insert: {
          abb_version_id?: string | null
          agente_id?: string | null
          aseguradora_id?: string | null
          cliente_id?: string | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          fecha_vigencia?: string | null
          id?: string
          numero_normalizado: string
          numero_poliza: string
          oficina_id?: string | null
          origen?: string
          prima?: number | null
          ramo?: string
          updated_at?: string
        }
        Update: {
          abb_version_id?: string | null
          agente_id?: string | null
          aseguradora_id?: string | null
          cliente_id?: string | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          fecha_vigencia?: string | null
          id?: string
          numero_normalizado?: string
          numero_poliza?: string
          oficina_id?: string | null
          origen?: string
          prima?: number | null
          ramo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polizas_abb_version_id_fkey"
            columns: ["abb_version_id"]
            isOneToOne: false
            referencedRelation: "abb_versiones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
        ]
      }
      reportes: {
        Row: {
          aseguradora_id: string | null
          columnas_detectadas: Json | null
          confianza_promedio: number | null
          created_at: string
          error: string | null
          estado: string
          hash_archivo: string
          id: string
          mapeo_columnas: Json | null
          mime: string | null
          nombre_archivo: string
          periodo: string | null
          resumen_ia: string | null
          storage_path: string
          subido_por: string | null
          tipo: string
          total_excepciones: number
          total_lineas: number
          total_ok: number
          updated_at: string
        }
        Insert: {
          aseguradora_id?: string | null
          columnas_detectadas?: Json | null
          confianza_promedio?: number | null
          created_at?: string
          error?: string | null
          estado?: string
          hash_archivo: string
          id?: string
          mapeo_columnas?: Json | null
          mime?: string | null
          nombre_archivo: string
          periodo?: string | null
          resumen_ia?: string | null
          storage_path: string
          subido_por?: string | null
          tipo: string
          total_excepciones?: number
          total_lineas?: number
          total_ok?: number
          updated_at?: string
        }
        Update: {
          aseguradora_id?: string | null
          columnas_detectadas?: Json | null
          confianza_promedio?: number | null
          created_at?: string
          error?: string | null
          estado?: string
          hash_archivo?: string
          id?: string
          mapeo_columnas?: Json | null
          mime?: string | null
          nombre_archivo?: string
          periodo?: string | null
          resumen_ia?: string | null
          storage_path?: string
          subido_por?: string | null
          tipo?: string
          total_excepciones?: number
          total_lineas?: number
          total_ok?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reportes_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_excepciones: {
        Row: {
          accion: string | null
          agente_sugerido: string | null
          agente_sugerido_id: string | null
          antiguedad_dias: number | null
          aseguradora: string | null
          aseguradora_id: string | null
          atrasada: boolean | null
          candidatos: Json | null
          created_at: string | null
          estado: string | null
          estado_linea: string | null
          explicacion: string | null
          fecha_statement: string | null
          id: string | null
          linea_comision_id: string | null
          linea_relacionada_id: string | null
          linea_venta_id: string | null
          monto: number | null
          nombre_asegurado_crudo: string | null
          nota: string | null
          numero_poliza_crudo: string | null
          oficina_sugerida: string | null
          oficina_sugerida_id: string | null
          productor_crudo: string | null
          regla_match: string | null
          reporte_id: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          score: number | null
          tipo: string | null
          venta_agente: string | null
          venta_cliente: string | null
          venta_poliza: string | null
        }
        Relationships: [
          {
            foreignKeyName: "excepciones_linea_comision_id_fkey"
            columns: ["linea_comision_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_comision_id_fkey"
            columns: ["linea_comision_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_relacionada_id_fkey"
            columns: ["linea_relacionada_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_relacionada_id_fkey"
            columns: ["linea_relacionada_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excepciones_linea_venta_id_fkey"
            columns: ["linea_venta_id"]
            isOneToOne: false
            referencedRelation: "lineas_venta"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_agente_id_fkey"
            columns: ["agente_sugerido_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_oficina_id_fkey"
            columns: ["oficina_sugerida_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_reporte_id_fkey"
            columns: ["reporte_id"]
            isOneToOne: false
            referencedRelation: "reportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
        ]
      }
      v_lineas_comision: {
        Row: {
          agente: string | null
          agente_id: string | null
          aseguradora: string | null
          aseguradora_id: string | null
          campos_extra: Json | null
          candidatos: Json | null
          clave_duplicado: string | null
          cliente: string | null
          confianza: number | null
          created_at: string | null
          es_primera_confirmacion_alias: boolean | null
          estado: string | null
          fecha_statement: string | null
          fecha_vigencia: string | null
          fila: number | null
          id: string | null
          linea_original_id: string | null
          monto: number | null
          nombre_archivo: string | null
          nombre_asegurado_crudo: string | null
          nombre_asegurado_normalizado: string | null
          numero_normalizado: string | null
          numero_poliza_crudo: string | null
          oficina: string | null
          oficina_id: string | null
          periodo: string | null
          poliza_abb: string | null
          poliza_id: string | null
          prima: number | null
          productor_crudo: string | null
          ramo: string | null
          regla_match: string | null
          reporte_id: string | null
          score: number | null
          tasa: number | null
          tipo_transaccion: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lineas_comision_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_linea_original_id_fkey"
            columns: ["linea_original_id"]
            isOneToOne: false
            referencedRelation: "lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_linea_original_id_fkey"
            columns: ["linea_original_id"]
            isOneToOne: false
            referencedRelation: "v_lineas_comision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_comision_reporte_id_fkey"
            columns: ["reporte_id"]
            isOneToOne: false
            referencedRelation: "reportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
        ]
      }
      v_polizas: {
        Row: {
          abb_version_id: string | null
          agente: string | null
          agente_id: string | null
          aseguradora: string | null
          aseguradora_id: string | null
          cliente: string | null
          cliente_id: string | null
          created_at: string | null
          email: string | null
          estado: string | null
          fecha_vencimiento: string | null
          fecha_vigencia: string | null
          id: string | null
          numero_normalizado: string | null
          numero_poliza: string | null
          oficina: string | null
          oficina_id: string | null
          origen: string | null
          prima: number | null
          ramo: string | null
          telefono: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polizas_abb_version_id_fkey"
            columns: ["abb_version_id"]
            isOneToOne: false
            referencedRelation: "abb_versiones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_aseguradora_id_fkey"
            columns: ["aseguradora_id"]
            isOneToOne: false
            referencedRelation: "aseguradoras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_oficina_id_fkey"
            columns: ["oficina_id"]
            isOneToOne: false
            referencedRelation: "oficinas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abrir_excepcion: {
        Args: {
          p_candidatos: Json
          p_explicacion: string
          p_linea: string
          p_relacionada?: string
          p_tipo: string
        }
        Returns: undefined
      }
      cfg_num: { Args: { p_clave: string; p_default: number }; Returns: number }
      es_alias_agencia: { Args: { p: string }; Returns: boolean }
      matchear_linea: { Args: { p_linea_id: string }; Returns: string }
      mi_agente_id: { Args: never; Returns: string }
      normalizar_nombre: { Args: { p: string }; Returns: string }
      normalizar_poliza: { Args: { p: string }; Returns: string }
      procesar_matching: { Args: { p_reporte_id: string }; Returns: Json }
      procesar_ventas: { Args: { p_reporte_id: string }; Returns: Json }
      reasignar_linea: {
        Args: { p_agente_id: string; p_linea_id: string; p_motivo: string }
        Returns: undefined
      }
      resolver_excepcion: {
        Args: {
          p_accion: string
          p_agente_id?: string
          p_cliente?: Json
          p_excepcion_id: string
          p_motivo?: string
          p_oficina_id?: string
          p_poliza_id?: string
        }
        Returns: Json
      }
      resumen_kpis: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
