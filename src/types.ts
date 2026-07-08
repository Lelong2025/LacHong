export type Role='admin'|'client'
export type Profile={id:string;email:string;full_name:string|null;role:Role;is_active:boolean}
export type DocumentStatus='draft'|'submitted'|'approved'|'rejected'|'pending_issue'|'issued'|'archived'
export type DocumentRow={id:string;type:string;code:string|null;title:string;description:string|null;status:DocumentStatus;created_by:string;created_at:string;updated_at:string}
export type NotificationRow={id:string;type:string;title:string;message:string;data:Record<string,unknown>;created_at:string}
export type AuditLog={id:string;occurred_at:string;actor_email:string;actor_role:Role;table_name:string;record_id:string;object_name:string;action:'CREATE'|'UPDATE'|'SOFT_DELETE'|'LOGIN';summary:{description?:string;changedFields?:string[]}}
