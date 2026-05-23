import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';

const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv) => Ajv;

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '../../schemas');

let ajvInstance: Ajv | undefined;

function getAjv(): Ajv {
  if (ajvInstance) {
    return ajvInstance;
  }
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateSchema: false,
    removeAdditional: false,
  });
  addFormats(ajv);
  ajvInstance = ajv;
  return ajv;
}

async function loadSchemaFile(name: string): Promise<AnySchema> {
  const path = join(schemasDir, name);
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as AnySchema;
}

const validatorCache = new Map<string, Promise<ValidateFunction>>();

export async function getValidator(schemaFile: string): Promise<ValidateFunction> {
  const cached = validatorCache.get(schemaFile);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const ajv = getAjv();
    const schema = await loadSchemaFile(schemaFile);
    const validate = ajv.compile(schema);
    return validate;
  })();
  validatorCache.set(schemaFile, promise);
  return promise;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return 'Unknown validation error';
  }
  return errors
    .map((error) => {
      const path = error.instancePath || '/';
      return `${path}: ${error.message ?? 'invalid'}`;
    })
    .join('\n');
}

export async function assertValid<T>(schemaFile: string, data: unknown, label: string): Promise<T> {
  const validate = await getValidator(schemaFile);
  if (!validate(data)) {
    throw new Error(`${label} validation failed:\n${formatAjvErrors(validate.errors)}`);
  }
  return data as T;
}
