{{- define "email.labels" -}}
app.kubernetes.io/part-of: email-service
{{- end -}}

{{- define "email.namespace" -}}
{{- .Values.namespace | default "email-service" -}}
{{- end -}}

{{- define "email.redisHost" -}}
email-service-redis.{{ include "email.namespace" . }}.svc.cluster.local
{{- end -}}
