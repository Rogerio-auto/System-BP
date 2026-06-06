// =============================================================================
// api-reference/curl.ts â€” Gerador de snippet curl a partir de um endpoint
//
// Regras:
//  - Sempre inclui -H "Authorization: Bearer <token>" (API Ã© autenticada)
//  - Body via -d com JSON pretty-printed usando o primeiro exemplo do spec
//  - ParÃ¢metros de query sÃ£o acrescentados na URL como ?key=value
//  - Path params sÃ£o substituÃ­dos pelo exemplo ou por ":param" literal
// =============================================================================

import type { EndpointEntry, OpenApiParameter, OpenApiSchema } from './types';

// Extrai o valor de exemplo de um schema, preferindo `example`, depois
// o primeiro enum, depois um placeholder baseado no tipo.
function exampleFromSchema(schema: OpenApiSchema | undefined, fallback: string): unknown {
  if (!schema) return fallback;
  if (schema.example !== undefined) return schema.example;
  if (schema.examples) {
    const first = Object.values(schema.examples)[0];
    if (first?.value !== undefined) return first.value;
  }
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case 'string':
      return schema.format === 'uuid'
        ? '00000000-0000-0000-0000-000000000000'
        : schema.format === 'date-time'
          ? '2024-01-01T00:00:00Z'
          : fallback;
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return fallback;
  }
}

// Gera o objeto body de exemplo a partir dos schemas das properties
function buildBodyExample(
  schema: OpenApiSchema | undefined,
  schemas: Record<string, OpenApiSchema> | undefined,
): Record<string, unknown> {
  if (!schema) return {};

  // Resolve $ref se necessÃ¡rio
  const resolved = resolveRef(schema, schemas);

  if (resolved.example !== undefined && typeof resolved.example === 'object') {
    return resolved.example as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  if (resolved.properties) {
    for (const [key, propSchema] of Object.entries(resolved.properties)) {
      result[key] = exampleFromSchema(resolveRef(propSchema, schemas), key);
    }
  }
  return result;
}

function resolveRef(
  schema: OpenApiSchema,
  schemas: Record<string, OpenApiSchema> | undefined,
): OpenApiSchema {
  if (!schema.$ref || !schemas) return schema;
  const refName = schema.$ref.replace('#/components/schemas/', '');
  return schemas[refName] ?? schema;
}

export interface CurlOptions {
  method: EndpointEntry['method'];
  path: string;
  parameters?: OpenApiParameter[];
  requestBody?: EndpointEntry['requestBody'];
  /** Schemas do spec para resolver $ref â€” opcional, melhora exemplos */
  componentSchemas?: Record<string, OpenApiSchema>;
  /** Base URL do servidor â€” default https://api.elemento.app/v1 */
  baseUrl?: string;
}

/**
 * Gera um snippet curl completo e executÃ¡vel a partir de um endpoint OpenAPI.
 *
 * @example
 * generateCurl({ method: 'GET', path: '/leads', parameters: [...] })
 * // => "curl -X GET 'https://api.elemento.app/v1/leads?page=1' \\n  -H ..."
 */
export function generateCurl({
  method,
  path,
  parameters = [],
  requestBody,
  componentSchemas,
  baseUrl = 'https://api.elemento.app/v1',
}: CurlOptions): string {
  const lines: string[] = [];

  // Substitui path params pelo valor de exemplo
  const pathParams = parameters.filter((p) => p.in === 'path');
  let resolvedPath = path;
  for (const param of pathParams) {
    const example = param.example ?? exampleFromSchema(param.schema, param.name);
    resolvedPath = resolvedPath.replace(`:${param.name}`, String(example));
    // suporte ao estilo {param} do OpenAPI
    resolvedPath = resolvedPath.replace(`{${param.name}}`, String(example));
  }

  // Monta query string
  const queryParams = parameters.filter((p) => p.in === 'query');
  let queryString = '';
  if (queryParams.length > 0) {
    const parts = queryParams.map((p) => {
      const val = p.example ?? exampleFromSchema(p.schema, p.name);
      return `${encodeURIComponent(p.name)}=${encodeURIComponent(String(val))}`;
    });
    queryString = `?${parts.join('&')}`;
  }

  const url = `${baseUrl}${resolvedPath}${queryString}`;

  // Linha principal
  lines.push('curl -X ' + method + " '" + url + "' \\");

  // Headers fixos
  lines.push("  -H 'Authorization: Bearer <seu-token>' \\");

  // Body
  let hasBody = false;
  if (requestBody?.content) {
    const jsonContent =
      requestBody.content['application/json'] ?? Object.values(requestBody.content)[0];
    if (jsonContent) {
      hasBody = true;
      lines.push("  -H 'Content-Type: application/json' \\");

      // Tenta extrair exemplo do requestBody
      let bodyObj: Record<string, unknown> = {};
      if (jsonContent.example && typeof jsonContent.example === 'object') {
        bodyObj = jsonContent.example as Record<string, unknown>;
      } else if (jsonContent.examples) {
        const firstEx = Object.values(jsonContent.examples)[0];
        if (firstEx?.value && typeof firstEx.value === 'object') {
          bodyObj = firstEx.value as Record<string, unknown>;
        }
      } else {
        bodyObj = buildBodyExample(jsonContent.schema, componentSchemas);
      }

      const bodyJson = JSON.stringify(bodyObj, null, 2)
        .split('\n')
        .map((line, i) => (i === 0 ? `  -d '${line}` : `       ${line}`))
        .join('\n');
      lines.push(`${bodyJson}'`);
    }
  }

  if (!hasBody) {
    // Remove o trailing backslash da última linha se não há mais args
    const last = lines[lines.length - 1];
    if (last !== undefined) {
      lines[lines.length - 1] = last.replace(/ \$/, '');
    }
  }

  return lines.join('\n');
}
