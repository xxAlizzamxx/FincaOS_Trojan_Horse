/**
 * FincaOS domain event definitions.
 *
 * All events follow the pattern:
 *   { type, timestamp, actor_id?, comunidad_id?, request_id?, payload }
 *
 * Adding a new event:
 *  1. Add the type literal to AppEventType
 *  2. Define the payload interface
 *  3. Add it to the AppEvent union
 *  4. Register a handler in events/handlers.ts
 */

export type AppEventType =
  | 'incidencia.created'
  | 'incidencia.affected'
  | 'incidencia.status_changed'
  | 'incidencia.quorum_reached'
  | 'comment.created'
  | 'payment.updated'
  | 'mediacion.created'
  | 'user.joined_community'
  | 'user.login';

interface BaseEvent<T extends AppEventType, P> {
  type:          T;
  timestamp:     string;   // ISO-8601
  actor_id?:     string;   // uid who triggered the event
  comunidad_id?: string;
  request_id?:   string;   // trace ID from the originating HTTP request
  payload:       P;
}

export type IncidenciaCreatedEvent = BaseEvent<'incidencia.created', {
  incidenciaId: string;
  titulo:       string;
  prioridad:    string;
  zona:         string;
  comunidadId:  string;
}>;

export type IncidenciaAffectedEvent = BaseEvent<'incidencia.affected', {
  incidenciaId: string;
  userId:       string;
  quitar:       boolean;
  newCount:     number;
  porcentaje:   number;
}>;

export type IncidenciaStatusChangedEvent = BaseEvent<'incidencia.status_changed', {
  incidenciaId: string;
  from:         string;
  to:           string;
  changedBy:    string;
  titulo?:      string;
  comunidadId?: string;
  incidenciaAutorId?: string;  // ID del autor de la incidencia (para notificaciones)
}>;

export type QuorumReachedEvent = BaseEvent<'incidencia.quorum_reached', {
  incidenciaId: string;
  titulo:       string;
  afectados:    number;
  comunidadId:  string;
}>;

export type CommentCreatedEvent = BaseEvent<'comment.created', {
  comentarioId:  string;
  incidenciaId:  string;
  autorId:       string;
  autorNombre?:  string;
  contenido?:    string;
  comunidadId?:  string;
  incidenciaAutorId?: string;  // ID del autor de la incidencia (para notificaciones)
}>;

export type PaymentUpdatedEvent = BaseEvent<'payment.updated', {
  tipo:         string;  // 'cuota' | 'mediacion' | 'incidencia' | 'subscription'
  referenciaId: string;
  estado:       string;
  monto?:       number;
}>;

export type MediacionCreatedEvent = BaseEvent<'mediacion.created', {
  mediacionId:  string;
  tipo:         string;  // 'ia' | 'profesional'
  comunidadId:  string;
}>;

export type UserJoinedCommunityEvent = BaseEvent<'user.joined_community', {
  userId:      string;
  comunidadId: string;
  rol:         string;
}>;

export type UserLoginEvent = BaseEvent<'user.login', {
  userId:      string;
  comunidadId: string | null;
}>;

/** Discriminated union of all domain events. */
export type AppEvent =
  | IncidenciaCreatedEvent
  | IncidenciaAffectedEvent
  | IncidenciaStatusChangedEvent
  | QuorumReachedEvent
  | CommentCreatedEvent
  | PaymentUpdatedEvent
  | MediacionCreatedEvent
  | UserJoinedCommunityEvent
  | UserLoginEvent;
