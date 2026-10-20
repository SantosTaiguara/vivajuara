# Observabilidade de jobs e filas (contrato)

Não há fila nem agendador no servidor hoje. Contrato para quando existirem:

```ts
interface JobObservabilityContext { jobId: string; jobType: string; organizationId?: string; developmentId?: string; attempt: number; maxAttempts?: number; enqueuedAt: string; startedAt?: string }
```

- Estados: QUEUED, RUNNING, SUCCEEDED, FAILED, RETRYING, DEAD_LETTER, CANCELLED.
- Métricas: jobs_enqueued_total, jobs_started_total, jobs_succeeded_total, jobs_failed_total, jobs_retried_total, job_duration_ms, job_queue_delay_ms, jobs_in_queue, dead_letter_count, job_last_success_timestamp — label único `job_type` (padrão `^[A-Z][A-Z0-9_]+$`), nunca jobId.
- Retry com limite (nada de retry infinito); esgotou → DEAD_LETTER inspecionável → alerta `job_retry_exhausted` (HIGH, runbook RB-JOB-RETRY-EXHAUSTED).
- Agendador: `job_last_success_timestamp` como heartbeat; alerta de **ausência** `cron_missed` quando a idade passa de 2× o intervalo esperado.
- Trace: `job.enqueue` (PRODUCER) no request; `job.consume` (CONSUMER) em trace novo com link para o request.
- Pipelines específicos (contrato): análise (tópico 35: analysis_run_duration_ms), regras (tópico 36: rule_evaluation_duration_ms), analytics (tópicos 44/45: analytics_events_ingested_total, analytics_pipeline_lag_ms), documentos (document_scan_duration_ms, document_scan_failures_total{failure_category}), migrações (db_migration_duration_ms).
