// =============================================================================
// api-reference/types.ts — Tipos para o spec OpenAPI 3.1 parseado
// =============================================================================

export interface OpenApiSchema {
  type?: string | string[] | undefined;
  format?: string | undefined;
  description?: string | undefined;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string | undefined }> | undefined;
  properties?: Record<string, OpenApiSchema> | undefined;
  items?: OpenApiSchema | undefined;
  enum?: unknown[] | undefined;
  required?: string[] | undefined;
  oneOf?: OpenApiSchema[] | undefined;
  anyOf?: OpenApiSchema[] | undefined;
  allOf?: OpenApiSchema[] | undefined;
  $ref?: string | undefined;
  nullable?: boolean | undefined;
  default?: unknown;
  minimum?: number | undefined;
  maximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  additionalProperties?: boolean | OpenApiSchema | undefined;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string | undefined;
  required?: boolean | undefined;
  schema?: OpenApiSchema | undefined;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string | undefined }> | undefined;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema | undefined;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string | undefined }> | undefined;
}

export interface OpenApiRequestBody {
  description?: string | undefined;
  required?: boolean | undefined;
  content?: Record<string, OpenApiMediaType> | undefined;
}

export interface OpenApiResponse {
  description?: string | undefined;
  content?: Record<string, OpenApiMediaType> | undefined;
}

export interface OpenApiOperation {
  operationId?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  parameters?: OpenApiParameter[] | undefined;
  requestBody?: OpenApiRequestBody | undefined;
  responses?: Record<string, OpenApiResponse> | undefined;
  security?: Array<Record<string, string[]>> | undefined;
  deprecated?: boolean | undefined;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation | undefined;
  post?: OpenApiOperation | undefined;
  put?: OpenApiOperation | undefined;
  patch?: OpenApiOperation | undefined;
  delete?: OpenApiOperation | undefined;
  options?: OpenApiOperation | undefined;
  head?: OpenApiOperation | undefined;
  parameters?: OpenApiParameter[] | undefined;
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string | undefined;
}

export interface OpenApiSpec {
  openapi: string;
  info: OpenApiInfo;
  paths?: Record<string, OpenApiPathItem> | undefined;
  components?:
    | {
        schemas?: Record<string, OpenApiSchema> | undefined;
        securitySchemes?: Record<string, unknown> | undefined;
      }
    | undefined;
  tags?: Array<{ name: string; description?: string | undefined }> | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface EndpointEntry {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  description?: string | undefined;
  tags: string[];
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody | undefined;
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>> | undefined;
  deprecated?: boolean | undefined;
}

export interface ResourceGroup {
  tag: string;
  description?: string | undefined;
  endpoints: EndpointEntry[];
}
