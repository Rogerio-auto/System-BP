// =============================================================================
// api-reference/ApiReferencePage.tsx — UI API Reference 3-pane Stripe-like
// Layout: sidebar de recursos | endpoint detail | code panel (curl / TS)
// URL state: /ajuda/api/:resource#operationId
// =============================================================================

import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DocLayout } from '../DocLayout';

import { ApiSidebar } from './ApiSidebar';
import { generateCurl } from './curl';
import { HighlightedPath } from './highlightPath';
import type {
  EndpointEntry,
  HttpMethod,
  OpenApiOperation,
  OpenApiPathItem,
  OpenApiSchema,
  OpenApiSpec,
  ResourceGroup,
} from './types';
import { useOpenApi } from './useOpenApi';
import { useSchemaExamples } from './useSchemaExamples';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

export function parseSpec(spec: OpenApiSpec): ResourceGroup[] {
  const tagMap = new Map<string, ResourceGroup>();
  for (const tag of spec.tags ?? []) {
    tagMap.set(tag.name, { tag: tag.name, description: tag.description, endpoints: [] });
  }
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const item = pathItem as OpenApiPathItem;
    const pathLevelParams = item.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const operation = item[method.toLowerCase() as keyof OpenApiPathItem] as
        | OpenApiOperation
        | undefined;
      if (!operation) continue;
      const tags = operation.tags?.length ? operation.tags : ['Other'];
      const entry: EndpointEntry = {
        method,
        path,
        operationId: operation.operationId ?? `${method.toLowerCase()}-${path.replace(/\//g, '-')}`,
        summary: operation.summary ?? `${method} ${path}`,
        description: operation.description,
        tags,
        parameters: [...pathLevelParams, ...(operation.parameters ?? [])],
        requestBody: operation.requestBody,
        responses: operation.responses ?? {},
        security: operation.security,
        deprecated: operation.deprecated,
      };
      for (const tag of tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, { tag, endpoints: [] });
        tagMap.get(tag)!.endpoints.push(entry);
      }
    }
  }
  return Array.from(tagMap.values()).filter((g) => g.endpoints.length > 0);
}

const METHOD_STYLES: Record<HttpMethod, { bg: string; color: string }> = {
  GET: { bg: 'var(--info-bg)', color: 'var(--info)' },
  POST: { bg: 'var(--success-bg)', color: 'var(--success)' },
  PUT: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  PATCH: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  DELETE: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
  OPTIONS: { bg: 'var(--surface-muted)', color: 'var(--text-3)' },
  HEAD: { bg: 'var(--surface-muted)', color: 'var(--text-3)' },
};

function MethodBadge({
  method,
  size = 'md',
}: {
  method: HttpMethod;
  size?: 'sm' | 'md';
}): React.JSX.Element {
  const s = METHOD_STYLES[method];
  return (
    <span
      className="font-mono font-bold uppercase shrink-0"
      style={{
        background: s.bg,
        color: s.color,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: '4px',
        fontSize: size === 'sm' ? 'var(--text-xs)' : '0.72rem',
        letterSpacing: '0.04em',
        lineHeight: 1.4,
      }}
    >
      {method}
    </span>
  );
}

function resolveRef(
  schema: OpenApiSchema,
  schemas: Record<string, OpenApiSchema> | undefined,
): OpenApiSchema {
  if (!schema.$ref || !schemas) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  return schemas[name] ?? schema;
}

function schemaType(schema: OpenApiSchema): string {
  if (schema.type) {
    const t = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
    if (schema.format) return `${t}(${schema.format})`;
    if (schema.items) return `${t}[]`;
    return t;
  }
  if (schema.oneOf) return 'oneOf';
  if (schema.anyOf) return 'anyOf';
  if (schema.allOf) return 'allOf';
  if (schema.$ref) return schema.$ref.replace('#/components/schemas/', '');
  return 'any';
}

function SchemaRow({
  name,
  schema,
  required,
  componentSchemas,
  depth = 0,
}: {
  name: string;
  schema: OpenApiSchema;
  required?: boolean | undefined;
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
  depth?: number | undefined;
}): React.JSX.Element {
  const resolved = resolveRef(schema, componentSchemas);
  const type = schemaType(resolved);
  const hasChildren = resolved.properties && Object.keys(resolved.properties).length > 0;
  return (
    <>
      <tr>
        <td
          style={{
            padding: '0.5rem 0.75rem',
            paddingLeft: `${0.75 + depth * 1.25}rem`,
            borderBottom: '1px solid var(--border-subtle)',
            width: '35%',
          }}
        >
          <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
            {name}
          </span>
          {required && (
            <span style={{ marginLeft: '4px', color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>
              *
            </span>
          )}
        </td>
        <td
          style={{
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
            width: '20%',
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
          >
            {type}
          </span>
        </td>
        <td
          style={{
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-2)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {resolved.description ?? '—'}
          {resolved.enum && (
            <span
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: 'var(--text-xs)',
                color: 'var(--text-3)',
              }}
            >
              Valores: {resolved.enum.map(String).join(', ')}
            </span>
          )}
        </td>
      </tr>
      {hasChildren &&
        Object.entries(resolved.properties!).map(([k, v]) => (
          <SchemaRow
            key={k}
            name={k}
            schema={v}
            required={resolved.required?.includes(k)}
            componentSchemas={componentSchemas}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

const TH_COLS = ['Nome', 'Tipo', 'Descrição'];

function SchemaTableHead({ cols }: { cols: string[] }): React.JSX.Element {
  return (
    <thead>
      <tr style={{ background: 'var(--bg-elev-2)' }}>
        {cols.map((col) => (
          <th
            key={col}
            className="font-sans font-semibold text-left"
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SchemaTable({
  title,
  schema,
  componentSchemas,
  required,
}: {
  title: string;
  schema: OpenApiSchema;
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
  required?: boolean | undefined;
}): React.JSX.Element | null {
  const resolved = resolveRef(schema, componentSchemas);
  if (!resolved.properties || !Object.keys(resolved.properties).length) return null;
  return (
    <section>
      <h4
        className="font-sans font-semibold"
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '0.5rem',
        }}
      >
        {title}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
      </h4>
      <div
        className="overflow-x-auto rounded-sm"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-elev-1)' }}
      >
        <table className="w-full border-collapse">
          <SchemaTableHead cols={TH_COLS} />
          <tbody>
            {Object.entries(resolved.properties).map(([k, v]) => (
              <SchemaRow
                key={k}
                name={k}
                schema={v}
                required={resolved.required?.includes(k)}
                componentSchemas={componentSchemas}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ParamGroup({
  title,
  params,
  componentSchemas,
}: {
  title: string;
  params: EndpointEntry['parameters'];
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
}): React.JSX.Element {
  return (
    <section>
      <h4
        className="font-sans font-semibold"
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '0.5rem',
        }}
      >
        {title}
      </h4>
      <div
        className="overflow-x-auto rounded-sm"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-elev-1)' }}
      >
        <table className="w-full border-collapse">
          <SchemaTableHead cols={TH_COLS} />
          <tbody>
            {params.map((param) => (
              <SchemaRow
                key={`${param.in}-${param.name}`}
                name={param.name}
                schema={param.schema ?? {}}
                required={param.required}
                componentSchemas={componentSchemas}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ParametersSection({
  endpoint,
  componentSchemas,
}: {
  endpoint: EndpointEntry;
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
}): React.JSX.Element | null {
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
  const headerParams = endpoint.parameters.filter((p) => p.in === 'header');
  let bodySection: React.JSX.Element | null = null;
  if (endpoint.requestBody?.content) {
    const jsonContent =
      endpoint.requestBody.content['application/json'] ??
      Object.values(endpoint.requestBody.content)[0];
    if (jsonContent?.schema) {
      bodySection = (
        <SchemaTable
          title="Body"
          schema={jsonContent.schema}
          componentSchemas={componentSchemas}
          required={endpoint.requestBody.required}
        />
      );
    }
  }
  if (!pathParams.length && !queryParams.length && !headerParams.length && !bodySection)
    return null;
  return (
    <div className="flex flex-col gap-6">
      {pathParams.length > 0 && (
        <ParamGroup
          title="Parâmetros de path"
          params={pathParams}
          componentSchemas={componentSchemas}
        />
      )}
      {queryParams.length > 0 && (
        <ParamGroup title="Query params" params={queryParams} componentSchemas={componentSchemas} />
      )}
      {headerParams.length > 0 && (
        <ParamGroup title="Headers" params={headerParams} componentSchemas={componentSchemas} />
      )}
      {bodySection}
    </div>
  );
}

function ResponsesSection({
  responses,
  componentSchemas,
}: {
  responses: EndpointEntry['responses'];
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
}): React.JSX.Element {
  return (
    <section>
      <h3
        className="font-display font-semibold"
        style={{
          fontSize: 'var(--text-xl)',
          letterSpacing: '-0.02em',
          color: 'var(--text)',
          marginBottom: '1rem',
          marginTop: '2rem',
        }}
      >
        Respostas
      </h3>
      <div className="flex flex-col gap-3">
        {Object.entries(responses).map(([code, response]) => {
          const is2 = code.startsWith('2');
          const is4 = code.startsWith('4');
          const sc = is2
            ? { color: 'var(--success)', bg: 'var(--success-bg)' }
            : is4
              ? { color: 'var(--warning)', bg: 'var(--warning-bg)' }
              : { color: 'var(--danger)', bg: 'var(--danger-bg)' };
          const json =
            response.content?.['application/json'] ?? Object.values(response.content ?? {})[0];
          const schema = json?.schema ? resolveRef(json.schema, componentSchemas) : undefined;
          const hasProps = schema?.properties && Object.keys(schema.properties).length > 0;
          return (
            <details
              key={code}
              className="rounded-sm overflow-hidden"
              style={{ border: '1px solid var(--border)' }}
            >
              <summary
                className="flex items-center gap-3 cursor-pointer select-none px-4 py-3"
                style={{ background: 'var(--bg-elev-1)', listStyle: 'none' }}
              >
                <span
                  className="font-mono font-bold"
                  style={{
                    fontSize: 'var(--text-sm)',
                    background: sc.bg,
                    color: sc.color,
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  {code}
                </span>
                <span
                  className="font-sans flex-1"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
                >
                  {response.description ?? '—'}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  style={{ color: 'var(--text-3)' }}
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              {hasProps && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <table className="w-full border-collapse">
                    <SchemaTableHead cols={['Campo', 'Tipo', 'Descrição']} />
                    <tbody>
                      {Object.entries(schema!.properties!).map(([k, v]) => (
                        <SchemaRow
                          key={k}
                          name={k}
                          schema={v}
                          required={schema!.required?.includes(k)}
                          componentSchemas={componentSchemas}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

type CodeTab = 'curl' | 'typescript';

function CodePanel({
  endpoint,
  componentSchemas,
  schemaExamples,
}: {
  endpoint: EndpointEntry;
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
  schemaExamples?: Record<string, { ts: string; json: unknown }> | undefined;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = React.useState<CodeTab>('curl');
  const curlSnippet = React.useMemo(
    () =>
      generateCurl({
        method: endpoint.method,
        path: endpoint.path,
        parameters: endpoint.parameters,
        ...(endpoint.requestBody !== undefined ? { requestBody: endpoint.requestBody } : {}),
        ...(componentSchemas !== undefined ? { componentSchemas } : {}),
      }),
    [endpoint.method, endpoint.path, endpoint.parameters, endpoint.requestBody, componentSchemas],
  );
  const tabCss = (tab: CodeTab): React.CSSProperties => ({
    fontSize: 'var(--text-xs)',
    color: activeTab === tab ? 'var(--text)' : 'var(--text-3)',
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: activeTab === tab ? '2px solid var(--info)' : '2px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    padding: '0.625rem 1rem',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.02em',
    outline: 'none',
  });
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <div
        className="flex items-center"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elev-3)' }}
      >
        {(['curl', 'typescript'] as CodeTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={tabCss(tab)}
          >
            {tab === 'curl' ? 'cURL' : 'TypeScript'}
          </button>
        ))}
      </div>
      <div style={{ padding: '1rem', minHeight: '120px' }}>
        {activeTab === 'curl' ? (
          <pre
            className="font-mono overflow-x-auto"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text)',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            <code>{curlSnippet}</code>
          </pre>
        ) : (
          (() => {
            const routeKey = `${endpoint.method} ${endpoint.path}`;
            const example = schemaExamples?.[routeKey];
            if (example?.ts) {
              return (
                <pre
                  className="font-mono overflow-x-auto"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text)',
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                  }}
                >
                  <code>{example.ts}</code>
                </pre>
              );
            }
            return (
              <div className="flex flex-col items-start gap-1 py-4">
                <span
                  className="font-sans"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}
                >
                  Exemplo indisponível — rode{' '}
                  <code
                    className="font-mono"
                    style={{
                      fontSize: 'var(--text-xs)',
                      background: 'var(--surface-muted)',
                      padding: '0.1em 0.35em',
                      borderRadius: '4px',
                    }}
                  >
                    pnpm docs:api
                  </code>
                </span>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

function EndpointList({
  endpoints,
  activeOperationId,
  onSelect,
}: {
  endpoints: EndpointEntry[];
  activeOperationId: string | undefined;
  onSelect: (entry: EndpointEntry) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Endpoints">
      <ul role="list" className="flex flex-col gap-0.5">
        {endpoints.map((ep) => {
          const isActive = ep.operationId === activeOperationId;
          return (
            <li key={ep.operationId}>
              <button
                type="button"
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${ep.method} ${ep.path} — ${ep.summary}`}
                onClick={() => onSelect(ep)}
                className="w-full text-left flex items-center gap-2 rounded-sm px-3 py-2"
                style={{
                  background: isActive ? 'var(--info-bg)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  outline: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'var(--surface-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <MethodBadge method={ep.method} size="sm" />
                <span
                  className="font-mono truncate"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: isActive ? 'var(--info)' : 'var(--text-2)',
                    minWidth: 0,
                  }}
                >
                  {ep.path}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EndpointDetail({
  endpoint,
  componentSchemas,
}: {
  endpoint: EndpointEntry;
  componentSchemas?: Record<string, OpenApiSchema> | undefined;
}): React.JSX.Element {
  return (
    <article>
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <MethodBadge method={endpoint.method} />
        <HighlightedPath path={endpoint.path} style={{ fontSize: 'var(--text-base)' }} />
        {endpoint.deprecated && (
          <span
            className="font-sans font-semibold"
            style={{
              fontSize: 'var(--text-xs)',
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            Descontinuado
          </span>
        )}
      </div>
      <h2
        className="font-display font-bold"
        style={{
          fontSize: 'var(--text-2xl)',
          letterSpacing: '-0.035em',
          color: 'var(--text)',
          marginBottom: '0.5rem',
          marginTop: '0.25rem',
        }}
      >
        {endpoint.summary}
      </h2>
      {endpoint.description && (
        <p
          className="font-sans"
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--text-2)',
            lineHeight: 1.7,
            marginBottom: '2rem',
          }}
        >
          {endpoint.description}
        </p>
      )}
      <ParametersSection endpoint={endpoint} componentSchemas={componentSchemas} />
      <ResponsesSection
        responses={endpoint.responses}
        {...(componentSchemas !== undefined ? { componentSchemas } : {})}
      />
    </article>
  );
}

function ResourcePage({
  group,
  spec,
  schemaExamples,
}: {
  group: ResourceGroup;
  spec: OpenApiSpec;
  schemaExamples?: Record<string, { ts: string; json: unknown }> | undefined;
}): React.JSX.Element {
  const initialOpId =
    typeof window !== 'undefined' && window.location.hash
      ? window.location.hash.slice(1)
      : undefined;
  const [activeEndpoint, setActiveEndpoint] = React.useState<EndpointEntry>(() => {
    if (initialOpId) {
      const found = group.endpoints.find((e) => e.operationId === initialOpId);
      if (found) return found;
    }
    // endpoints is guaranteed non-empty (filtered in parseSpec)
    return group.endpoints[0]!;
  });
  const componentSchemas = spec.components?.schemas;
  const stickyTop = '1.5rem';
  const stickyHeight = 'calc(100vh - 3.5rem - 3rem)';
  function selectEndpoint(ep: EndpointEntry): void {
    setActiveEndpoint(ep);
    window.history.replaceState(null, '', `#${ep.operationId}`);
  }
  return (
    <div className="flex min-h-0">
      <aside
        className="hidden md:block shrink-0"
        style={{
          width: 200,
          position: 'sticky',
          top: stickyTop,
          alignSelf: 'flex-start',
          height: stickyHeight,
          overflowY: 'auto',
          borderRight: '1px solid var(--border)',
          paddingRight: '0.5rem',
          paddingTop: '0.25rem',
        }}
      >
        <p
          className="font-sans font-semibold uppercase"
          style={{
            fontSize: '0.65rem',
            letterSpacing: '0.08em',
            color: 'var(--text-3)',
            marginBottom: '0.5rem',
            paddingLeft: '0.75rem',
          }}
        >
          {group.tag}
        </p>
        <EndpointList
          endpoints={group.endpoints}
          activeOperationId={activeEndpoint.operationId}
          onSelect={selectEndpoint}
        />
      </aside>
      <div className="min-w-0 flex-1" style={{ padding: '1.5rem 2rem', paddingBottom: '4rem' }}>
        <EndpointDetail endpoint={activeEndpoint} componentSchemas={componentSchemas} />
      </div>
      <aside
        className="hidden lg:block shrink-0"
        style={{
          width: 340,
          position: 'sticky',
          top: stickyTop,
          alignSelf: 'flex-start',
          height: stickyHeight,
          overflowY: 'auto',
          paddingLeft: '1.5rem',
          paddingTop: '1.5rem',
        }}
      >
        <CodePanel
          endpoint={activeEndpoint}
          componentSchemas={componentSchemas}
          {...(schemaExamples !== undefined ? { schemaExamples } : {})}
        />
      </aside>
    </div>
  );
}

function OverviewPage({
  resources,
  spec,
}: {
  resources: ResourceGroup[];
  spec: OpenApiSpec;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '1.5rem 2rem', paddingBottom: '4rem', maxWidth: '720px' }}>
      <h1
        className="font-display font-bold"
        style={{
          fontSize: 'var(--text-3xl)',
          letterSpacing: '-0.04em',
          color: 'var(--text)',
          marginBottom: '0.75rem',
        }}
      >
        {spec.info.title}
      </h1>
      <p
        className="font-sans"
        style={{
          fontSize: 'var(--text-base)',
          color: 'var(--text-2)',
          lineHeight: 1.7,
          marginBottom: '2rem',
        }}
      >
        {spec.info.description ?? 'Documentação completa dos endpoints da API Elemento.'} Versão:{' '}
        <code
          className="font-mono"
          style={{
            fontSize: '0.92em',
            background: 'var(--surface-muted)',
            padding: '0.1em 0.35em',
            borderRadius: '4px',
            color: 'var(--brand-azul)',
          }}
        >
          {spec.info.version}
        </code>
      </p>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {resources.map((resource) => {
          const slug = resource.tag.toLowerCase().replace(/\s+/g, '-');
          return (
            <button
              key={resource.tag}
              type="button"
              onClick={() => navigate(`/ajuda/api/${encodeURIComponent(slug)}`)}
              className="text-left rounded-md p-4"
              style={{
                background: 'var(--bg-elev-1)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--elev-1)',
                cursor: 'pointer',
                outline: 'none',
                transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.15s',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.boxShadow = 'var(--elev-2)';
                el.style.borderColor = 'var(--border-strong)';
                el.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.boxShadow = 'var(--elev-1)';
                el.style.borderColor = 'var(--border)';
                el.style.transform = 'translateY(0)';
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="font-display font-semibold"
                  style={{ fontSize: 'var(--text-base)', color: 'var(--text)' }}
                >
                  {resource.tag}
                </span>
                <span
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-3)',
                    background: 'var(--surface-muted)',
                    borderRadius: '999px',
                    padding: '1px 8px',
                  }}
                >
                  {resource.endpoints.length} endpoint{resource.endpoints.length !== 1 ? 's' : ''}
                </span>
              </div>
              {resource.description && (
                <p
                  className="font-sans"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', lineHeight: 1.5 }}
                >
                  {resource.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 p-8">
      {[70, 55, 40].map((w, i) => (
        <div
          key={i}
          className="h-6 rounded-sm animate-pulse"
          style={{ background: 'var(--surface-muted)', width: `${w}%` }}
        />
      ))}
      <span className="sr-only">Carregando API Reference…</span>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }): React.JSX.Element {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 p-8">
      <h1
        className="font-display font-bold"
        style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.03em', color: 'var(--text)' }}
      >
        Não foi possível carregar a API Reference
      </h1>
      <p className="font-sans" style={{ fontSize: 'var(--text-base)', color: 'var(--text-2)' }}>
        Verifique que o servidor da API está acessível ou tente novamente.
      </p>
      <p
        className="font-mono"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-3)',
          background: 'var(--surface-muted)',
          padding: '0.5rem 0.75rem',
          borderRadius: '4px',
        }}
      >
        {error.message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans font-semibold rounded-sm px-4 py-2"
        style={{
          background: 'var(--info-bg)',
          color: 'var(--info)',
          border: '1px solid var(--info)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

function ApiReferenceInner({
  resources,
  spec,
  schemaExamples,
}: {
  resources: ResourceGroup[];
  spec: OpenApiSpec;
  schemaExamples?: Record<string, { ts: string; json: unknown }> | undefined;
}): React.JSX.Element {
  const { resource } = useParams<{ resource?: string }>();
  const activeGroup = resource
    ? resources.find(
        (g) =>
          g.tag.toLowerCase().replace(/\s+/g, '-') === decodeURIComponent(resource).toLowerCase(),
      )
    : undefined;
  const stickyTop = '1.5rem';
  const stickyHeight = 'calc(100vh - 3.5rem - 3rem)';
  return (
    <div className="flex min-h-0" style={{ margin: '0 -1.5rem' }}>
      <aside
        className="hidden md:block shrink-0"
        style={{
          width: 200,
          position: 'sticky',
          top: stickyTop,
          alignSelf: 'flex-start',
          height: stickyHeight,
          overflowY: 'auto',
          borderRight: '1px solid var(--border)',
          padding: '1.5rem 0.5rem 1.5rem 1.5rem',
        }}
      >
        <ApiSidebar resources={resources} activeTag={activeGroup?.tag} />
      </aside>
      <div className="min-w-0 flex-1">
        {activeGroup ? (
          <ResourcePage
            group={activeGroup}
            spec={spec}
            {...(schemaExamples !== undefined ? { schemaExamples } : {})}
          />
        ) : (
          <OverviewPage resources={resources} spec={spec} />
        )}
      </div>
    </div>
  );
}

/**
 * ApiReferencePage — UI API Reference 3-pane Stripe-like.
 *
 * Importar via React.lazy na rota para code-split automático.
 * Reutiliza DocLayout para manter sidebar de seções global visível.
 */
export function ApiReferencePage(): React.JSX.Element {
  const { spec, isLoading, isError, error, refetch } = useOpenApi();
  const { schemaExamples } = useSchemaExamples();
  const resources = React.useMemo(() => (spec ? parseSpec(spec) : []), [spec]);
  return (
    <DocLayout>
      {isLoading && <LoadingSkeleton />}
      {isError && error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !isError && spec && (
        <ApiReferenceInner
          resources={resources}
          spec={spec}
          {...(schemaExamples !== undefined ? { schemaExamples } : {})}
        />
      )}
    </DocLayout>
  );
}
