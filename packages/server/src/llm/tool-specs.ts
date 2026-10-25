import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOL_DEFINITIONS, type ToolName } from '@vp/core';
import type { ToolSpec } from './types';

/** JSON-schema tool specs for the model, generated from the same zod schemas the server validates with. */
export function toolSpecs(names: readonly ToolName[]): ToolSpec[] {
  return names.map((name) => {
    const def = TOOL_DEFINITIONS[name];
    const schema = zodToJsonSchema(def.args, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description: def.description, parameters: schema };
  });
}
